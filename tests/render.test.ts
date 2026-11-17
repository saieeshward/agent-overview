import { expect, mock, test } from 'claude-code/testing'
import { blank, defaultRouting, withPicks } from '../hooks/state'
import { selectOptions, tableOf } from '../hooks/ui'
import { drawPane } from '../hooks/view'

const pane = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }

for (const surface of ['desktop', 'terminal'] as const) {
  test(`effort options drop default duplicates, repeated levels and empty values on ${surface}`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const routing = withPicks(defaultRouting(), [{ provider: 'codex', model: 'custom' }])
    const providers = { claude: blank(), codex: { ...blank(), models: [{ id: 'custom', efforts: ['default', 'high', 'high', '', '  '] }] }, commandcode: blank(), opencode: blank(), antigravity: blank() }
    on('state.get', { plugin: 'agent-overview', key: 'routing' }, () => ({ value: { value: routing, version: 1 } }))
    on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: providers, version: 1 } }))
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...pane, props })
    await ui.press({ key: 'tab:models' })
    expect((await ui.find({ key: 'effort:codex/custom' }))?.props.options).toEqual([{ value: 'default' }, { value: 'high' }])
    expect(await ui.find({ type: 'Text', text: /^panel error:/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`a tab failure keeps the title and reports its diagnostic on ${surface}`, async ($, on) => {
    mock.clock(on, { now: 1234 })
    let saved: any
    on('store.set', { key: 'lastRenderError' }, (_$, e, next) => { saved = e.value; return next(e) })
    mock.store(on)
    // Valid JSON, but malformed persisted data forces Object.entries to throw inside Plugins.
    on('state.get', { plugin: 'agent-overview', key: 'used' }, () => ({ value: { value: { mcp: null, skills: {}, agentTypes: {} } as any, version: 1 } }))
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...pane, props })
    await ui.press({ key: 'tab:plugins' })
    expect(saved).toMatchObject({ at: 1234, area: 'overview', tab: 'plugins' })
    expect(saved.message.length).toBeGreaterThan(0)
    expect(saved.stack.split('\n').length).toBeLessThanOrEqual(5)
    expect(saved.stack).toContain(saved.message)
    expect((await ui.find({ type: 'Text', text: `panel error: ${saved.message}` }))?.props.dimColor).toBe(true)
    expect(await ui.find({ key: 'area:overview' })).toBeDefined()
    expect(await ui.find({ key: 'tab:dashboard' })).toBeDefined()
    await ui.unmount()
  })
}

test('render guards omit empty Selects and oversized SVGs and reject invalid children before returning a tree', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  expect(selectOptions([{ value: '', label: 'empty' }, { value: 'x', label: 'first' }, { value: 'x', label: 'second' }])).toEqual([{ value: 'x', label: 'first' }])
  on('ui.render', { component: 'Pane', requestId: 'render-guards' }, ($, e) => {
    const E = tableOf($, e)
    const child = E.Button({ key: 'same', children: 'press', onPress() {} })
    expect(E.Box({ children: [child, [child]] }).children).toHaveLength(1)
    expect(() => E.Button({ key: 'bad', children: E.Box({}), onPress() {} })).toThrow('Button children must be text')
    return E.Box({ children: [
      E.Select({ key: 'empty', options: [{ value: '' }, { value: ' ' }], onSelect() {} }),
      E.Select({ key: 'zero', options: [], onSelect() {} }),
      E.Svg({ source: 'x'.repeat(131073), alt: 'Large drawing' }),
      E.Text({ children: 'safe\u0000 text\nwith\ttabs' }),
      E.Code({ source: 'safe\u0000 code' }),
    ] })
  })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...pane, requestId: 'render-guards', props })
  expect(await ui.findAll({ type: 'Select' })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: 'Large drawing (SVG unavailable)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'safe text\nwith\ttabs' })).toBeDefined()
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('safe code')
  await ui.unmount()
})

test('band failures are recorded and let the normal AbovePrompt renderer continue', async ($, on) => {
  mock.clock(on, { now: 42 })
  let saved: any
  on('store.set', { key: 'lastRenderError' }, (_$, e, next) => { saved = e.value; return next(e) })
  mock.store(on)
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: { claude: { ...blank(), meters: null } } as any, version: 1 } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['normal band'] }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'AbovePrompt', props: {
    hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110, scroll: { offset: 0, bodyRows: 4 }, view: {},
  } })
  expect(saved).toMatchObject({ at: 42, area: 'band', tab: 'AbovePrompt' })
  expect(await ui.find({ type: 'Text', text: 'normal band' })).toBeDefined()
  await ui.unmount()
})

test('a refused diagnostic store write still returns the pane error line', async () => {
  let writes = 0
  const element = (type: string) => (p: any) => ({ type, props: p, children: p.children })
  const engine = {
    ui: { resolve: () => ({ Box: element('Box'), Text: element('Text'), Button: element('Button') }) },
    state: { get: async (ref: any) => ({ value: ref.key === 'ui' ? { tab: 'plugins' } : ref.key === 'used' ? { mcp: null } : undefined, version: 1 }) },
    clock: { now: async () => 42 },
    store: { set: async () => { writes++; throw new Error('store unavailable') } },
  }
  const tree = await drawPane(engine as any, { surface: 'desktop', props })
  expect(writes).toBe(1)
  expect(JSON.stringify(tree)).toContain('panel error:')
})

test('a Select with more than 64 options keeps 64 including the selected one', () => {
  const options = Array.from({ length: 90 }, (_, i) => ({ value: `m${i}`, label: `m${i}` }))
  const got = selectOptions(options, 'm80')
  expect(got.length).toBe(64)
  expect(got.some(o => o.value === 'm80')).toBe(true)
})
