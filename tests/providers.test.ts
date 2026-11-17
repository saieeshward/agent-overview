import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { parseAgyUsage, parseCodexTokens, sessionRows } from '../hooks/cost'
import { externalOf, quotaOf, taskOf } from '../hooks/graph'
import { antigravityUsage, claudeModels, commandCodeUsage, parseCodex, parseOpencodeVerbose, plugins, tokens } from '../hooks/providers'
import { blank, defaultRouting, normalGuard, presetKey, withFlags } from '../hooks/state'
import type { Costs, Installed, Providers } from '../types'

const event = (input: number, cached = 0, output = 0) => JSON.stringify({ payload: { info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } })
const row = (input: number, cached = 0, output = 0, before = '') => `"model":"gpt"\t${event(input, cached, output)}\t${before}`
function fixture() {
  const state = { costs: { rows: [], claude: {}, agy: {} } as Costs, providers: Object.fromEntries(['claude', 'codex', 'opencode', 'commandcode', 'antigravity'].map(p => [p, blank()])) as Providers, prices: { catalog: { gpt: { input: 1, output: 1 } }, overrides: {} }, routing: defaultRouting(), installed: { plugins: [], tools: [], mcpServers: [], skills: 0 } as Installed }
  const saved: Record<string, unknown> = {}
  const data = { now: new Date(2026, 9, 20, 23).getTime(), chat: 'one', output: row(100), writes: 0, commands: [] as string[][], files: [] as { name: string; mtimeMs: number; kind?: string }[], bodies: {} as Record<string, string>, json: [] as unknown[] }
  let version = 0
  const api = {
    env: { get: async (name: string) => name === 'HOME' ? '/home/test' : undefined }, clock: { now: async () => data.now },
    session: { id: async () => data.chat, usage: async () => ({ context: {} }), model: async () => 'claude' },
    process: { run: async (argv: string[]) => { data.commands.push(argv); return { exitCode: 0, stdout: argv[0] === '/bin/sh' ? data.output : argv.includes('plugin') ? JSON.stringify(data.json) : '[]', stderr: '' } } },
    fs: { list: async () => data.files, read: async (path: string) => data.bodies[path] ?? '{}' },
    tool: { list: async () => [] },
    store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { data.writes++; saved[key] = value } },
    state: {
      get: async ({ key }: { key: keyof typeof state }) => ({ value: state[key], version }),
      set: async ({ key }: { key: keyof typeof state }, value: unknown) => { Object.assign(state, { [key]: value }); return { isSet: true, version: ++version } },
    },
  } as unknown as EngineInterface
  return { api, state, saved, data }
}

test('Codex subtracts each file before summing, including cached tokens and counter resets', async () => {
  const rows = parseCodexTokens([row(1300, 900, 250, event(1000, 800, 200)), row(50, 20, 10), row(10, 4, 2, event(100, 40, 20)), 'bad'].join('\n'))
  expect(rows).toEqual([{ provider: 'codex', model: 'gpt', period: 'today', input: 230, cacheRead: 120, output: 60, cacheWrite: 0 }])
  expect(parseAgyUsage('{"input_tokens":10,"output_tokens":2,"cache_read_tokens":30}')).toMatchObject({ input: 10, output: 2, cacheRead: 30 })
})

test('side baselines survive reloads per chat and never subtract yesterday after midnight', async () => {
  const { api, state, saved, data } = fixture()
  await tokens(api)
  expect(state.costs.base?.[0]?.input).toBe(100)
  const script = data.commands.find(c => c[0] === '/bin/sh')![2]!
  expect(script).toContain("find '/home/test/.codex/sessions' -name '*.jsonl' -newermt")
  expect(script).toContain(`-v c='${new Date(2026, 9, 20).toISOString().slice(0, 19)}'`)
  expect(script).toContain(`-newermt '${new Date(2026, 9, 20).toISOString().slice(0, 19).replace('T', ' ')} UTC'`)
  expect(script).toContain('substr($0,15,19)<c')
  expect(data.commands.find(c => c.includes('/usr/bin/sqlite3'))?.at(-1)).toContain("from message where json_extract(data,'$.role')='assistant' and time_created >= strftime('%s','now','localtime','start of day','utc')")
  data.output = row(150)
  state.costs = { rows: [], claude: {}, agy: {} }
  await tokens(api)
  expect(sessionRows(state.costs.rows, state.costs.base!)[0]?.input).toBe(50)
  expect(data.writes).toBe(1)
  data.now = new Date(2026, 9, 21, 0, 5).getTime()
  data.output = row(25)
  await tokens(api)
  expect(state.costs.base).toEqual([])
  data.output = row(150)
  await tokens(api)
  expect(sessionRows(state.costs.rows, state.costs.base!)[0]?.input).toBe(150)
  state.costs = { rows: [], claude: {}, agy: {} }
  data.chat = 'two'
  await tokens(api)
  expect(state.costs.base?.[0]?.input).toBe(150)
  expect(saved['base:one']).toMatchObject({ day: new Date(data.now).toDateString(), rows: [] })
  expect(saved['base:two']).toBeDefined()
})

test('Antigravity keeps an older unexpired quota hit behind newer models logs', async () => {
  const { api, state, data } = fixture()
  data.files = [{ name: 'cli-new.log', mtimeMs: data.now }, { name: 'cli-hit.log', mtimeMs: data.now - 3600000 }, { name: 'cli-old.log', mtimeMs: data.now - 3 * 3600000 }]
  data.bodies['/home/test/.gemini/antigravity-cli/log/cli-hit.log'] = 'RESOURCE_EXHAUSTED Resets in 2h'
  await antigravityUsage(api)
  expect(state.providers.antigravity.alert).toBe('quota hit · resets in 1h 0m')
  data.now += 2 * 3600000
  await antigravityUsage(api)
  expect(state.providers.antigravity.alert).toBeUndefined()
})

test('Command Code exposes a full active five-hour window and dates stale meters', async () => {
  const { api, state, data } = fixture()
  data.bodies['/home/test/Library/Application Support/Command Code/app-state.json'] = JSON.stringify({ accountCache: { fetchedAt: new Date(data.now - 7200000).toISOString(), result: { overview: { windowLimits: { fiveHour: { cap: 14, used: 14, resetAt: data.now + 60000 }, weekly: { cap: 30, used: 10, resetAt: 0 } }, usage: { totalCredits: 20 }, credits: { monthlyCredits: 80 } } } } })
  await commandCodeUsage(api)
  const info = state.providers.commandcode
  expect(info.meters.map(m => m.label)).toEqual(['Monthly', '5-hour'])
  expect(info.meters[1]?.percent).toBe(100)
  expect(info.meters.every(m => m.detail?.includes('as of'))).toBe(true)
  expect(info.note).toContain('2h 0m old')
  expect(quotaOf(info, 'commandcode')?.why).toBe('5-hour quota full')
})

test('model collectors keep real efforts, desktop catalogs, and loaded plugins only', async () => {
  expect(parseOpencodeVerbose('p/m\n{"variants":{"high":{},"xhigh":{}}}\np/none\n{"variants":{}}').map(m => m.efforts)).toEqual([['high', 'xhigh'], []])
  const stdout = [{ id: 2, result: { rateLimits: { primary: { usedPercent: 100 }, credits: { hasCredits: true, balance: '100' } } } }, { id: 3, result: { data: [{ id: 'gpt', supportedReasoningEfforts: ['low', 'max'], defaultReasoningEffort: 'low' }] } }].map(x => JSON.stringify(x)).join('\n')
  const info = parseCodex(stdout, [{ home: 'config', toml: 'model = "gpt"\nmodel_reasoning_effort = "max"' }], 0)
  expect(info.models[0]?.info).toContain('effort max (config)')
  expect(quotaOf({ ...blank(), ...info }, 'codex')).toBeUndefined()
  expect(quotaOf({ ...blank(), ...info, alert: 'limit reached: weekly' }, 'codex')?.why).toBe('limit reached: weekly')
  const { api, state, data } = fixture()
  data.files = [{ name: 'older-cc.json', mtimeMs: 1 }, { name: 'new-ccd.json', mtimeMs: 2 }, { name: 'tok-ignore-ccd.json', mtimeMs: 3 }]
  data.bodies['/home/test/.claude/cache/model-catalog/new-ccd.json'] = '{"catalog":{"config":{"models":[{"id":"desktop","section":"main"}]}}}'
  await claudeModels(api)
  expect(state.providers.claude.models[0]?.id).toBe('desktop')
  data.json = [{ id: 'ponytail@real', installPath: '/loaded', enabled: true }, { id: 'ponytail@synced', installPath: '/shadow', noteDetails: [{ type: 'synced-plugin-shadowed' }] }, { id: 'missing@synced', installPath: '' }, { id: 'agent-overview@inline', installPath: '/self' }]
  await plugins(api)
  expect(state.installed.plugins.filter(p => p.where === 'claude').map(p => p.name)).toEqual(['ponytail'])
})

test('side parsers skip all value flags, keep ps prompts, and read later config efforts', async () => {
  for (const flag of ['--add-dir', '--enable', '--disable', '--color', '--local-provider', '--thread-source', '--cyber-access-program']) expect(taskOf(`codex exec ${flag} "value with spaces" Do the task`)).toBe('Do the task')
  expect(externalOf('codex exec -c verbosity=low --config="model_reasoning_effort=max" "task"')).toMatchObject({ provider: 'codex', effort: 'max' })
  const head = "cat > task.md <<'EOF'\nNotes; codex exec is mentioned here\nEOF\n"
  const changed = withFlags(head + 'codex exec "<task>"', 'codex', { model: 'gpt', effort: 'max', disable: ['image_generation'] })
  expect(changed).toBe(head + 'codex exec -m gpt -c model_reasoning_effort=max --disable image_generation < /dev/null "<task>"')
  expect(withFlags(changed, 'codex', { model: 'gpt', effort: 'max', disable: ['image_generation'] })).toBe(changed)
  for (const cmd of ['codex exec "task" 0<task.md', 'codex exec "task"<task.md', 'codex exec - < task.md', 'codex exec "task" <task.md', 'codex exec "task" <<EOF\ninput\nEOF', 'echo prompt | codex exec "task"', 'codex exec -']) expect(withFlags(cmd, 'codex', {})).toBe(cmd)
  const r = defaultRouting()
  r.picks = [{ provider: 'codex', model: 'gpt' }]
  expect(presetKey(r) === presetKey({ ...r, picks: [{ ...r.picks[0]!, note: 'hard bugs' }] })).toBe(false)
})

test('Command Code exposes its cache timestamp when CLI auth is unavailable', async () => {
  const { api, state, data } = fixture()
  const allowed = '/home/test/Library/Application Support/Command Code/app-state.json', read = api.fs.read
  let reads = 0
  ;(api.fs as any).read = async (path: string) => { expect([allowed, '/home/test/.commandcode/auth.json'].includes(path)).toBe(true); reads++; return read(path) }
  const fetchedAt = data.now - 3 * 3600000
  data.bodies[allowed] = JSON.stringify({ accountCache: { fetchedAt, result: { overview: { usage: { totalCredits: 62 }, credits: { monthlyCredits: 38 } } } } })
  await commandCodeUsage(api)
  expect(reads).toBe(2)
  expect(state.providers.commandcode.usageAt).toBe(fetchedAt)
  expect(state.providers.commandcode.meters[0]?.percent).toBe(62)
})
