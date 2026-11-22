import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Preset, Providers, Routing, Ui } from '../types'
import { fixture, NOW } from '../tools/pane-fixtures'
import { activePreset, presetSnapshot, restorePresets } from '../hooks/preset-state'
import { BUILT_IN, defaultRouting, normalRouting, withPicks, withTag } from '../hooks/state'
import { saveRouting } from '../hooks/ui'
import { watchQuota } from '../hooks/providers'
import { AUTO_AGY_KEY, autoAntigravity } from '../hooks/auto'
import { defaultPolicy } from '../hooks/policy'

const props = { title: 'Agent panel', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const route = (): Routing => withPicks(defaultRouting(), [
  { provider: 'claude', model: 'opus' }, { provider: 'codex', model: 'gpt', effort: 'high', note: 'build' },
  { provider: 'opencode', model: 'kimi' }, { provider: 'antigravity', model: 'gemini' },
])
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
function setup(on: On, crew = false) {
  const state = { ...fixture({ area: crew ? 'vibe' : 'overview', tab: crew ? 'crew' : 'models', scenario: 'presets' }), routing: route(), presets: [] as Preset[] } as Record<string, any> & { routing: Routing; presets: Preset[]; ui: Ui; providers: Providers }
  const store: Record<string, any> = { presets: [
    { name: 'A', routing: route() },
    { name: 'B', routing: withPicks(withTag({ ...route(), useOrder: false }, 'opencode', 'main'), [{ provider: 'codex', model: 'other', effort: 'low', note: 'B only' }]) },
  ] }
  let session = 'chat-a'
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: session }))
  on('store.get', (_$, e) => ({ value: copy(store[e.key] ?? null) }))
  on('store.set', (_$, e) => { store[e.key] = copy(e.value); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key as keyof typeof state] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) Object.assign(state, { [e.key]: e.value }); return r })
  for (const p of ['claude', 'codex', 'opencode', 'antigravity'] as const) state.providers[p].models = state.routing.picks.filter(x => x.provider === p).map(x => ({ id: x.model, efforts: ['low', 'high'] }))
  state.providers.codex.models.push({ id: 'backup', efforts: ['low', 'high'] })
  state.providers.antigravity.models.push({ id: 'gemini-4-argon-low' }, { id: 'gemini-3.8-flash-medium' })
  const api = {
    session: { id: async () => session }, clock: { now: async () => NOW }, ui: { invalidate: () => {}, toast: () => {} },
    store: { get: async (key: string) => copy(store[key] ?? null), set: async (key: string, value: unknown) => { store[key] = copy(value) } },
    state: { get: async ({ key }: { key: string }) => ({ value: state[key], version: 0 }), set: async ({ key }: { key: string }, value: unknown) => { state[key] = value; return { isSet: true, version: 1 } } },
  } as unknown as EngineInterface
  return { state, store, api, saved: (name: string): Preset => store.presets.find((p: Preset) => p.name === name), session: (id: string) => { session = id } }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Models edits belong only to the active preset (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const { state, store, saved } = setup(on)
    const b = copy(saved('B'))
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    await ui.press({ key: 'preset:saved:A' })
    const builtins = copy(store.presets.filter((p: Preset) => p.builtIn))
    await ui.select({ key: 'effort:codex/gpt', value: 'low' })
    await ui.press({ key: 'note:codex/gpt' })
    await ui.input({ key: 'noteinput:codex/gpt', text: 'A only' })
    await ui.press({ key: 'up:codex/gpt' })
    await ui.select({ key: 'tag:codex', value: 'main' })
    await ui.press({ key: 'on:opencode' })
    await ui.press({ key: 'pdown:antigravity' })
    await ui.press({ key: 'useOrder' })
    await ui.press({ key: 'seg:CLAUDE:plan' })
    await ui.press({ key: 'del:claude/opus' })
    await ui.press({ key: 'open:codex' })
    await ui.press({ key: 'model:add:codex' })
    await ui.select({ key: 'model:addmodel:codex', value: 'backup' })
    await ui.press({ key: 'edit:back' })
    await ui.press({ key: 'open:antigravity' })
    await ui.select({ key: 'agy:coding:model', value: 'gemini-4-argon-low' })
    await ui.select({ key: 'agy:visual:model', value: 'gemini-3.8-flash-medium' })
    await ui.press({ key: 'agy:visual' })
    await ui.press({ key: 'agy:coding' })
    await ui.press({ key: 'edit:back' })
    const a = copy(presetSnapshot(state.routing))
    expect(saved('A').routing).toEqual(a)
    expect(a).toMatchObject({ role: 'plan', useOrder: false, agyVisual: false, agyCoding: true, agyCodingModel: 'gemini-4-argon-low', agyVisualModel: 'gemini-3.8-flash-medium', tags: { codex: 'main' }, on: { opencode: false } })
    expect(a.picks[0]).toEqual({ provider: 'codex', model: 'gpt', effort: 'low', note: 'A only' })
    expect(a.picks.some(x => x.model === 'backup')).toBe(true)
    expect(a.picks.some(x => x.model === 'opus')).toBe(false)
    expect(saved('B')).toEqual(b)
    expect(store.presets.filter((p: Preset) => p.builtIn)).toEqual(builtins)
    expect(await ui.find({ key: 'preset:update:A' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /changed since|A •/ })).toBeUndefined()
    await ui.press({ key: 'preset:saved:B' })
    expect(state.routing).toEqual(normalRouting(b.routing))
    await ui.press({ key: 'preset:saved:A' })
    expect(state.routing).toEqual(a)
    expect(store['routing:chat-a']).toEqual(a)
    for (const name of ['Cheap', 'Max quality']) {
      await ui.press({ key: `preset:${name}` })
      expect(state.routing.picks.some(x => x.model === 'opus')).toBe(true)
    }
    expect(saved('A').routing).toEqual(a)
    await ui.unmount()
  })

  test(`Crew edits and hand-off undo save to its preset (${surface})`, { timeoutMs: 15000 }, async ($, on) => {
    const { state, saved } = setup(on, true)
    const b = copy(saved('B'))
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    expect(await ui.find({ key: 'card:presets' })).toBeDefined()
    await ui.press({ key: 'preset:saved:A' })
    await ui.select({ key: 'crew:model:codex/gpt', value: 'backup' })
    await ui.press({ key: 'crew:down:antigravity' })
    await ui.press({ key: 'crew:on:opencode' })
    await ui.select({ key: 'crew:tag:claude', value: 'saver' })
    await ui.select({ key: 'crew:agy:coding:model', value: 'gemini-4-argon-low' })
    await ui.select({ key: 'crew:agy:visual:model', value: 'gemini-3.8-flash-medium' })
    const before = copy(state.routing)
    await ui.press({ key: 'crew:handoff' })
    expect(saved('A').routing.tags?.codex).toBe('main')
    expect(saved('A').routing).toEqual(presetSnapshot(state.routing))
    await ui.press({ key: 'crew:undo' })
    expect(state.routing).toEqual(before)
    expect(saved('A').routing).toEqual(presetSnapshot(before))
    const a = copy(saved('A'))
    await ui.press({ key: 'preset:saved:B' })
    expect(saved('B')).toEqual(b)
    expect(await ui.find({ key: 'crew:undo' })).toBeUndefined()
    await ui.press({ key: 'preset:saved:A' })
    expect(state.routing).toEqual(normalRouting(a.routing))
    expect(state.routing.picks.find(x => x.provider === 'codex')?.model).toBe('backup')
    expect(state.routing).toMatchObject({ agyCodingModel: 'gemini-4-argon-low', agyVisualModel: 'gemini-3.8-flash-medium' })
    await ui.unmount()
  })
}

test('Custom leaves presets alone; new saves snapshot the current routing and reject duplicate names', async ($, on) => {
  const { state, store, saved } = setup(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props })
  await ui.press({ key: 'preset:saved:A' })
  await ui.press({ key: 'preset:custom' })
  const untouched = copy(store.presets)
  await ui.press({ key: 'del:codex/gpt' })
  expect(store.presets).toEqual(untouched)
  expect(state.ui.preset).toBeUndefined()
  expect(store['preset:chat-a']).toBe(null)
  await ui.press({ key: 'preset:save' })
  await ui.input({ key: 'preset:name', text: 'A' })
  expect(store.presets).toEqual(untouched)
  await ui.input({ key: 'preset:name', text: '  Custom setup  ' })
  expect(saved('Custom setup').routing).toEqual(presetSnapshot(state.routing))
  expect(store['preset:chat-a']).toBe('Custom setup')
  expect(state.ui.preset?.name).toBe('Custom setup')
  await ui.unmount()
})

test('built-ins keep their edits and reset from defaults without changing other presets', async ($, on) => {
  const { state, store, saved } = setup(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props })
  await ui.press({ key: 'preset:Cheap' })
  expect(saved('Cheap').builtIn).toBe(true)
  expect(await ui.find({ key: 'preset:del:Cheap' })).toBeUndefined()
  const others = copy(store.presets.filter((p: Preset) => p.name !== 'Cheap'))
  await ui.press({ key: 'del:codex/gpt' })
  await ui.press({ key: 'preset:Max quality' })
  expect(state.routing.picks.some(x => x.model === 'gpt')).toBe(true)
  await ui.press({ key: 'preset:Cheap' })
  expect(state.routing.picks.some(x => x.model === 'gpt')).toBe(false)
  await ui.press({ key: 'preset:reset:Cheap' })
  expect(saved('Cheap').routing).toEqual(presetSnapshot(BUILT_IN[0]!.apply(defaultRouting())))
  expect(state.routing).toEqual(saved('Cheap').routing)
  expect(store.presets.filter((p: Preset) => p.name !== 'Cheap')).toEqual(others)
  await ui.unmount()
})

test('presets survive chats and reloads; migration starts Custom and deleted presets stay deleted', async ($, on) => {
  const { state, store, saved, session, api } = setup(on)
  const selected = () => state.ui.preset?.name
  state.ui.preset = { name: 'legacy active' }
  const old = copy(store.presets)
  await restorePresets(api)
  expect(state.ui.preset).toBeUndefined()
  expect(store.presets).toEqual(old)
  await activePreset(api, 'A')
  await saveRouting(api, r => ({ ...r, agyCoding: true }))
  const a = copy(saved('A'))
  state.ui.preset = undefined
  await restorePresets(api)
  expect(selected()).toBe('A')
  session('chat-b')
  await restorePresets(api)
  expect(state.ui.preset).toBeUndefined()
  expect(state.presets.find(p => p.name === 'A')).toEqual(a)
  await activePreset(api, 'B')
  await saveRouting(api, r => ({ ...r, agyVisual: false }))
  expect(saved('A')).toEqual(a)
  session('chat-a')
  await restorePresets(api)
  expect(selected()).toBe('A')
  store.presets = store.presets.filter((p: Preset) => p.name !== 'A')
  await saveRouting(api, r => ({ ...r, role: 'plan' }))
  expect(saved('A')).toBeUndefined()
  expect(state.ui.preset).toBeUndefined()
  await restorePresets(api)
  expect(saved('A')).toBeUndefined()
})

test('quota pauses survive switching and edits without entering a preset snapshot', async ($, on) => {
  const { state, saved, api } = setup(on)
  state.providers.codex.meters = [{ label: 'Week', percent: 100 }]
  state.providers.codex.alert = 'quota hit'
  delete (saved('A').routing as Partial<Routing>).on
  await activePreset(api, 'A')
  const a = copy(saved('A'))
  await watchQuota(api)
  expect(state.routing.on.codex).toBe(false)
  expect(saved('A')).toEqual(a)
  const pauses = copy(state.routing.paused)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props })
  // B explicitly disables a provider already quota-paused in this chat.
  saved('B').routing.on.codex = false
  await ui.press({ key: 'preset:saved:B' })
  expect(state.routing.paused).toEqual(pauses)
  expect(state.routing.on.codex).toBe(false)
  await ui.press({ key: 'useOrder' })
  expect(saved('B').routing.on.codex).toBe(false)
  expect(saved('B').routing.paused).toEqual({})
  await ui.press({ key: 'preset:saved:A' })
  await ui.press({ key: 'useOrder' })
  expect(saved('A').routing.on.codex).toBe(true)
  expect(saved('A').routing.paused).toEqual({})
  expect(state.routing.on.codex).toBe(false)
  expect(state.routing.paused).toEqual(pauses)
  await ui.unmount()
})

test('Antigravity switches itself on once (Visual, Coding, every project); a later "off" sticks', async ($, on) => {
  const { state, store, api } = setup(on)
  state.routing = { ...state.routing, agyVisual: false, agyCoding: false }
  state.policy = { ...defaultPolicy(), allow: ['/Users/sai/one'] }
  expect(await autoAntigravity(api)).toBe(true)
  expect(state.routing.agyVisual && state.routing.agyCoding).toBe(true)
  expect(state.policy.allow).toEqual(['/', '/Users/sai/one'])
  expect(store[AUTO_AGY_KEY]).toBe(1)
  await saveRouting(api, r => ({ ...r, agyCoding: false }))
  expect(await autoAntigravity(api)).toBe(false)
  expect(state.routing.agyCoding).toBe(false)
})
