"""
Small coding-model bake-off on this Mac (M1 Pro, 16 GB): which local Ollama model should take light coding jobs?

    python3 coder_bakeoff.py qwen2.5-coder:3b qwen3.5:4b qwen3.5:9b

Each model gets the same 8 light coding jobs. Six are checked automatically by running the model's code against
tests; two (commit message, explanation) are checked for required facts. Measured per model: tasks passed, generation
speed (tokens/s), load time, resident memory (ollama ps) and the system's free-memory percentage while it ran.
Thinking is switched off (think: false): these are quick jobs, and thinking traces are slow and token-heavy.
Writes results-coder-<date>.json next to this file.
"""
from __future__ import annotations

import json, re, subprocess, sys, textwrap, time, urllib.request
from datetime import date
from pathlib import Path

API = "http://localhost:11434/api"

TASKS = [
    {"id": "slugify", "prompt": "Write a Python function slugify(s) that lowercases s, replaces every run of characters "
     "that are not a-z or 0-9 with a single hyphen, and strips hyphens from both ends. Reply with only the code.",
     "test": "assert slugify('Hello, World!') == 'hello-world'\nassert slugify('  --A  b__C-- ') == 'a-b-c'\nassert slugify('') == ''"},
    {"id": "duration", "prompt": "Write a Python function to_seconds(s) that converts strings like '1h30m', '45s', "
     "'2h', '1h2m3s' into a number of seconds (int). Reply with only the code.",
     "test": "assert to_seconds('1h30m') == 5400\nassert to_seconds('45s') == 45\nassert to_seconds('1h2m3s') == 3723\nassert to_seconds('2h') == 7200"},
    {"id": "fix_bug", "prompt": "This function should return the last n items of a list but has a bug. Return the "
     "fixed function only.\n\ndef last_n(xs, n):\n    if n <= 0:\n        return []\n    return xs[len(xs) - n - 1:]",
     "test": "assert last_n([1,2,3,4], 2) == [3,4]\nassert last_n([1,2], 5) == [1,2]\nassert last_n([1,2,3], 0) == []"},
    {"id": "regex", "prompt": "Write a Python function is_irish_mobile(s) using a regex that accepts Irish mobile numbers "
     "in the forms 0851234567, 085 123 4567 and +353851234567 (prefixes 083, 085, 086, 087, 089) and rejects anything "
     "else. Reply with only the code.",
     "test": "assert is_irish_mobile('0851234567')\nassert is_irish_mobile('085 123 4567')\nassert is_irish_mobile('+353851234567')\n"
             "assert not is_irish_mobile('0811234567')\nassert not is_irish_mobile('08512345')\nassert not is_irish_mobile('hello')"},
    {"id": "js_to_py", "prompt": "Convert this JavaScript to an equivalent Python function named group_by. Reply with "
     "only the code.\n\nfunction groupBy(xs, f) {\n  const out = {};\n  for (const x of xs) {\n    const k = f(x);\n"
     "    (out[k] ||= []).push(x);\n  }\n  return out;\n}",
     "test": "assert group_by([1,2,3,4], lambda x: x % 2) == {1: [1, 3], 0: [2, 4]}\nassert group_by([], len) == {}"},
    {"id": "json_fields", "prompt": "From this code, return ONLY a JSON object with keys \"function\" (its name), "
     "\"params\" (list of parameter names) and \"returns\" (the returned variable name).\n\n"
     "def merge_counts(a, b, keep_zero=False):\n    total = dict(a)\n    for k, v in b.items():\n"
     "        total[k] = total.get(k, 0) + v\n    return total",
     "json": {"function": "merge_counts", "params": ["a", "b", "keep_zero"], "returns": "total"}},
    {"id": "commit_msg", "prompt": "Write a one-line git commit message (max 72 characters, imperative mood) for this "
     "diff. Reply with only the message.\n\n--- a/scraper.py\n+++ b/scraper.py\n@@\n-    time.sleep(1)\n"
     "+    time.sleep(random.uniform(2.5, 5.0))   # LinkedIn rate-limits fast clients\n-RESULTS = 300\n+RESULTS = 200",
     "facts": [r"(sleep|delay|slow|pac|wait|rate)", r"(linkedin|rate|limit|result|200)"], "max_len": 72},
    {"id": "explain", "prompt": "In two sentences, explain what this code does.\n\n"
     "seen = set()\nuniq = [x for x in items if not (x in seen or seen.add(x))]",
     "facts": [r"(duplicate|unique|dedup|distinct)", r"(order|first|preserv|keep)"]},
]


def call(model, prompt):
    body = json.dumps({"model": model, "prompt": prompt, "stream": False, "think": False, "keep_alive": "2m",
                       "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 700}}).encode()
    req = urllib.request.Request(f"{API}/generate", data=body, headers={"Content-Type": "application/json"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    d["_wall"] = time.time() - t
    return d


def code_of(text):
    m = re.findall(r"```(?:python|py)?\s*\n(.*?)```", text, re.S)
    return (m[0] if m else text).strip()


def run_test(code, test):
    prog = "import re, json, math\n" + code + "\n\n" + test + "\nprint('OK')"
    try:
        p = subprocess.run([sys.executable, "-I", "-c", prog], capture_output=True, text=True, timeout=20)
        return p.stdout.strip().endswith("OK"), (p.stderr.strip().splitlines() or [""])[-1][:160]
    except subprocess.TimeoutExpired:
        return False, "timeout"


def check(task, text):
    if "test" in task:
        return run_test(code_of(text), task["test"])
    if "json" in task:
        try:
            got = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
            return got == task["json"], json.dumps(got)[:160]
        except Exception as ex:
            return False, f"bad JSON: {ex}"[:160]
    line = text.strip().strip("`\"'").splitlines()[0] if text.strip() else ""
    ok = all(re.search(f, text, re.I) for f in task["facts"]) and (len(line) <= task.get("max_len", 10**6))
    return ok, line[:160]


def free_mem_pct():
    out = subprocess.run(["memory_pressure"], capture_output=True, text=True).stdout
    m = re.search(r"free percentage:\s*(\d+)%", out)
    return int(m.group(1)) if m else None


def resident(model):
    out = subprocess.run(["ollama", "ps"], capture_output=True, text=True).stdout
    for line in out.splitlines()[1:]:
        if line.startswith(model):
            m = re.search(r"(\d+(?:\.\d+)?\s?GB)", line)
            return m.group(1) if m else ""
    return ""


def bench(model):
    print(f"\n=== {model}", flush=True)
    t = time.time()
    warm = call(model, "Reply with: ok")
    load_s = warm.get("load_duration", 0) / 1e9 or (time.time() - t)
    mem, free = resident(model), free_mem_pct()
    rows, tok, ns = [], 0, 0
    for task in TASKS:
        d = call(model, task["prompt"])
        ok, note = check(task, d.get("response", ""))
        tok += d.get("eval_count", 0); ns += d.get("eval_duration", 0)
        rows.append({"task": task["id"], "pass": ok, "note": note, "tokens": d.get("eval_count", 0),
                     "seconds": round(d["_wall"], 1)})
        print(f"  {'PASS' if ok else 'FAIL'}  {task['id']:<12} {d['_wall']:5.1f}s  {note[:90]}", flush=True)
    free_after = free_mem_pct()
    subprocess.run(["curl", "-s", f"{API}/generate", "-d", json.dumps({"model": model, "keep_alive": 0})],
                   capture_output=True)                                       # unload before the next model
    res = {"model": model, "passed": sum(r["pass"] for r in rows), "of": len(rows),
           "tok_per_s": round(tok / (ns / 1e9), 1) if ns else None, "load_s": round(load_s, 1),
           "resident": mem, "free_mem_pct_loaded": free, "free_mem_pct_after": free_after,
           "total_s": round(sum(r["seconds"] for r in rows), 1), "rows": rows}
    print(f"  -> {res['passed']}/{res['of']} passed | {res['tok_per_s']} tok/s | load {res['load_s']}s | "
          f"resident {mem} | free memory {free}% loaded, {free_after}% after | {res['total_s']}s total", flush=True)
    return res


if __name__ == "__main__":
    out = Path(__file__).with_name(f"results-coder-{date.today().isoformat()}.json")
    results = json.loads(out.read_text()) if out.exists() else []
    for m in sys.argv[1:]:
        results = [r for r in results if r["model"] != m] + [bench(m)]
        out.write_text(json.dumps(results, indent=1))
    print("\nSaved", out)
