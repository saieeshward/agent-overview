# agent-overview: guide for coding agents

This repo is a **Claude Code mod**: a plugin made of function hooks. If you are an agent helping someone learn or change it, read this first, then `README.md` for install and run steps.

## What a mod is (60-second version)

- `.claude-plugin/plugin.json` is the manifest. `hooks/hooks.json` names the one entry module, `hooks/register.tsx`.
- `register(on, options)` adds hooks with `on(event, matcher?, hook)`. Every hook is `($, e, next)`:
  - `$` is the engine interface. Each call is spelled noun then method: `$.ui.open`, `$.tool.register`, `$.store.get`, `$.process.run`.
  - `e` is the event's frozen input.
  - `next(e)` passes the event down to plugins beneath and to the engine's own behavior. Return without calling `next` to answer for yourself. Call `next({ ...e, x })` to rewrite what the rest sees.
- There is **no Node and no DOM**. Everything outside the module (files, processes, HTTP, the clock) goes through `$`.
- JSX compiles against the global `h`. Elements come from `$.ui.resolve(e)`, for example `const { Box, Text, Button } = $.ui.resolve(e)`.
- **The API reference is the types.** Once the mod has loaded, the engine writes `.claude-plugin/types/` (gitignored). `claude-code/index.d.ts` holds every event, `$` method and element with doc comments. Grep it for the name you need (`'tool.call'`, `Pane: {`, `ToolCallResult`) rather than guessing.
- Session state uses `atom({ plugin: 'agent-overview', key }, initial)` with `read($, atom)` / `update($, atom, fn)`. Every key must be declared in `types/index.d.ts`, and `claude plugin validate` enforces it. State that should survive across sessions goes in `$.store.get/set`.
- A reload re-runs `register` and `session.start`. `$.state` and `$.store` survive it; module-level variables don't. New code must accept old stored values: normalize them, as `normalPolicy` in `hooks/policy.ts` does.

## Run, test, check

```sh
claude --plugin-dir .        # load from this folder; edits hot-reload when a turn ends
claude plugin validate .     # manifest, module, state contract
claude plugin test .         # tests/*.test.ts against the real engine
npx tsc -p .                 # type-check (needs .claude-plugin/types/, written on first load)
claude --plugin-dir . --debug   # a hook that fails is skipped; the debug log says why
```

Tests import `test`, `expect`, `mock` from `claude-code/testing`. Copy the shape of a nearby test, for example `tests/ollama.test.ts` or `tests/task-routing.test.ts`. UI tests mount a component on a named surface and loop over `['terminal', 'desktop']`.

## Code map

| Area | Files |
| --- | --- |
| Entry: state atoms, every hook registration, slash commands, model tools | `hooks/register.tsx` (large: grep it, don't read it end to end) |
| Panel drawing (Overview tabs: dashboard, agents, models, activity, plugins, settings) | `hooks/view.tsx`, `hooks/ui.tsx`, `hooks/switches.tsx`, `hooks/presets.tsx`, `hooks/policy-view.tsx` |
| Routing: providers, the task table, sensitivity, fallbacks | `hooks/state.ts` (routing defaults, handoff text), `hooks/policy.ts` (task table, declarations, client-material rules), `hooks/escalate.ts` (side lane fails → one Claude model), `hooks/auto.ts` |
| Providers, usage and cost | `hooks/providers.ts` (Ollama at `127.0.0.1:11434`, quota, model lists), `hooks/cost.ts`, `hooks/speed.ts` |
| Free cloud API lane (`free_run`: Cerebras, Groq, OpenRouter; public-only) | `hooks/freeapi.ts` (providers, fallback chain), `freeTool` in `hooks/register.tsx`, keys from `userConfig` in `plugin.json`, `tests/freeapi.test.ts` |
| Gemini / Antigravity lane | `hooks/gemini.ts` (`agy -p --sandbox --mode plan` from an empty temp folder), `hooks/agyguard.ts` (vets shell commands that would run agy) |
| Agents graph and live edits | `hooks/graph.ts`, `hooks/stream.ts`, `hooks/babysitter.ts` |
| Work mode (Plan → Implement → Review → Ship) | `hooks/work/*`, `hooks/modes.ts` |
| Vibe mode | `hooks/vibe/*` |
| Things drawn in the chat itself (bands, permission rows, look, sounds) | `hooks/chat-surfaces.tsx`, `hooks/chat-look.tsx`, `hooks/chat-permission.ts`, `hooks/chat-art.ts`, `hooks/office-rail.tsx`, `sounds/` |
| Adversarial review (`/review-adversarial`, `adversary` agent) | `hooks/adversarial.ts` |
| Worktree cleanup (`/clean-worktrees`) | `hooks/worktrees.ts` |
| Self-check that hooks fired | `hooks/hookcheck.tsx` |
| State contract | `types/index.d.ts` |
| Dev-only render/capture scripts | `tools/` |
| Routing evals (Python) and past review rounds | `evals/`, `reviews/` |

## Conventions in this repo

- **Every behavior change comes with a test** in `tests/`. Fixes from a review round are pinned by tests named after the round (`round1-*.test.ts`, `fix3-*.test.ts`).
- **Privacy rules are load-bearing.** Material marked `client` never goes to Gemini or any cloud side lane. `gemini_run` is public-only, because the `agy` sandbox isn't proven to stop reads outside its folder. Side lanes **fail closed** on unknown or undeclared agents. Don't weaken these without the owner's explicit say-so, and add a test when you touch them (`tests/*privacy*`, `tests/confidential.test.ts`, `tests/guard.test.ts`).
- **Defaults come from evals.** When you change a model default in `hooks/policy.ts`, put the eval result behind it in the comment and the commit message, as the existing ones do.
- **Comments say why, not what**, in plain sentences.
- **User-facing text is plain English**: short sentences, no jargon.
- **Commit messages** take the form `area: what changed and why, in one plain sentence`. Examples: `routing: an explicit model on an Agent call wins over the table`, `ollama: qwen2.5-coder:3b replaces qwen3.5:9b (...)`.
- Work on a branch and open a PR against `main`. Run `claude plugin validate .` and `claude plugin test .` before you push.

## Known rough edges (good first changes)

- **The owner's name is hardcoded.** The adversarial-review texts say "Sai" and "he" (`hooks/state.ts`, `hooks/register.tsx`, `hooks/adversarial.ts`, and the tests that assert them). For anyone else who installs the mod, they should follow whoever uses it: for example a `userConfig` option in `plugin.json` read from `options`, or neutral wording.
- `tests/confidential.test.ts` and `tests/round1-privacy.test.ts` use the owner's paths and project names as fixtures. That's harmless, but generic names would read better.
- Providers that aren't set up on a machine (Codex, OpenCode, Command Code) still have slots in the state. The panel shows them as missing.
- `claude plugin validate` warns that the plugin has no icon (`.claude-plugin/icon.png`, square, 512–2048 px).

- `free_run` is a tool only: it is **not yet a lane in the routing table** (`Lane` in `types/index.d.ts` is `claude | ollama | gemini`), so it has no row in the panel's Models tab, no route log entry and no task-table default. Adding those, plus a `free` row in the evals (`evals/run.py`), is the next step. Don't make it a default until the eval says it's good.

## Getting oriented fast

1. Install the mod, open a session, run `/default`, and click through the tabs and the three modes (Overview, Work, Vibe).
2. Search `hooks/register.tsx` for `on('` to see every event the mod hooks, and for `$.tool.register` / `$.command.register` to see what it adds.
3. Pick one small feature (for example `decision_log` → where it lands in the panel), follow it from registration to drawing, and run its test.
