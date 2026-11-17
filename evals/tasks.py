"""The routing test set: real small jobs, each with an automatic checker.

Each task has a `type` from the routing table (lookup, summarise, build, review, visual,
private-extract), a `sensitivity` (public, internal, client) and a checker that returns
(passed, note). Inputs that are Napkin's own files are read from the ollama-bench folder
(AO_BENCH_INPUTS overrides it) and never copied into this repo.
"""
import json
import os
import re
from pathlib import Path

INPUTS = Path(os.environ.get("AO_BENCH_INPUTS", "/Users/saieeshwar/Projects/Work/work/napkin/Claude outputs/ollama-bench/inputs"))


def read(name):
    return (INPUTS / name).read_text()


def words(text):
    return len(re.findall(r"\S+", text))


def strip_fence(text):
    m = re.search(r"```(?:json|python|py)?\s*\n(.*?)```", text, re.S)
    return (m.group(1) if m else text).strip()


def first_json(text):
    body = strip_fence(text)
    try:
        return json.loads(body)
    except ValueError:
        m = re.search(r"[\[{].*[\]}]", body, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


def ok(cond, note=""):
    return bool(cond), note


# ---------- checkers ----------

def check_commit(out):
    lines = out.strip().strip("`").strip().split("\n")
    subject = lines[0].strip()
    if not re.match(r"^[a-z][\w./-]*: [a-z]", subject):
        return ok(False, f"subject not '<area>: <imperative>': {subject[:60]}")
    if len(subject) > 72:
        return ok(False, f"subject {len(subject)} chars")
    if len(lines) < 3 or lines[1].strip():
        return ok(False, "no blank line then body")
    body = [l for l in lines[2:] if l.strip()]
    return ok(1 <= len(body) <= 6, f"{len(body)} body lines")


def check_diff_summary(out):
    bullets = [l for l in out.strip().split("\n") if re.match(r"^\s*[-*•]\s", l)]
    low = out.lower()
    if not 1 <= len(bullets) <= 3:
        return ok(False, f"{len(bullets)} bullets")
    if "seed" not in low:
        return ok(False, "does not mention the seed")
    return ok(words(out) <= 90, f"{words(out)} words")


def check_log(out):
    low = out.lower()
    if "moto" not in low:
        return ok(False, "does not name moto")
    if not re.search(r"install|requirements|dependenc", low):
        return ok(False, "no fix")
    return ok(len([l for l in out.strip().split("\n") if l.strip()]) <= 6, "too long")


def check_explain(out):
    bullets = [l for l in out.strip().split("\n") if re.match(r"^\s*(?:[-*•]|\d+\.)\s", l)]
    low = out.lower()
    if len(bullets) != 3:
        return ok(False, f"{len(bullets)} bullets")
    return ok(("shuffl" in low or "set a" in low) and words(out) <= 140, f"{words(out)} words")


def check_extract(out):
    try:
        data = first_json(out)
    except ValueError:
        return ok(False, "not JSON")
    keys = {"brand", "task", "audience", "single_minded_proposition", "mandatories", "deliverables"}
    if not isinstance(data, dict) or set(data) != keys:
        return ok(False, f"keys {sorted(data) if isinstance(data, dict) else type(data).__name__}")
    if not isinstance(data["mandatories"], list) or not isinstance(data["deliverables"], list):
        return ok(False, "lists are not lists")
    if data["brand"] != "Burger King":
        return ok(False, f"brand {data['brand']!r}")
    return ok("because fire is better" in str(data["single_minded_proposition"]).lower(), "proposition wrong")


def check_slack(out):
    if words(out) > 80:
        return ok(False, f"{words(out)} words")
    at = [out.find(f"#{n}") for n in (157, 243, 156, 166)]
    if min(at) < 0:
        return ok(False, "missing a PR")
    if at != sorted(at):
        return ok(False, "PRs out of the suggested order")
    return ok(not re.search(r"[\U0001F300-\U0001FAFF☀-➿]", out), "has emoji")


def contains(word):
    return lambda out: ok(word.lower() in out.lower(), f"no {word!r}")


def check_lookup_429(out):
    return ok(re.fullmatch(r"\W*429\W*", out.strip()) is not None, out.strip()[:40])


def check_lookup_git(out):
    return ok("git worktree list" in out and words(out) <= 12, out.strip()[:60])


def check_clamp(out):
    code = strip_fence(out)
    scope = {}
    try:
        exec(compile(code, "clamp", "exec"), scope)  # noqa: S102 - the checker runs the model's narrow edit
        f = scope["clamp"]
        assert f(5, 0, 3) == 3 and f(-1, 0, 3) == 0 and f(2, 0, 3) == 2 and f(3, 3, 3) == 3
        try:
            f(1, 3, 0)
        except ValueError:
            return ok(True)
        return ok(False, "no ValueError when lo > hi")
    except Exception as err:  # noqa: BLE001
        return ok(False, f"{type(err).__name__}: {str(err)[:60]}")


def check_regex(out):
    pattern = strip_fence(out).strip().strip("`").strip()
    pattern = re.sub(r"^r?(['\"])(.*)\1$", r"\2", pattern)
    try:
        rx = re.compile(pattern)
    except re.error as err:
        return ok(False, f"bad regex: {err}")
    good = ["2026-11-17", "1999-01-31", "2024-02-29"]
    bad = ["2026-13-01", "2026-1-01", "26-11-17", "2026-11-32", "x2026-11-17"]
    return ok(all(rx.fullmatch(s) for s in good) and not any(rx.fullmatch(s) for s in bad), "matches wrong strings")


JSON_IN = [
    {"id": "b2", "name": "Deck Maker", "owner": "sai", "open": True},
    {"id": "a1", "name": "Territory tool", "owner": "shrey", "open": False},
    {"id": "c3", "name": "Briefing", "owner": "sai", "open": True},
]
JSON_OUT = {"a1": {"name": "Territory tool", "owner": "shrey"}, "b2": {"name": "Deck Maker", "owner": "sai"}, "c3": {"name": "Briefing", "owner": "sai"}}


def check_reformat(out):
    try:
        return ok(first_json(out) == JSON_OUT, "different value")
    except ValueError:
        return ok(False, "not JSON")


SUBJECTS = ["add the deck export button", "stop the scan crashing on empty folders", "explain the RAG setup in the README", "bump pytest to 8.3", "handle a missing brand in the brief parser", "write the onboarding guide"]
KINDS = ["feat", "fix", "docs", "chore", "fix", "docs"]


def check_classify(out):
    try:
        data = first_json(out)
    except ValueError:
        return ok(False, "not JSON")
    got = [str(x).lower() for x in data] if isinstance(data, list) else []
    return ok(got == KINDS, f"got {got}")


BUGGY = '''def last_n(items, n):
    """The last n items, oldest first."""
    out = []
    for i in range(len(items) - n, len(items) + 1):
        out.append(items[i])
    return out
'''


def check_review(out):
    low = out.lower()
    return ok(("len(items) + 1" in out or "off-by-one" in low or "off by one" in low or "indexerror" in low) and words(out) <= 120, "missed the off-by-one")


def check_summary(out):
    low = out.lower()
    return ok("burger king" in low and ("flame" in low or "fire" in low) and words(out) <= 60, f"{words(out)} words")


# ---------- the set ----------

def tasks():
    diff, log, code, brief = read("diff.txt"), read("log.txt"), read("code.py"), read("brief.txt")
    vision = "List every piece of readable text, signage, logo or brand name visible in this image. If there is none, say 'none'. Be specific about where it is."
    return [
        dict(id="commit", type="summarise", sensitivity="internal", check=check_commit,
             prompt="Write a git commit message for this change. Format: a subject line of at most 72 characters in the form '<area>: <imperative summary>' (area in lower case), a blank line, then 2-3 short body lines saying why. Output only the message, no code fence.\n\n" + diff),
        dict(id="diff-summary", type="summarise", sensitivity="internal", check=check_diff_summary,
             prompt="Summarise what this diff changes in at most 3 short bullet points starting with '- '. Output only the bullets.\n\n" + diff),
        dict(id="log-triage", type="private-extract", sensitivity="internal", check=check_log,
             prompt="This is a failing pre-push check log. In 2-3 lines: what failed, the root cause, and the fix.\n\n" + log),
        dict(id="explain", type="summarise", sensitivity="internal", check=check_explain,
             prompt="Explain what this Python function does, in exactly 3 short bullet points for a teammate who has not seen it.\n\n" + code),
        dict(id="extract-json", type="private-extract", sensitivity="public", check=check_extract,
             prompt="From this creative brief, return JSON only, with exactly these keys: brand, task (one sentence), audience (one sentence), single_minded_proposition, mandatories (list), deliverables (list). Use only facts in the brief; write null when a field is not stated.\n\n" + brief),
        dict(id="brief-summary", type="summarise", sensitivity="public", check=check_summary,
             prompt="Summarise this brief in two sentences, under 50 words. Output only the summary.\n\n" + brief),
        dict(id="slack", type="summarise", sensitivity="internal", check=check_slack,
             prompt="Write a short, friendly Slack message from Sai to Shrey (a developer colleague). Plain English, no emojis, under 80 words. Points: four PRs into develop need his review (#157 small wording port, #243 Deck Maker gaps, #156 jev checks, #166 docs only); suggested order #157, #243, #156, then #166; all are green on CI. Output only the message."),
        dict(id="vision-text", type="visual", sensitivity="public", check=contains("Restaurant"), image="img-text.jpg", prompt=vision),
        dict(id="vision-logo", type="visual", sensitivity="public", check=contains("Guinness"), image="img-logo.jpg", prompt=vision),
        dict(id="lookup-http", type="lookup", sensitivity="public", check=check_lookup_429,
             prompt="Which HTTP status code means 'Too Many Requests'? Answer with the number only."),
        dict(id="lookup-git", type="lookup", sensitivity="public", check=check_lookup_git,
             prompt="Which git command lists every worktree of the current repository? Answer with the command only."),
        dict(id="edit-clamp", type="build", sensitivity="public", check=check_clamp,
             prompt="Change this function so it raises ValueError when lo > hi; keep its behaviour otherwise. Output only the whole updated function in one python code block.\n\n```python\ndef clamp(x, lo, hi):\n    return max(lo, min(x, hi))\n```"),
        dict(id="regex-date", type="build", sensitivity="public", check=check_regex,
             prompt="Write one Python regular expression that fully matches an ISO calendar date YYYY-MM-DD with month 01-12 and day 01-31 (no need to check days per month). Output only the pattern, nothing else."),
        dict(id="json-reformat", type="private-extract", sensitivity="internal", check=check_reformat,
             prompt="Reformat this JSON array into one JSON object keyed by id, each value holding only name and owner. Output JSON only.\n\n" + json.dumps(JSON_IN)),
        dict(id="classify", type="lookup", sensitivity="public", check=check_classify,
             prompt="Classify each commit subject as feat, fix, docs or chore. Output only a JSON array of the six labels, in order.\n\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(SUBJECTS))),
        dict(id="review-bug", type="review", sensitivity="public", check=check_review,
             prompt="Review this function for bugs. Name the bug and the fix in at most 3 lines.\n\n```python\n" + BUGGY + "```"),
    ]
