# Routing evals

`run.py` runs `tasks.py` against each lane and writes `results-<date>.md` and `.json`. `test_checkers.py` tests the checkers.

## Caveats (adversarial review round 1, finding 16)

Read the results as a first look, not as a ranking.

- **Small sample.** 16 tasks, one run each, no repeats. One flaky answer moves a lane by 6 points, and the per-type counts are 1 to 5 tasks. The `visual` row is 2 tasks.
- **Loose checkers.** Most tasks pass on a keyword or a shape (a regex, a count of lines or labels), not on a reading of the answer. A lane can pass with a wrong or lazy answer.
- **No `design` eval.** The `design` row of the routing table (Claude Opus at high effort) is a decision, not a measurement.
- **Timing is one run.** Gemini's 17 to 24 s on visual tasks against Ollama's 1 to 5 s is a single sample on one day, and includes the Antigravity CLI's start-up.
- **What `visual` does with it.** Ollama passed visual 2/2, faster and without leaving the Mac, so the `visual` default is Ollama. Gemini is used for **public** images only (the table's default is then replaced by `gemini_run`; an owner's own `visual` row is never replaced). Client and internal images always stay on Ollama.
- **Gemini is public only for another reason too.** Whether `agy -p --sandbox --mode plan` can read files outside its working folder is not proven (see `hooks/gemini.ts`), so `gemini_run` takes public material only.

To make the numbers firmer: run each task 3 to 5 times, add a second checker per task that compares meaning (for example, an LLM judge on Sonnet), and add a few `design` tasks scored by the owner.
