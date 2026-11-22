"""
Planted-bug review bake-off: which reviewers do we have, and which pair catches the most?

    python3 review_bakeoff.py prompt                 # writes review_prompt.txt (markers stripped)
    python3 review_bakeoff.py claude claude-opus-5-5 opus-a
    python3 review_bakeoff.py ollama qwen2.5-coder:3b qwen3b
    python3 review_bakeoff.py score                  # scores every review-answers/<name>.txt, pairs too

Six small Python files written for this test (public, so Gemini may see them), 12 planted bugs marked `# BUG:` in
the source below; the markers are stripped before any reviewer sees the code. A planted bug counts as found when a
finding names its file and a line within 1 of it. Findings that match no planted bug are listed as "other" (some may
be real issues the test did not plant: they are not counted as wrong).
"""
from __future__ import annotations

import itertools, json, re, subprocess, sys, tempfile, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ANS = HERE / "review-answers"

FILES = {
"paginate.py": '''def paginate(items, page, per_page=10):
    """Return the items on a 1-indexed page."""
    start = page * per_page  # BUG: off-by-one, page 1 skips the first page (should be (page - 1) * per_page)
    end = start + per_page
    return items[start:end]


def total_pages(n_items, per_page=10):
    return n_items // per_page  # BUG: rounds down, a partial last page is lost
''',
"cache.py": '''import time


class Cache:
    def __init__(self, ttl=60, store={}):  # BUG: mutable default shared by every Cache
        self.ttl = ttl
        self.store = store

    def get(self, key):
        if key in self.store:
            value, at = self.store[key]
            if time.time() - at < self.ttl:
                return value
        return None

    def set(self, key, value):
        self.store[key] = (value, time.time)  # BUG: stores the function, not the time (missing call)
''',
"users.py": '''import sqlite3


def find_user(db_path, username):
    conn = sqlite3.connect(db_path)
    cur = conn.execute(f"SELECT id, email FROM users WHERE name = '{username}'")  # BUG: SQL injection
    row = cur.fetchone()
    return row  # BUG: connection never closed
''',
"scores.py": '''def average_scores(path):
    total = 0
    count = 0
    for line in open(path):  # BUG: file handle never closed
        name, score = line.split(",")
        total += int(score)
        count += 1
    return total / count  # BUG: ZeroDivisionError on an empty file
''',
"counter.py": '''import threading

counter = 0


def worker(n):
    global counter
    for _ in range(n):
        counter += 1  # BUG: data race, no lock around the read-modify-write


def run(threads=4, n=100000):
    ts = [threading.Thread(target=worker, args=(n,)) for _ in range(threads)]
    for t in ts:
        t.start()
    return counter  # BUG: threads never joined before reading the result
''',
"tokens.py": '''import hashlib
import hmac
import time

SECRET = b"change-me"


def make_token(user, expires):
    sig = hmac.new(SECRET, f"{user}:{expires}".encode(), hashlib.sha256).hexdigest()
    return f"{user}:{expires}:{sig}"


def check_token(token):
    user, expires, sig = token.split(":")
    good = hmac.new(SECRET, f"{user}:{expires}".encode(), hashlib.sha256).hexdigest()
    if sig == good:  # BUG: non-constant-time comparison (timing attack); use hmac.compare_digest
        return user  # BUG: returns before the expiry is checked, so expired tokens are accepted
    if int(expires) < time.time():
        return None
    return None
''',
}

FILES_R2 = {
"retry.py": """import random
import time


def fetch_with_retry(fetch, attempts=3, base_delay=0.5):
    \"\"\"Call fetch() up to `attempts` times, backing off exponentially between tries.\"\"\"
    delay = base_delay
    for attempt in range(attempts):
        try:
            return fetch()
        except Exception:
            if attempt == attempts:  # BUG: never true (last attempt is attempts - 1), so the final error is swallowed and None returned
                raise
            time.sleep(delay + random.random() * 0.1)
            delay *= 2
""",
"handlers.py": """def make_handlers(events):
    handlers = {}
    for name in events:
        handlers[name] = lambda payload: f"{name}: {payload}"  # BUG: late binding, every handler reports the last name
    return handlers


def dispatch(handlers, name, payload):
    handler = handlers.get(name)
    return handler(payload) if handler else None
""",
"dates.py": """from datetime import datetime, timezone


def log_event(message, at=datetime.now()):  # BUG: default evaluated once at import, every event gets the same time
    return f"{at.isoformat()} {message}"


def is_expired(expires_at_iso):
    expires = datetime.fromisoformat(expires_at_iso)
    return expires < datetime.now(timezone.utc)  # BUG: TypeError comparing a naive datetime (no offset in the string) with an aware one
""",
"files.py": """import os

BASE = "/srv/public"


def read_public(name):
    path = os.path.join(BASE, name)  # BUG: path traversal, '../' or an absolute name escapes BASE
    with open(path, encoding="utf-8") as f:
        return f.read()


def save_upload(name, data):
    path = os.path.join(BASE, "uploads", name)
    if not os.path.exists(path):
        with open(path, "w") as f:  # BUG: check-then-create race (TOCTOU); open(path, "x") is atomic
            f.write(data)
""",
"inventory.py": """def remove_empty(stock):
    for item, qty in stock.items():
        if qty == 0:
            del stock[item]  # BUG: RuntimeError, dict changes size during iteration
    return stock


def same_sku(a, b):
    return a is b  # BUG: identity, not equality; equal strings built at runtime are different objects
""",
"stream.py": """def read_rows(path):
    with open(path) as f:
        for line in f:
            yield line.rstrip("\\n").split(",")


def summarise(path):
    rows = read_rows(path)
    count = sum(1 for _ in rows)
    total = sum(float(r[1]) for r in rows)  # BUG: the generator is already exhausted, so total is always 0
    return count, (total / count if count else 0)
""",
"poll.py": """import asyncio
import time


async def poll(check, interval=1.0, timeout=10.0):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if await check():
            return True
        time.sleep(interval)  # BUG: blocks the event loop; should be await asyncio.sleep(interval)
    return False


async def poll_all(checks):
    results = [poll(c) for c in checks]  # BUG: coroutines are created but never awaited or gathered
    return results
""",
"search.py": """def find_first_at_least(xs, target):
    \"\"\"Index of the first element >= target in sorted xs, or len(xs) if there is none.\"\"\"
    lo, hi = 0, len(xs) - 1  # BUG: hi should be len(xs); returns len(xs) - 1 when every element is smaller
    while lo < hi:
        mid = (lo + hi) // 2
        if xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo
""",
}


import os as _os
if _os.environ.get("REVIEW_ROUND") == "2":
    FILES = FILES_R2
    ANS = HERE / "review-answers-r2"


def planted():
    out = []
    for f, src in FILES.items():
        for i, line in enumerate(src.splitlines(), 1):
            m = re.search(r"#\s*BUG:\s*(.*)$", line)
            if m:
                out.append({"file": f, "line": i, "what": m.group(1)})
    return out


def clean(src):
    return "\n".join(re.sub(r"\s*#\s*BUG:.*$", "", l) for l in src.splitlines()) + "\n"


def prompt():
    parts = ["You are an adversarial code reviewer. Find every real bug in these Python files: correctness, "
             "security, resource handling and concurrency. Ignore style and naming. Be specific.\n",
             'Return ONLY a JSON array, one object per bug: {"file": "<name>", "line": <line number>, "issue": "<one sentence>"}.\n']
    for f, src in FILES.items():
        numbered = "\n".join(f"{i:>3}| {l}" for i, l in enumerate(clean(src).splitlines(), 1))
        parts.append(f"\n=== {f} ===\n{numbered}\n")
    return "".join(parts)


def run_claude(model, name):
    with tempfile.TemporaryDirectory() as tmp:
        p = subprocess.run(["claude", "-p", "--model", model, "--output-format", "json", "--tools", "",
                            "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
                            "--mcp-config", '{"mcpServers":{}}'], input=prompt(), capture_output=True, text=True,
                           cwd=tmp, timeout=900)
    d = json.loads(p.stdout)
    save(name, str(d.get("result", "")))


def run_ollama(model, name):
    body = json.dumps({"model": model, "prompt": prompt(), "stream": False, "keep_alive": "1m",
                       "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 2000}}).encode()
    req = urllib.request.Request("http://localhost:11434/api/generate", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        save(name, json.load(r).get("response", ""))


def save(name, text):
    ANS.mkdir(exist_ok=True)
    (ANS / f"{name}.txt").write_text(text)
    print(f"saved {name}: {len(text)} chars")


def findings(text):
    m = re.search(r"\[.*\]", text, re.S)
    try:
        items = json.loads(m.group(0)) if m else []
    except json.JSONDecodeError:
        items = [{"file": f, "line": int(l), "issue": ""} for f, l in re.findall(r'"file"\s*:\s*"([^"]+)"\s*,\s*"line"\s*:\s*(\d+)', text)]
    return [x for x in items if isinstance(x, dict) and "file" in x and str(x.get("line", "")).isdigit() or isinstance(x.get("line"), int)]


# A leak or a missing join is as fair to flag where the resource is made as where it is left behind.
SPAN = {("users.py", 8): range(5, 9), ("counter.py", 16): range(13, 17), ("files.py", 15): range(14, 17), ("stream.py", 10): range(8, 11)}


def caught(items, bugs):
    """Each finding counts for at most one planted bug: the nearest one in its file, within 1 line."""
    hit = set()
    for x in items:
        near = [(0 if int(x["line"]) in SPAN.get((b["file"], b["line"]), ()) else abs(int(x["line"]) - b["line"]), k)
                for k, b in enumerate(bugs) if str(x.get("file", "")).endswith(b["file"])]
        near = [n for n in near if n[0] <= 1]
        if near:
            hit.add(min(near)[1])
    return hit


def score():
    bugs = planted()
    res = {}
    for f in sorted(ANS.glob("*.txt")):
        items = findings(f.read_text())
        hit = caught(items, bugs)
        other = [x for x in items if not caught([x], bugs)]
        res[f.stem] = hit
        print(f"{f.stem:<14} {len(hit):>2}/{len(bugs)} planted bugs | {len(items)} findings, {len(other)} other")
        for k, b in enumerate(bugs):
            if k not in hit:
                print(f"{'':16}missed {b['file']}:{b['line']} {b['what'][:70]}")
    print("\nPairs (bugs caught by either):")
    for a, b in sorted(itertools.combinations(res, 2), key=lambda p: -len(res[p[0]] | res[p[1]])):
        print(f"  {a} + {b}: {len(res[a] | res[b])}/{len(bugs)}")
    (HERE / ("results-review-r2-2026-11-22.json" if FILES is FILES_R2 else "results-review-2026-11-22.json")).write_text(json.dumps({k: sorted(v) for k, v in res.items()} | {"planted": bugs}, indent=1))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "prompt":
        (HERE / ("review_prompt_r2.txt" if FILES is FILES_R2 else "review_prompt.txt")).write_text(prompt()); print(f"{len(planted())} planted bugs; prompt written")
    elif cmd == "claude":
        run_claude(sys.argv[2], sys.argv[3])
    elif cmd == "ollama":
        run_ollama(sys.argv[2], sys.argv[3])
    elif cmd == "score":
        score()
