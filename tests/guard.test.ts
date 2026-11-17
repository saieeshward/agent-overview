import { expect, mock, test } from 'claude-code/testing'

import { spendBy } from '../hooks/cost'
import { quotaOf, resetIn, scorecard } from '../hooks/graph'
import { BUILT_IN, blank, defaultRouting, demote, handoffText, presetKey, routingText, withPicks } from '../hooks/state'
import { hunk } from '../hooks/stream'
import type { HistoryItem, ProviderInfo } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = (bodyColumns: number) => ({
  title: 'Overview', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {},
})
const info = (extra: Partial<ProviderInfo>): ProviderInfo => ({ status: 'ok', meters: [], facts: [], models: [], ...extra })

test('quota: an alert or a full meter, with its reset time when known', async () => {
  expect(resetIn('quota hit · resets in 2h 5m')).toBe(2 * 3600000 + 5 * 60000)
  expect(resetIn('resets in 3d 4h')).toBe(3 * 86400000 + 4 * 3600000)
  expect(resetIn('fine')).toBeUndefined()
  expect(resetIn('resets in 30s')).toBe(30000)
  expect(resetIn('reset after 0.25s')).toBe(250)
  expect(resetIn('resets in 0s')).toBe(60000)
  expect(resetIn('reset after 0m')).toBe(60000)
  expect(quotaOf(info({ meters: [{ label: 'Weekly', percent: 40 }] }))).toBeUndefined()
  expect(quotaOf(info({ meters: [{ label: 'Context', percent: 100 }] }))).toBeUndefined()
  expect(quotaOf(info({ meters: [{ label: 'Weekly', percent: 100, detail: 'resets in 40m' }] }))).toEqual({ why: 'Weekly quota full', wait: 40 * 60000 })
  expect(quotaOf(info({ alert: 'quota hit · its run said so' }))).toEqual({ why: 'quota hit · its run said so', wait: undefined })
})

test('the scorecard counts tasks, failures and redos per model', async () => {
  const it = (label: string, model: string, at: number, state: 'done' | 'failed' = 'done'): HistoryItem => ({ at, label, model, state, ms: 1000 })
  const s = scorecard([
    it('Build: the header bar', 'gpt-6.1-sol', 0, 'failed'),
    it('Build: the header bar again', 'claude-opus-5-5', 60000),
    it('summarise the log', 'gpt-6.1-sol', 120000),
  ])
  expect(s.find(x => x.model === 'gpt-6.1-sol')).toEqual({ model: 'gpt-6.1-sol', provider: undefined, tasks: 2, failed: 1, redone: 1, avgMs: 1000 })
  expect(s.find(x => x.model === 'claude-opus-5-5')!.redone).toBe(0)
})

test('a hunk keeps only the changed stretch and a little context', async () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const after = ['a', 'b', 'c', 'X', 'e', 'f', 'g']
  expect(hunk(before, after, 1)).toEqual({ before: ['c', 'd', 'e'], after: ['c', 'X', 'e'], removed: 1, added: 1 })
  expect(hunk([], ['new'], 2)).toEqual({ before: [], after: ['new'], removed: 0, added: 1 })
})

test('over a spend cap a provider is used last; presets reorder the mix', async () => {
  const r = withPicks(defaultRouting(), [
    { provider: 'codex', model: 'gpt-6.1-sol' },
    { provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  ])
  expect(demote(r, ['codex']).picks.map(x => x.provider)).toEqual(['opencode', 'codex'])
  const text = routingText(r, {}, [{ p: 'codex', spent: 5.2, cap: 5 }])
  expect(text).toContain('1. opencode-go/deepseek-v4.1-flash on OpenCode, 2. gpt-6.1-sol on Codex')
  expect(text).toContain('Codex ($5.20 of $5)')
  expect(routingText({ ...r, on: { ...r.on, codex: false }, paused: { codex: { why: 'quota', at: 0, until: 1 } } })).toContain('Paused automatically after running out of quota: Codex')
  const cheap = BUILT_IN.find(b => b.name === 'Cheap')!.apply(r)
  expect(cheap.picks.map(x => x.provider)).toEqual(['opencode', 'codex'])
  const best = BUILT_IN.find(b => b.name === 'Max quality')!.apply
  expect(presetKey(best(best(r)))).toBe(presetKey(best(r)))
  expect(best(r).order[0]).toBe('codex')
  expect(BUILT_IN.map(b => b.name)).toEqual(['Cheap', 'Max quality'])
})

test('daily spend: Command Code counts from this morning, the rest as the cost card shows', async () => {
  const c = {
    rows: [{ provider: 'commandcode' as const, model: 'm', period: 'period' as const, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reported: 12 }],
    claude: {}, agy: {},
  }
  const pr = { catalog: {}, overrides: {} }
  expect(spendBy(c, pr, { day: 'Mon', value: 10 }, 'Mon').commandcode).toBe(2)
  expect(spendBy(c, pr, { day: 'Sun', value: 10 }, 'Mon').commandcode).toBeUndefined()
  expect(spendBy(c, pr, { day: 'Mon', value: 20 }, 'Mon').commandcode).toBe(12)
  expect(spendBy(c, pr, { day: 'Mon', value: 12 }, 'Mon').commandcode).toBe(0)
})

test('the Plans-only handoff names the live mix in order, notes and the main model', async () => {
  const r = withPicks({ ...defaultRouting(), role: 'plan', tags: { codex: 'main' } }, [
    { provider: 'opencode', model: 'scout', note: 'small reviews' },
    { provider: 'codex', model: 'builder' },
    { provider: 'claude', model: 'planner' },
  ])
  const text = handoffText(r)!
  expect(text).toContain('1. scout on OpenCode via `opencode run -m scout "<task>"` (see the other-agents skill) (note: small reviews), 2. builder on Codex via `codex exec -m builder "<task>" < /dev/null`')
  expect(text).toContain('Implementation work goes to the main model, builder on Codex, #2 in the list above, through `codex exec -m builder "<task>" < /dev/null`, by default')
  expect(text.includes('planner')).toBe(false)
  expect(handoffText({ ...r, role: 'auto' })).toBeUndefined()
  const off = { ...r, on: { ...r.on, codex: false, opencode: false, commandcode: false, antigravity: false } }
  expect(handoffText(off)).toBeUndefined()
  const visual = handoffText({ ...off, picks: [], on: { ...off.on, antigravity: true }, models: { ...off.models, antigravity: ['gemini'] } })!
  expect(visual).toContain('gemini on Antigravity (visual checks only) via')
  expect(visual.includes('Implementation work goes')).toBe(false)
})

test('stop refuses an agent\'s next tool call; the graph shows Claude\'s own steps', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 's1' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await ($.turn as any).start({ text: 'hi', turnId: 't1' })
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'b1', command: 'ls', description: 'List the files' })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(120) })
  expect(await ui.find({ type: 'Text', text: /List the files/ })).toBeDefined()
  await ($.agent as any).spawn({ tool_use_id: 'x1', prompt: 'p', description: 'Build: the thing', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  const stop = (await ui.find({ type: 'Button', text: /■ stop/ })) as any
  expect(stop).toBeDefined()
  await ui.press({ key: stop.key ?? stop.props?.key })
  const ran = await ($.tool as any).call({ tool: 'Read', tool_use_id: 'r1', agentId: 's1', file_path: '/x' })
  expect(String(ran.deny)).toContain('Stopped by the owner')
  await ui.unmount()
})

test('presets, caps and the ultracode switch draw in the Models tab', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(120) })
  await ui.press({ key: 'tab:models' })
  expect(await ui.find({ key: 'preset:Cheap' })).toBeDefined()
  expect(await ui.find({ key: 'ultracode' })).toBeDefined()
  await ui.press({ key: 'preset:save' })
  expect(await ui.find({ key: 'preset:name' })).toBeDefined()
  await ui.unmount()
})

test('under "Claude plans only" a Claude subagent is told to hand its task on', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let seen = ''
  on('agent.spawn', (_$, e) => {
    seen = e.prompt
    return { model: 'claude-opus-5-5', agentId: 'p1' }
  })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(120) })
  await ui.press({ key: 'tab:models' })
  await ui.press({ key: 'seg:CLAUDE:plan' })
  await ui.press({ key: 'tab:settings' })
  await ui.press({ key: 'setting:planSubagents:handoff' })
  await ($.agent as any).spawn({ tool_use_id: 'y1', prompt: 'review the code', description: 'review:code', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  expect(seen).toContain('Claude plans only')
  expect(seen).toContain('review the code')
  await ui.unmount()
})

test('run quota alerts clear on success and at the end of an automatic pause', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  let r = { ...defaultRouting(), on: { ...defaultRouting().on, codex: false }, paused: { codex: { why: 'quota', at: 0, until: 500 } } }
  let all = { claude: blank(), codex: { ...blank(), alert: 'quota hit · its run said so' }, opencode: { ...blank(), alert: 'quota hit · its run said so' }, commandcode: blank(), antigravity: blank() }
  on('state.get', { plugin: 'agent-overview', key: 'routing' }, () => ({ value: { value: r, version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'routing' }, (_$, e) => { r = e.value as typeof r; return { value: { isSet: true, version: 2 } } })
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: all, version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'providers' }, (_$, e) => { all = e.value as typeof all; return { value: { isSet: true, version: 2 } } })
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'recover', command: 'opencode run "fix"' })
  expect(all.opencode.alert).toBeUndefined()
  expect(all.codex.alert).toBeUndefined()
  expect(r.on.codex).toBe(true)
  expect(r.paused.codex).toBeUndefined()
})

test('deleting a preset asks first; no keeps it, yes removes it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(120) })
  await ui.press({ key: 'tab:models' })
  await ui.press({ key: 'preset:save' })
  await ui.input({ key: 'preset:name', text: 'mixed' })
  expect(await ui.find({ key: 'preset:saved:mixed' })).toBeDefined()
  await ui.press({ key: 'preset:del:mixed' })
  expect(await ui.find({ key: 'preset:saved:mixed' })).toBeDefined()
  await ui.press({ key: 'preset:del:no:mixed' })
  expect(await ui.find({ key: 'preset:del:mixed' })).toBeDefined()
  await ui.press({ key: 'preset:del:mixed' })
  await ui.press({ key: 'preset:del:yes:mixed' })
  expect(await ui.find({ key: 'preset:saved:mixed' })).toBeUndefined()
  await ui.unmount()
})
