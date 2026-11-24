# agent-overview

A Claude Code mod that adds an **Agent panel** beside the chat, plus routing and review tools the model can call.

- **Overview**: a graph of running agents grouped by model, a live view of edits as they stream, usage and cost per provider, installed plugins, and settings.
- **Model routing**: sends each delegated task to Claude, Ollama (local) or Gemini (through the Antigravity CLI), based on a task table (`lookup`, `summarise`, `build`, `design`, `review`, `visual`, `private-extract`) and how sensitive the material is (`public`, `internal`, `client`). Client material never goes to a cloud side lane.
- **Work mode**: Plan → Implement → Review → Ship stages, with a review queue.
- **Vibe mode**: a playful live view of the session (office or arcade style).
- **Tools for the model**: `qa_log`, `decision_log`, `review_log`, `ollama_run`, `gemini_run`, `free_run`, `adversarial_review`.
- **Slash commands**: `/default` and `/overview` open the panel. `/clean-worktrees` lists and prunes worktrees. `/review-adversarial` runs an on-request adversarial review.

## Install (to use it)

At the prompt of a Claude Code terminal session:

```
/plugin install agent-overview --marketplace saieeshward/agent-overview
```

Answer `y` to add the marketplace, then pick the user scope. From a shell, use `claude plugin install agent-overview --marketplace saieeshward/agent-overview` instead.

To open the panel, run `/default` (or `/overview`). It opens on its own when the terminal is wide enough (144+ columns).

**Optional side lanes:**
- **Ollama**: install [Ollama](https://ollama.com), then run `ollama pull qwen2.5-coder:3b`. The panel finds it at `127.0.0.1:11434`.
- **Antigravity / Gemini**: install the Antigravity CLI (`agy`) and sign in. `gemini_run` takes public material only.

- **Free cloud APIs** (`free_run`): get a free key from [Cerebras](https://cloud.cerebras.ai), [Groq](https://console.groq.com) and/or [OpenRouter](https://openrouter.ai/keys) and paste it into the mod's options (`/config`, the agent-overview rows: `cerebrasApiKey`, `groqApiKey`, `openrouterApiKey`). Keys are stored as secrets. The tool tries each provider that has a key, fastest first, and moves on when one is rate-limited. It takes **public material only** (free tiers may train on prompts). Free-tier model ids change without notice, so the model defaults in `hooks/freeapi.ts` may need a refresh.

None of these is required. Without them, everything routes to Claude.

## Develop (to change it)

```sh
git clone https://github.com/saieeshward/agent-overview.git
cd agent-overview
claude --plugin-dir .            # loads the mod from this folder; saves hot-reload it
```

Don't also keep the marketplace install enabled while you develop. Two copies of the same mod would both load.

| Task | Command |
| --- | --- |
| Validate manifest + module | `claude plugin validate .` |
| Run the tests (`tests/*.test.ts`) | `claude plugin test .` |
| Type-check | `npx tsc -p .` (after the mod has loaded once: the engine writes `.claude-plugin/types/`) |
| Debug a hook that does nothing | `claude --plugin-dir . --debug` and read the debug log |
| Routing evals (needs Ollama / agy) | `python3 evals/run.py` (see `evals/README.md`) |

See [`CLAUDE.md`](CLAUDE.md) for the code map and conventions. It's written for coding agents, but it's a good read for people too.
