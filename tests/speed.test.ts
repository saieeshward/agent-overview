import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { ModelSpeeds, Routing } from '../types'
import { outputTokens } from '../hooks/cost'
import { codexOutput, loadSpeeds, normalSpeeds, parseCodexOutput, recordSpeed, speedKey, speedOf, withSpeedSample } from '../hooks/speed'
import { defaultRouting, handoffText, normalRouting, presetKey, routingText, withPicks } from '../hooks/state'
import { fixture, NOW } from '../tools/pane-fixtures'
import { CLAUDE_USAGE, CODEX_FILE, CODEX_OUTPUT, CODEX_ROLLOUT, SIDE_SPEEDS } from './speed-fixtures'

const sample = (outputTokens = 700, milliseconds = 10000) => ({ outputTokens, milliseconds })
const props = { title: 'Agent panel', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
function setup(on: On, crew = false) {
  const state = fixture({ area: crew ? 'vibe' : 'overview', tab: crew ? 'crew' : 'models', scenario: 'speeds-test' })
  state.modelSpeeds = {}
  const store: Record<string, any> = {}
  const files: Record<string, string> = {}
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/speed-test' })
  on('fs.list', (_$, e) => ({ value: Object.keys(files).filter(path => path.slice(0, path.lastIndexOf('/')) === e.path).map(path => ({ name: path.split('/').pop()!, kind: 'file' as const, size: files[path]!.length, mtimeMs: NOW, isLink: false })) }))
  on('fs.read', (_$, e) => { if (!(e.path in files)) throw new Error('missing file'); return { value: files[e.path]! } })
  on('session.id', () => ({ value: 'speeds' }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('store.get', (_$, e) => ({ value: copy(store[e.key] ?? null) }))
  on('store.set', (_$, e) => { store[e.key] = copy(e.value); return { value: undefined } })
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
  on('ui.invalidate', () => ({ value: undefined }))
  return { state, store, clock, files }
}

test('speed thresholds, 20-sample window, model aliases and weighted speed', () => {
  let all: ModelSpeeds = {}
  for (const s of [sample(199), sample(200, 1999), sample(NaN), sample(500, Infinity), sample(-1), sample(500, -1)]) all = withSpeedSample(all, 'm', s)
  expect(all).toEqual({})
  all = withSpeedSample(all, 'm', sample(200, 2000))
  expect(speedOf(all, 'm')).toEqual({ text: '100 tok/s', dim: true })
  all = withSpeedSample(all, 'm', sample(800, 10000))
  expect(speedOf(all, 'm')).toEqual({ text: '83 tok/s', dim: true })
  all = withSpeedSample(all, 'm', sample(700, 8000))
  expect(speedOf(all, 'm')).toEqual({ text: '85 tok/s', dim: false })
  expect(speedOf(all, 'absent')).toEqual({ text: '—', dim: true })
  for (let i = 0; i < 25; i++) all = withSpeedSample(all, 'other', sample(200 + i))
  expect(all.other).toHaveLength(20)
  expect(all.other![0]).toEqual(sample(205))
  expect(all.m).toHaveLength(3)
  expect(speedKey('anthropic/claude-haiku-4-5-20251001[1m]')).toBe('claude-haiku-4-5')
  expect(speedKey('gemini-4-argon-high')).toBe('gemini-4-argon-high')
  expect(normalSpeeds({ m: [null, sample(), sample(1)], bad: 1 })).toEqual({ m: [sample()] })
})

test('recording ignores the old store key, persists across sessions and merges queued samples', async () => {
  const saved: Record<string, any> = { modelSpeeds: { 'gpt-6.1-sol': [sample(156277)] } }
  const api = () => {
    let state: ModelSpeeds = {}
    return { store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { saved[key] = copy(value) } },
      state: { get: async () => ({ value: state, version: 0 }), set: async (_ref: unknown, value: ModelSpeeds) => { state = value; return { isSet: true, version: 1 } } }, ui: { invalidate: () => {} },
    } as unknown as EngineInterface
  }
  const first = api()
  expect(await loadSpeeds(first)).toEqual({})
  await recordSpeed(first, 'first', 700, 10000)
  const next = api()
  await loadSpeeds(next)
  await Promise.all([recordSpeed(next, 'first', 800, 10000), recordSpeed(next, 'second', 900, 10000)])
  expect(Object.keys(saved)).toEqual(['modelSpeeds', 'modelSpeeds2'])
  expect(saved.modelSpeeds2).toEqual({ first: [sample(), sample(800)], second: [sample(900)] })
})

test('output token fixtures only accept explicit output counts', () => {
  expect(outputTokens('{"output_tokens":600}\ntokens used\n9,999')).toBe(600)
  expect(outputTokens('tokens used\n9,999')).toBeUndefined()
  expect(outputTokens('{"input_tokens":9000}')).toBeUndefined()
  for (const f of SIDE_SPEEDS.filter(f => f.provider !== 'codex')) expect(outputTokens('stdout' in f.result ? f.result.stdout : JSON.stringify(f.result))).toBe(f.tokens)
})

test('Codex parser takes the last token_count total output and ignores unrelated or broken lines', () => {
  expect(parseCodexOutput(CODEX_ROLLOUT + '\n{"incomplete":')).toBe(1400)
  expect(parseCodexOutput('tokens used\n156,277')).toBeUndefined()
  for (const value of [null, '1400', -1, 1.5]) {
    expect(parseCodexOutput(CODEX_ROLLOUT + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { output_tokens: value } } } }))).toBeUndefined()
  }
})

test('Codex finder uses CODEX_HOME and both UTC dates, independent of the rollout timestamp', async () => {
  const start = Date.parse('2026-11-04T00:59:55+01:00'), end = start + 10000
  for (const date of ['2026/11/03', '2026/11/04']) {
    const listed: string[] = [], read: string[] = []
    const dir = `/custom/codex/sessions/${date}`
    const api = { env: { get: async (key: string) => key === 'CODEX_HOME' ? '/custom/codex' : '/unused' }, fs: {
      list: async (path: string) => { listed.push(path); if (path !== dir) throw new Error('no directory'); return [{ name: 'rollout-unrelated.jsonl', kind: 'file' }, { name: CODEX_FILE, kind: 'file' }] },
      read: async (path: string) => { read.push(path); return CODEX_ROLLOUT },
    } } as unknown as EngineInterface
    expect(await codexOutput(api, CODEX_OUTPUT, start, end)).toBe(1400)
    expect(read).toEqual([`${dir}/${CODEX_FILE}`])
    expect(listed).toEqual(date.endsWith('03') ? [dir] : ['/custom/codex/sessions/2026/11/03', dir])
  }
})

test('Codex lookup failures give no output count', async () => {
  const fail = async () => { throw new Error('unavailable') }
  const base = { env: { get: async () => '/custom/codex' }, fs: { list: async () => [{ name: CODEX_FILE, kind: 'file' }], read: async () => CODEX_ROLLOUT } }
  for (const api of [
    { ...base, env: { get: fail } },
    { ...base, fs: { ...base.fs, list: fail } },
    { ...base, fs: { ...base.fs, list: async () => [] } },
    { ...base, fs: { ...base.fs, read: fail } },
    { ...base, fs: { ...base.fs, read: async () => 'invalid json' } },
  ]) expect(await codexOutput(api as unknown as EngineInterface, CODEX_OUTPUT, NOW, NOW + 10000)).toBeUndefined()
  expect(await codexOutput({} as EngineInterface, 'tokens used\n156,277', NOW, NOW + 10000)).toBeUndefined()
})

test('main-turn model deltas exclude earlier usage and child output', async ($, on) => {
  const { state, store, clock } = setup(on)
  state.costs.claude = { [CLAUDE_USAGE.model]: { input: 0, output: 5000, cacheRead: 0, cacheWrite: 0 } }
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  await ($.turn as any).start({ text: 'task', turnId: 'main-speed' })
  await clock.advance(3000)
  await ($.turn as any).complete({ answer: 'child', durationMs: 3000, isAborted: false, turnId: 'workflow-child', agentId: 'workflow-child', reason: 'answer', usage: CLAUDE_USAGE })
  await clock.advance(7000)
  await ($.turn as any).complete({ answer: 'done', durationMs: 10000, isAborted: false, turnId: 'main-speed', reason: 'answer', usage: { ...CLAUDE_USAGE, output_tokens: 1000 } })
  expect(store.modelSpeeds2[CLAUDE_USAGE.model]).toEqual([sample(600, 3000), sample(1000, 10000)])
  await clock.advance(0)
})

test('Agent result usage records once even when turn.complete supplied it', async ($, on) => {
  const { store } = setup(on)
  on('tool.call', () => ({ result: { status: 'completed', agentId: 'agent-result', resolvedModel: 'claude-sonnet-5', usage: { output_tokens: 800 }, totalDurationMs: 4000 } } as any))
  await ($.tool as any).call({ tool: 'Agent', tool_use_id: 'agent-speed', description: 'task', prompt: 'task' })
  expect(store.modelSpeeds2['claude-sonnet-5']).toEqual([sample(800, 4000)])
  await ($.tool as any).call({ tool: 'Agent', tool_use_id: 'same-agent-speed', description: 'task', prompt: 'task' })
  expect(store.modelSpeeds2['claude-sonnet-5']).toHaveLength(1)
})

for (const f of SIDE_SPEEDS) test(`${f.provider} run records output tokens against its node duration`, async ($, on) => {
  const { state, store, clock, files } = setup(on)
  state.routing.agyCoding = true
  if (f.provider === 'codex') files[`/speed-test/.codex/sessions/${new Date(NOW).toISOString().slice(0, 10).replace(/-/g, '/')}/${CODEX_FILE}`] = CODEX_ROLLOUT
  on('tool.call', async () => { await clock.advance(10000); return { result: f.result } as any })
  const call = f.provider === 'antigravity'
    ? { tool: 'mcp__antigravity__gemini_bounded_task', tool_use_id: 'side-speed', task: 'task', model: f.model }
    : { tool: 'Bash', tool_use_id: 'side-speed', command: f.command }
  await ($.tool as any).call(call)
  expect(store.modelSpeeds2[speedKey(f.model)]).toEqual([sample(f.tokens)])
  await clock.advance(0)
})

for (const output of ['tokens used\n156,277', CODEX_OUTPUT]) test(`Codex run without rollout usage records no sample (${output.startsWith('session') ? 'missing log' : 'tokens used only'})`, async ($, on) => {
  const { store, clock } = setup(on)
  on('tool.call', async () => { await clock.advance(10000); return { result: { stdout: output, stderr: '' } } as any })
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'no-codex-usage', command: 'codex exec -m gpt-6.1-sol task' })
  expect(store.modelSpeeds2).toBeUndefined()
  await clock.advance(0)
})

test('optimize defaults, normalizes, distinguishes presets and adds only the requested routing line', () => {
  expect(defaultRouting().optimize).toBe('quality')
  for (const optimize of [undefined, null, '', 'fast', 5]) expect(normalRouting({ optimize }).optimize).toBe('quality')
  const speeds = { 'gpt-6.1-sol': [sample()] }
  const base = withPicks(defaultRouting(), [{ provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' }])
  for (const optimize of ['quality', 'balanced', 'speed'] as const) {
    const r = { ...base, optimize }
    expect(normalRouting(r).optimize).toBe(optimize)
    for (const text of [routingText(r, {}, [], {}, speeds), handoffText({ ...r, role: 'plan' }, speeds)!]) {
      expect(text).toContain('gpt-6.1-sol (xhigh) on Codex, 70 tok/s')
      expect(text.includes('Between models that suit a task equally, pick the faster.')).toBe(optimize === 'balanced')
      expect(text.includes('Prefer the fastest allowed model that can still do the task well.')).toBe(optimize === 'speed')
    }
    expect(routingText(r)).not.toContain('tok/s')
    if (optimize !== 'quality') expect(presetKey(r)).not.toBe(presetKey(base))
  }
})

for (const surface of ['desktop', 'terminal'] as const) for (const crew of [false, true]) test(`speed states and optimize persist per preset in ${crew ? 'Crew' : 'Models'} (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
  const { state, store } = setup(on, crew)
  const picks = state.routing.picks as Routing['picks']
  const models = [...new Set(picks.map(p => speedKey(p.model)))].slice(0, 3)
  state.modelSpeeds = { [models[1]!]: [sample()], [models[2]!]: [sample(), sample(), sample()] }
  store.presets = [{ name: 'A', routing: copy(state.routing) }, { name: 'B', routing: { ...copy(state.routing), optimize: 'balanced' } }]
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  for (const [i, model] of models.entries()) {
    const pick = picks.find(p => speedKey(p.model) === model)!
    const row = await ui.find({ key: `${crew ? 'crew:row' : 'pick'}:${pick.provider}/${pick.model}` })
    const walk = (n: any): any[] => n && typeof n === 'object' ? [n, ...(n.children ?? []).flatMap(walk)] : []
    const text = walk(row).find(n => n.type === 'Text' && n.children?.join('') === (i === 0 ? '—' : '70 tok/s'))
    expect(text).toBeDefined()
    expect(!!text.props.dimColor).toBe(i < 2)
  }
  await ui.press({ key: 'preset:saved:A' })
  await ui.press({ key: 'optimize:speed' })
  expect(store.presets.find((p: any) => p.name === 'A').routing.optimize).toBe('speed')
  await ui.press({ key: 'preset:saved:B' })
  expect(state.routing.optimize).toBe('balanced')
  await ui.press({ key: 'optimize:quality' })
  await ui.press({ key: 'preset:saved:A' })
  expect(state.routing.optimize).toBe('speed')
  expect(store.presets.find((p: any) => p.name === 'B').routing.optimize).toBe('quality')
  await ui.unmount()
})
