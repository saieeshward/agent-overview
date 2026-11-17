export const CODEX_SESSION = '019a503c-1234-5678-9abc-123456789abc'
export const CODEX_OUTPUT = `session id: ${CODEX_SESSION}\ntokens used\n156,277`
export const CODEX_FILE = `rollout-2026-11-03T23-59-55-${CODEX_SESSION}.jsonl`
export const CODEX_ROLLOUT = [
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { output_tokens: 600 }, last_token_usage: { output_tokens: 600 } } } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 154877, cached_input_tokens: 140000, output_tokens: 1400, reasoning_output_tokens: 800, total_tokens: 156277 }, last_token_usage: { output_tokens: 800 } } } }),
  JSON.stringify({ type: 'response_item', payload: { output_tokens: 9999 } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }),
].join('\n')

export const SIDE_SPEEDS = [
  { provider: 'codex', model: 'gpt-6.1-sol', command: 'codex exec -m gpt-6.1-sol task', result: { stdout: 'done', stderr: CODEX_OUTPUT }, tokens: 1400 },
  { provider: 'opencode', model: 'kimi-k3', command: 'opencode run -m kimi-k3 task', result: { stdout: '{"usage":{"completion_tokens":800}}', stderr: '' }, tokens: 800 },
  { provider: 'commandcode', model: 'deepseek-v4', command: 'commandcode -p -m deepseek-v4 task', result: { stdout: '{"outputTokens":1000}', stderr: '' }, tokens: 1000 },
  { provider: 'antigravity', model: 'gemini-4-argon-high', result: { usage: { candidatesTokenCount: 1200 } }, tokens: 1200 },
] as const
export const CLAUDE_USAGE = { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 600, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }
