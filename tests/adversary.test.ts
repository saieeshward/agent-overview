import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Routing } from '../types'
import { defaultRouting, handoffText, normalRouting, optimizeText, presetKey, routingHow, routingText, withPicks } from '../hooks/state'
import { colorOf, shortModel } from '../hooks/ui'
import { fixture, NOW } from '../tools/pane-fixtures'

const picks: Routing['picks'] = [
  { provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' },
  { provider: 'claude', model: 'claude-sonnet-5', effort: 'high' },
]
const route = (): Routing => withPicks(defaultRouting(), picks)
const reviewed = (): Routing => ({ ...route(), adversary: { ...picks[0]!, rounds: 2 } })
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const props = { title: 'Agent panel', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }

test('adversary defaults to off and rejects invalid or removed picks', () => {
  expect(defaultRouting().adversary).toBeNull()
  expect(normalRouting(undefined).adversary).toBeNull()
  for (const adversary of [undefined, null, false, 1, 'codex', {}, { provider: 'bad', model: 'gpt-6.1-sol' }, { provider: 'codex', model: 5 }, { provider: 'codex', model: 'removed' }, { provider: 'opencode', model: 'gpt-6.1-sol' }]) {
    expect(normalRouting({ ...route(), adversary }).adversary).toBeNull()
  }
  expect(normalRouting(withPicks(reviewed(), picks.slice(1))).adversary).toBeNull()
})

test('adversary rounds clamp, round and default, and effort follows the allowed pick', () => {
  for (const [rounds, expected] of [[-10, 1], [0, 1], [1, 1], [2.4, 2], [2.5, 3], [4.8, 5], [10, 5], [undefined, 2], [null, 2], ['3', 2], [NaN, 2], [Infinity, 2]] as const) {
    const r = normalRouting({ ...route(), adversary: { ...picks[0], effort: 'low', rounds } })
    expect(r.adversary).toEqual({ ...picks[0], rounds: expected })
  }
  const changed = withPicks(reviewed(), [{ ...picks[0]!, effort: 'medium' }, picks[1]!])
  expect(normalRouting(changed).adversary?.effort).toBe('medium')
  expect(normalRouting(withPicks(reviewed(), [{ provider: 'codex', model: 'gpt-6.1-sol' }])).adversary?.effort).toBeUndefined()
})

test('adversary model and rounds distinguish presets and missing matches off', () => {
  const base = route(), r = reviewed()
  expect(presetKey({ ...base, adversary: undefined })).toBe(presetKey(base))
  expect(presetKey(r)).not.toBe(presetKey(base))
  expect(presetKey({ ...r, adversary: { ...r.adversary!, rounds: 3 } })).not.toBe(presetKey(r))
  expect(presetKey({ ...r, adversary: { ...picks[1]!, rounds: 2 } })).not.toBe(presetKey(r))
})

// Adversarial review runs only when the owner asks: the routing says so in one line and never sets up a loop.
test('routing has one on-request adversarial review line, naming the owner\'s Claude reviewer or Opus 5.5', () => {
  const line = (r: Routing) => routingText(r).split('\n').filter(l => l.startsWith('Adversarial review:'))
  for (const r of [route(), reviewed(), { ...route(), role: 'claude' as const }, { ...reviewed(), on: { ...reviewed().on, codex: false } }]) {
    expect(line(r)).toHaveLength(1)
    for (const text of ['only when Sai asks', 'never on your own', 'never as a routine step', 'mcp__agent-overview__adversarial_review', '/review-adversarial go']) expect(line(r)[0]).toContain(text)
    for (const loop of ['then review again', 'model that did the work to fix', 'after any change']) expect(line(r)[0]).not.toContain(loop)
  }
  expect(line(route())[0]).toContain('claude-opus-5-5 at high effort for up to 2 rounds')
  // A non-Claude pick stays a default in the panel, but the reviewer is Opus 5.5.
  expect(line(reviewed())[0]).toContain('claude-opus-5-5')
  const claude: Routing = { ...route(), adversary: { ...picks[1]!, rounds: 3 } }
  expect(line(claude)[0]).toContain('claude-sonnet-5 at high effort for up to 3 rounds')
})

test('a planner is never told to run adversarial review', () => {
  const r: Routing = { ...reviewed(), role: 'plan', optimize: 'balanced' }
  expect(handoffText(r)).not.toContain('Adversarial review:')
  expect(handoffText({ ...r, adversary: null })).not.toContain('Adversarial review:')
  expect(handoffText({ ...r, role: 'auto' })).toBeUndefined()
})

test('Opus 5.5 is a reviewer the owner can keep without pinning it', () => {
  expect(normalRouting({ ...route(), adversary: { provider: 'claude', model: 'claude-opus-5-5', rounds: 3 } }).adversary).toMatchObject({ provider: 'claude', model: 'claude-opus-5-5', rounds: 3 })
  expect(normalRouting({ ...route(), adversary: { provider: 'claude', model: 'claude-opus-4', rounds: 3 } }).adversary).toBeNull()
})

function setup(on: On, view: 'Models' | 'Provider' | 'Crew') {
  const state = fixture({ area: view === 'Crew' ? 'vibe' : 'overview', tab: view === 'Crew' ? 'crew' : 'models', scenario: 'adversary-test' })
  const store: Record<string, any> = {}
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/adversary-test' })
  on('session.id', () => ({ value: 'adversary' }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('store.get', (_$, e) => ({ value: copy(store[e.key] ?? null) }))
  on('store.set', (_$, e) => { store[e.key] = copy(e.value); return { value: undefined } })
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
  on('ui.invalidate', () => ({ value: undefined }))
  return { state, store }
}

const walk = (n: any): any[] => n && typeof n === 'object' ? [n, ...(n.children ?? []).flatMap(walk)] : []

for (const surface of ['desktop', 'terminal'] as const) for (const view of ['Models', 'Provider', 'Crew'] as const) test(`adversary chips and rounds persist per preset in ${view} (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
  const { state, store } = setup(on, view)
  const picks = state.routing.picks as Routing['picks']
  const opus = { provider: 'claude' as const, model: 'claude-opus-5-5' }, other = picks.find(p => p.provider === 'claude')!
  store.presets = [{ name: 'A', routing: copy(state.routing) }, { name: 'B', routing: { ...copy(state.routing), adversary: { ...other, rounds: 1 } } }]
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  expect(await ui.find({ key: 'adversary' })).toBeDefined()
  expect(await ui.find({ key: 'adversary:rounds' })).toBeUndefined()
  // Only Claude reviewers are offered, Opus 5.5 always among them.
  for (const p of [opus, ...picks.filter(p => p.provider === 'claude')]) {
    const button = await ui.find({ key: `adversary:${p.provider}/${p.model}` })
    expect(walk(button).some(n => n.type === 'Text' && n.children?.join('').trim() === shortModel(p.model))).toBe(true)
  }
  for (const p of picks.filter(p => p.provider !== 'claude')) expect(await ui.find({ key: `adversary:${p.provider}/${p.model}` })).toBeUndefined()
  await ui.press({ key: 'preset:saved:A' })
  if (view === 'Provider') await ui.press({ key: 'open:codex' })
  await ui.press({ key: `adversary:${opus.provider}/${opus.model}` })
  expect(state.routing.adversary).toMatchObject({ ...opus, rounds: 2 })
  const selected = walk(await ui.find({ key: `adversary:${opus.provider}/${opus.model}` })).find(n => n.type === 'Text' && n.props.weight === 'bold')
  expect(selected.props[surface === 'desktop' ? 'backgroundColor' : 'color']).toBe(colorOf('claude'))
  for (const rounds of [1, 2, 3, 4, 5]) {
    await ui.press({ key: `adversary:rounds:${rounds}` })
    expect(state.routing.adversary.rounds).toBe(rounds)
    expect(walk(await ui.find({ key: `adversary:rounds:${rounds}` })).some(n => n.props?.weight === 'bold')).toBe(true)
  }
  expect(store.routing.adversary).toMatchObject({ ...opus, rounds: 5 })
  expect(store['routing:adversary'].adversary).toMatchObject({ ...opus, rounds: 5 })
  expect(store.presets.find((p: any) => p.name === 'A').routing.adversary).toMatchObject({ ...opus, rounds: 5 })
  if (view === 'Provider') await ui.press({ key: 'edit:back' })
  await ui.press({ key: 'preset:saved:B' })
  expect(state.routing.adversary).toEqual({ ...other, rounds: 1 })
  if (view === 'Provider') await ui.press({ key: 'open:codex' })
  await ui.press({ key: 'adversary:off' })
  expect(state.routing.adversary).toBeNull()
  expect(await ui.find({ key: 'adversary:rounds' })).toBeUndefined()
  if (view === 'Provider') await ui.press({ key: 'edit:back' })
  await ui.press({ key: 'preset:saved:A' })
  expect(state.routing.adversary).toMatchObject({ ...opus, rounds: 5 })
  expect(store.presets.find((p: any) => p.name === 'B').routing.adversary).toBeNull()
  expect(await ui.find({ type: 'Text', text: /^panel error:/ })).toBeUndefined()
  await ui.unmount()
})
