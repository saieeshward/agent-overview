"""Checks the checkers: each passes a known good answer and fails a known bad one.

Run: python3 evals/test_checkers.py (exits non-zero on a wrong verdict)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tasks as t  # noqa: E402

CASES = [
    (t.check_commit, "engine: vary the blind pack seed\n\nThe fixed seed put one arm in Set A.\nSeed it from the brief.", "Engine: Varied the seed. And more words here"),
    (t.check_diff_summary, "- Seeds the shuffle from the brief\n- Keeps as many pipeline cards as the plain prompt", "It changes things."),
    (t.check_log, "Collection failed: moto is not installed.\nFix: pip install moto in the test env.", "Tests failed, rerun them."),
    (t.check_explain, "- Picks the best cards\n- Shuffles the two arms\n- Labels them Set A and Set B", "It packs things."),
    (t.check_extract, '{"brand": "Burger King", "task": "x", "audience": "y", "single_minded_proposition": "BECAUSE FIRE IS BETTER", "mandatories": [], "deliverables": []}', '{"brand": "BK"}'),
    (t.check_summary, "Burger King wants younger people to choose flame-grilled burgers. Show why fire is better.", "A fast food brief."),
    (t.check_slack, "Hi Shrey, could you review #157, #243, #156 and then #166? All green on CI. Thanks, Sai", "Hi Shrey, review #166, #157 please"),
    (t.contains("Restaurant"), "The window sign says Restaurant.", "none"),
    (t.check_lookup_429, "429", "It is 429 Too Many Requests, defined in RFC 6585."),
    (t.check_lookup_git, "git worktree list", "ls"),
    (t.check_clamp, "```python\ndef clamp(x, lo, hi):\n    if lo > hi:\n        raise ValueError('lo > hi')\n    return max(lo, min(x, hi))\n```", "```python\ndef clamp(x, lo, hi):\n    return max(lo, min(x, hi))\n```"),
    (t.check_regex, r"\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])", r"\d{4}-\d{2}-\d{2}"),
    (t.check_reformat, '{"a1": {"name": "Territory tool", "owner": "shrey"}, "b2": {"name": "Deck Maker", "owner": "sai"}, "c3": {"name": "Briefing", "owner": "sai"}}', '{"a1": "Territory tool"}'),
    (t.check_classify, '["feat", "fix", "docs", "chore", "fix", "docs"]', '["feat", "fix", "docs", "chore"]'),
    (t.check_review, "Off-by-one: range goes to len(items) + 1, so items[len(items)] raises IndexError. Use range(len(items) - n, len(items)).", "Looks fine."),
]


def main():
    wrong = 0
    for check, good, bad in CASES:
        if not check(good)[0]:
            wrong += 1
            print("good answer failed:", check.__name__, check(good)[1])
        if check(bad)[0]:
            wrong += 1
            print("bad answer passed:", check.__name__)
    print(f"{len(CASES) * 2 - wrong}/{len(CASES) * 2} verdicts right")
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
