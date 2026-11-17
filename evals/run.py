"""Score the routing lanes on the test set in tasks.py.

Usage: python3 evals/run.py [--lanes ollama,haiku,sonnet,gemini] [--only id,id] [--budget 1.0]

Lanes: Ollama qwen3.5:9b over HTTP; Claude Haiku and Sonnet through `claude -p` (safe mode,
no tools, from an empty temp dir; images as stream-json image blocks); Gemini 3.8 Flash
through `agy -p --sandbox --mode plan` from an empty temp dir (images copied into it).
A client-sensitivity task is never sent to Gemini. Writes evals/results-<date>.json and
evals/results-<date>.md. Lanes run in parallel, tasks within a lane one at a time.
"""
import argparse
import base64
import datetime as dt
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tasks import INPUTS, tasks  # noqa: E402

OLLAMA = "http://127.0.0.1:11434/api/chat"
OLLAMA_MODEL = "qwen3.5:9b"
AGY = str(Path.home() / ".local/bin/agy")
LANES = {
    "ollama": {"model": OLLAMA_MODEL},
    "haiku": {"model": "claude-haiku-5-5"},
    "sonnet": {"model": "claude-sonnet-5-5"},
    "gemini": {"model": "gemini-3.8-flash-medium"},
}
spent = {"usd": 0.0}
lock = threading.Lock()


def run_ollama(task):
    msg = {"role": "user", "content": task["prompt"]}
    if task.get("image"):
        msg["images"] = [base64.b64encode((INPUTS / task["image"]).read_bytes()).decode()]
    body = {"model": OLLAMA_MODEL, "messages": [msg], "stream": False, "keep_alive": "10m", "think": False,
            "options": {"num_ctx": 16384 if len(task["prompt"]) > 6000 else 8192, "temperature": 0.2}}
    req = urllib.request.Request(OLLAMA, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.loads(r.read())
    return {"text": out.get("message", {}).get("content", ""), "in": out.get("prompt_eval_count", 0), "out": out.get("eval_count", 0),
            "usd": 0.0, "done_reason": out.get("done_reason")}


def run_claude(task, model):
    with tempfile.TemporaryDirectory(prefix="ao-eval-") as tmp:
        argv = ["claude", "-p", "--model", model, "--tools", "", "--strict-mcp-config", "--safe-mode", "--no-session-persistence"]
        if task.get("image"):
            data = base64.b64encode((INPUTS / task["image"]).read_bytes()).decode()
            line = {"type": "user", "message": {"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                {"type": "text", "text": task["prompt"]}]}}
            argv += ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
            stdin = json.dumps(line) + "\n"
        else:
            argv += ["--output-format", "json"]
            stdin = task["prompt"]
        p = subprocess.run(argv, input=stdin, capture_output=True, text=True, cwd=tmp, timeout=600)
        last = [l for l in p.stdout.strip().split("\n") if l.strip()][-1] if p.stdout.strip() else "{}"
        out = json.loads(last)
        if out.get("is_error"):
            raise RuntimeError(str(out.get("result") or p.stderr)[:200])
        u = out.get("usage", {})
        return {"text": out.get("result", ""), "in": u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0),
                "out": u.get("output_tokens", 0), "usd": out.get("total_cost_usd", 0.0)}


def run_gemini(task, model):
    if task["sensitivity"] == "client":
        raise PermissionError("client material never goes to a cloud side lane")
    tmp = tempfile.mkdtemp(prefix="ao-gemini-")
    try:
        prompt = task["prompt"]
        if task.get("image"):
            shutil.copy(INPUTS / task["image"], Path(tmp) / task["image"])
            prompt = f"Open the image {tmp}/{task['image']} with your file viewing tool (do not run any shell command) and look at it.\n\n{prompt}"
        argv = [AGY, "--model", model, "--sandbox", "--mode", "plan", "--print-timeout", "240s", "--output-format", "json", "-p", prompt]
        p = subprocess.run(argv, capture_output=True, text=True, cwd=tmp, timeout=300)
        start = p.stdout.find("{")
        out = json.loads(p.stdout[start:]) if start >= 0 else {}
        if out.get("status") != "SUCCESS":
            raise RuntimeError((p.stdout + p.stderr)[:200])
        u = out.get("usage", {})
        return {"text": out.get("response", ""), "in": u.get("input_tokens", 0), "out": u.get("output_tokens", 0), "usd": None}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_lane(lane, items, budget, results):
    model = LANES[lane]["model"]
    for task in items:
        if lane in ("haiku", "sonnet") and spent["usd"] >= budget:
            results[lane][task["id"]] = {"skipped": "budget"}
            continue
        t0 = time.time()
        try:
            got = run_ollama(task) if lane == "ollama" else run_gemini(task, model) if lane == "gemini" else run_claude(task, model)
            passed, note = task["check"](got["text"])
            row = {"pass": passed, "note": "" if passed else note, "ms": round((time.time() - t0) * 1000), "tokens_in": got["in"], "tokens_out": got["out"],
                   "usd": got["usd"], "answer": got["text"][:300]}
            if got.get("done_reason") == "length":
                row["note"] = (row["note"] + " · truncated").strip(" ·")
        except Exception as err:  # noqa: BLE001
            row = {"pass": False, "error": f"{type(err).__name__}: {str(err)[:200]}", "ms": round((time.time() - t0) * 1000)}
        with lock:
            spent["usd"] += row.get("usd") or 0.0
            results[lane][task["id"]] = row
        print(f"{lane:7} {task['id']:14} {'PASS' if row['pass'] else 'fail'} {row['ms'] / 1000:6.1f}s {row.get('note') or row.get('error') or ''}", flush=True)


def summary(results, items, lanes):
    rows = ["| task | type | " + " | ".join(lanes) + " |", "|---|---|" + "---|" * len(lanes)]
    for t in items:
        cells = []
        for lane in lanes:
            r = results[lane].get(t["id"], {})
            cells.append("skip" if "skipped" in r else f"{'✓' if r.get('pass') else '✗'} {r.get('ms', 0) / 1000:.1f}s")
        rows.append(f"| {t['id']} | {t['type']} | " + " | ".join(cells) + " |")
    totals = []
    for lane in lanes:
        rs = [r for r in results[lane].values() if "skipped" not in r]
        n = len(rs)
        passed = sum(1 for r in rs if r.get("pass"))
        med = sorted(r.get("ms", 0) for r in rs)[n // 2] / 1000 if n else 0
        usd = sum(r.get("usd") or 0 for r in rs)
        tok = sum((r.get("tokens_in") or 0) + (r.get("tokens_out") or 0) for r in rs)
        totals.append(f"{passed}/{n} · median {med:.1f}s · {tok} tok · ${usd:.3f}")
    rows.append("| **total** | | " + " | ".join(totals) + " |")
    by_type = {}
    for t in items:
        by_type.setdefault(t["type"], []).append(t["id"])
    lines = ["", "Pass rate by task type:", ""]
    for kind, ids in by_type.items():
        cells = []
        for lane in lanes:
            rs = [results[lane].get(i, {}) for i in ids]
            done = [r for r in rs if "skipped" not in r]
            cells.append(f"{lane} {sum(1 for r in done if r.get('pass'))}/{len(done)}")
        lines.append(f"- {kind}: " + ", ".join(cells))
    return "\n".join(rows + lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lanes", default="ollama,haiku,sonnet,gemini")
    ap.add_argument("--only", default="")
    ap.add_argument("--budget", type=float, default=1.0, help="dollars of Claude usage before Claude lanes stop")
    a = ap.parse_args()
    lanes = [x for x in a.lanes.split(",") if x in LANES]
    items = [t for t in tasks() if not a.only or t["id"] in a.only.split(",")]
    results = {lane: {} for lane in lanes}
    started = time.time()
    threads = [threading.Thread(target=run_lane, args=(lane, items, a.budget, results)) for lane in lanes]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    day = dt.date.today().isoformat()
    meta = {"date": day, "seconds": round(time.time() - started), "claude_usd": round(spent["usd"], 4),
            "lanes": {lane: LANES[lane]["model"] for lane in lanes},
            "tasks": {t["id"]: {"type": t["type"], "sensitivity": t["sensitivity"]} for t in items}}
    (HERE / f"results-{day}.json").write_text(json.dumps({"meta": meta, "results": results}, indent=1, ensure_ascii=False))
    md = f"# Routing evals {day}\n\n{len(items)} tasks, {len(lanes)} lanes, {meta['seconds']}s wall, Claude usage ${meta['claude_usd']:.3f}.\n\n" + summary(results, items, lanes) + "\n"
    (HERE / f"results-{day}.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main()
