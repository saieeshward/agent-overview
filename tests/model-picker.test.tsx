import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { ModelRow, Routing, Ui } from '../types'
import { modelPicker } from '../hooks/ui'
import { withPicks, withTag } from '../hooks/state'
import { fixture, NOW } from '../tools/pane-fixtures'

const props = { title: 'Agent panel', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const pane = { component: 'Pane', requestId: 'agent-overview', props } as const
const optionsOf = (node: any): { value: string; label?: string }[] => node?.props.options ?? []
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
function setup(on: On, crew = false) {
  const state = fixture({ area: crew ? 'vibe' : 'overview', tab: crew ? 'crew' : 'models', scenario: 'model-picker-test' })
  const store: Record<string, any> = {}
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'picker-test' }))
  on('store.get', (_$, e) => ({ value: copy(store[e.key] ?? null) }))
  on('store.set', (_$, e) => { store[e.key] = copy(e.value); return { value: undefined } })
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const r = await next(e)
    return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r
  })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const r = await next(e)
    if (r.value?.isSet) state[e.key] = e.value
    return r
  })
  on('ui.invalidate', () => ({ value: undefined }))
  return { state, store }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Crew rows replace, set effort, add at the provider tail and remove to empty (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const { state, store } = setup(on, true)
    state.providers.antigravity.models[0].efforts = []
    const cmd = (state.routing as Routing).picks.filter(p => p.provider === 'commandcode')
    const others = (state.routing as Routing).picks.filter(p => p.provider !== 'commandcode')
    state.routing = withTag(withPicks(state.routing, [cmd[0]!, others[0]!, cmd[1]!, others[1]!, cmd[2]!, ...others.slice(2)]), 'commandcode', 'main')
    state.routing.picks[2].note = 'keep this note'
    store.presets = [{ name: 'Picker', routing: copy(state.routing) }]
    state.presets = copy(store.presets)
    state.ui.preset = { name: 'Picker' }
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...pane })
    for (const p of cmd) {
      expect((await ui.find({ key: `crew:model:commandcode/${p.model}` }))?.type).toBe('Select')
      expect(await ui.find({ key: `crew:remove:commandcode/${p.model}` })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: 'Subagents' })).toBeDefined()
    expect(await ui.find({ key: `crew:effort:antigravity/${state.providers.antigravity.models[0].id}` })).toBeUndefined()
    const old = 'commandcode/moonshotai/kimi-k3', key = `crew:model:${old}`
    const before = copy(state.routing)
    await ui.select({ key: `${key}:maker`, value: 'deepseek' })
    expect(state.routing).toEqual(before)
    const pages = optionsOf(await ui.find({ key: `${key}:range` }))
    expect(pages.length).toBe(2)
    await ui.select({ key: `${key}:range`, value: pages[1]!.value })
    await ui.select({ key, value: 'deepseek/model-079' })
    expect(state.routing.picks[2]).toEqual({ provider: 'commandcode', model: 'deepseek/model-079', note: 'keep this note' })
    expect(state.routing.picks.length).toBe(before.picks.length)
    expect(state.routing.worker.model).toBe(cmd[0]!.model)
    await ui.select({ key: 'crew:effort:commandcode/deepseek/model-079', value: 'low' })
    expect(state.routing.picks[2].effort).toBe('low')
    await ui.select({ key: 'crew:effort:commandcode/deepseek/model-079', value: 'default' })
    expect(state.routing.picks[2].effort).toBeUndefined()
    await ui.press({ key: 'crew:add:commandcode' })
    const add = 'crew:addmodel:commandcode'
    await ui.select({ key: `${add}:maker`, value: 'other' })
    await ui.select({ key: add, value: 'legacy' })
    expect(state.routing.picks[5]).toEqual({ provider: 'commandcode', model: 'legacy' })
    expect(state.routing.picks.slice(6)).toEqual(others.slice(2))
    expect(await ui.find({ key: add })).toBeUndefined()
    expect(store.presets[0].routing.picks).toEqual(state.routing.picks)
    expect(state.vibe.events.some((e: any) => e.kind === 'priority')).toBe(true)
    for (const p of [...state.routing.picks].filter(p => p.provider === 'commandcode')) await ui.press({ key: `crew:remove:commandcode/${p.model}` })
    expect(state.routing.picks).toEqual(others)
    expect(state.routing.worker).toBe(null)
    expect(await ui.find({ type: 'Text', text: 'no model' })).toBeDefined()
    expect(await ui.find({ key: 'crew:add:commandcode' })).toBeDefined()
    await ui.press({ key: 'crew:add:commandcode' })
    await ui.select({ key: `${add}:maker`, value: 'moonshotai' })
    await ui.select({ key: add, value: 'moonshotai/kimi-k3' })
    expect(state.routing.worker).toEqual({ provider: 'commandcode', model: 'moonshotai/kimi-k3' })
    expect(store['routing:picker-test'].picks).toEqual(state.routing.picks)
    await ui.unmount()
  })

  test(`Models uses the shared picker for replacement and addition (${surface})`, { timeoutMs: 15000 }, async ($, on) => {
    const { state } = setup(on)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...pane })
    await ui.press({ key: 'model:open:commandcode/moonshotai/kimi-k3' })
    const key = 'model:commandcode/moonshotai/kimi-k3'
    expect((await ui.find({ key: `${key}:maker` }))?.props.value).toBe('moonshotai')
    await ui.select({ key: `${key}:maker`, value: 'other' })
    await ui.select({ key, value: 'legacy' })
    expect(state.routing.picks.some((p: any) => p.model === 'moonshotai/kimi-k3')).toBe(false)
    expect(await ui.find({ key: 'model:commandcode/legacy:maker' })).toBeDefined()
    await ui.press({ key: 'model:add:commandcode' })
    const add = 'model:addmodel:commandcode'
    await ui.select({ key: `${add}:maker`, value: 'moonshotai' })
    await ui.select({ key: add, value: 'moonshotai/kimi-k3' })
    expect(state.routing.picks.at(-1).model).toBe('moonshotai/kimi-k3')
    expect(await ui.find({ type: 'Text', text: /^panel error:/ })).toBeUndefined()
    await ui.unmount()
  })
}

function picker(models: ModelRow[], value?: string) {
  let state = { tab: 'models', pick: 'claude' } as Ui
  const chosen = new Set<string>()
  const api = { state: {
    get: async () => ({ value: state, version: 0 }),
    set: async (_ref: unknown, next: Ui) => { state = next; return { isSet: true, version: 1 } },
  } } as unknown as EngineInterface
  const element = (type: string) => (props: any) => ({ type, props, children: props.children })
  const E = { Box: element('Box'), Select: element('Select'), Text: element('Text') }
  const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.children)] : []
  const draw = () => walk(modelPicker(api, E, state, 'pick', models, value, model => { value = model; chosen.add(model) }))
  const find = (key: string) => draw().find(n => n.props.key === key)
  const select = async (key: string, next: string) => { await find(key).props.onSelect(next) }
  return { draw, find, select, chosen, value: () => value }
}

test('picker reaches every one of 119 models through makers, alphabetical ranges and other', async () => {
  const models: ModelRow[] = fixture({ area: 'vibe', tab: 'crew', scenario: 'model-picker-test' }).providers.commandcode.models
  const p = picker(models, 'moonshotai/kimi-k3')
  expect(p.find('pick:maker').props.value).toBe('moonshotai')
  expect(optionsOf(p.find('pick:maker')).map(m => m.value)).toEqual(['deepseek', 'moonshotai', 'other', 'z-ai'])
  for (const maker of optionsOf(p.find('pick:maker'))) {
    await p.select('pick:maker', maker.value)
    const ranges = p.find('pick:range') ? optionsOf(p.find('pick:range')) : [undefined]
    for (const range of ranges) {
      if (range) await p.select('pick:range', range.value)
      const options = optionsOf(p.find('pick'))
      expect(options.length).toBeGreaterThan(0)
      expect(options.length).toBeLessThanOrEqual(64)
      expect(options.map(o => o.value)).toEqual([...options].map(o => o.value).sort((a, b) => a.localeCompare(b)))
      for (const option of options) {
        await p.select('pick', option.value)
        expect(p.value()).toBe(option.value)
        for (const select of p.draw().filter(n => n.type === 'Select')) {
          expect(optionsOf(select).length).toBeGreaterThan(0)
          expect(optionsOf(select).length).toBeLessThanOrEqual(64)
        }
      }
    }
  }
  expect([...p.chosen].sort()).toEqual(models.map(m => m.id).sort())
  expect(p.chosen.size).toBe(119)
})

test('picker keeps 64 models in one Select, starts on the current range and preserves unknown picks', () => {
  const small = picker(Array.from({ length: 64 }, (_, i) => ({ id: `model-${i}` })))
  expect(small.draw().filter(n => n.type === 'Select')).toHaveLength(1)
  expect(optionsOf(small.find('pick'))).toHaveLength(64)
  const large = picker(Array.from({ length: 129 }, (_, i) => ({ id: `maker/model-${String(i).padStart(3, '0')}` })).reverse(), 'maker/model-128')
  expect(large.find('pick:maker').props.value).toBe('maker')
  expect(optionsOf(large.find('pick:range'))).toHaveLength(3)
  expect(optionsOf(large.find('pick'))).toEqual([{ value: 'maker/model-128', label: 'model-128' }])
  expect(optionsOf(picker([], 'missing-model').find('pick'))).toEqual([{ value: 'missing-model', label: 'missing-model' }])
  expect(picker([]).draw().filter(n => n.type === 'Select')).toHaveLength(0)
  const huge = picker(Array.from({ length: 5000 }, (_, i) => ({ id: `maker/model-${String(i).padStart(4, '0')}` })), 'maker/model-0100')
  expect(huge.find('pick:range:1')).toBeDefined()
  expect(optionsOf(huge.find('pick')).some(o => o.value === 'maker/model-0100')).toBe(true)
  for (const select of huge.draw().filter(n => n.type === 'Select')) expect(optionsOf(select).length).toBeLessThanOrEqual(64)
})

test('more than 64 makers stay reachable without overflowing a Select', async () => {
  const p = picker(Array.from({ length: 70 }, (_, i) => ({ id: `maker-${String(i).padStart(2, '0')}/model` })))
  for (const r of optionsOf(p.find('pick:makers'))) {
    await p.select('pick:makers', r.value)
    for (const m of optionsOf(p.find('pick:maker'))) {
      await p.select('pick:maker', m.value)
      await p.select('pick', optionsOf(p.find('pick'))[0]!.value)
      for (const s of p.draw().filter(n => n.type === 'Select')) expect(optionsOf(s).length).toBeLessThanOrEqual(64)
    }
  }
  expect(p.chosen.size).toBe(70)
})
