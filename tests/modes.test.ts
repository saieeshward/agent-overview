import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import type { Area } from '../types'
import { fixture, LOG, NOW, PREVIEWS } from '../tools/pane-fixtures'
import { modeControls } from '../hooks/ui'

const REASON = 'finish or stop the current turn to switch modes'
const props = { title: 'Agent panel', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const AREAS: Area[] = ['overview', 'work', 'vibe']
const NAMES = { overview: 'Default', work: 'Work', vibe: 'Vibe' }
const TABS = { overview: ['dashboard', 'agents', 'models', 'activity', 'plugins', 'settings'], work: ['source', 'plan', 'implement', 'review', 'settings'], vibe: ['live', 'crew', 'powerups', 'decisions', 'settings'] }
const tabKey = (area: Area, tab: string) => `${area === 'overview' ? 'tab' : area === 'work' ? 'wtab' : 'vtab'}:${tab}`

function setup(on: On, state: Record<string, any>) {
  const clock = mock.clock(on, { now: NOW })
  const store: Record<string, any> = { 'mode:preview': { area: state.ui.area, stage: state.stage } }
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => { store[e.key] = e.value; return { value: undefined } })
  mock.env(on, { HOME: '/preview' })
  on('session.id', () => ({ value: 'preview' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('process.run', (_$, e) => ({ value: { stdout: e.argv.includes('--show-toplevel') ? '/repo' : e.argv.includes('log') ? LOG : e.argv.includes('show') ? e.argv.includes('--numstat') ? '2\t1\thooks/view.tsx\0' : '@@ -1 +1 @@\n-old\n+new\n' : '', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
  return { clock, store }
}

for (const surface of ['terminal', 'desktop'] as const) {
  for (const from of AREAS) test(`previews browse every tab without changing mode, prompt or guards from ${from} (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const state = fixture({ area: from, tab: from === 'overview' ? 'dashboard' : from === 'work' ? 'plan' : 'live', stage: 'plan', scenario: 'preview' })
    const { store } = setup(on, state)
    on('prompt.compose', () => ({ sections: [{ id: 'owner', text: 'Keep owner settings', scope: 'session' }] }))
    on('tool.call', () => ({ result: 'ok' }))
    const compose = () => $.prompt.compose({ model: 'claude', promptModel: 'claude', surfaces: [surface], tools: [], outputStyle: null, traits: [] })
    const beforePrompt = await compose(), saved = JSON.stringify(store['mode:preview']), held = JSON.stringify(state.stage)
    const beforeGuard = (await ($.tool as any).call({ tool: 'Edit', tool_use_id: 'before' })).deny
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    await ui.press({ key: `area:${from}` })
    expect(await ui.find({ key: 'area:confirmation' })).toBeUndefined()
    for (const to of AREAS.filter(a => a !== from)) {
      await ui.press({ key: `area:${to}` })
      expect(state.ui.area).toBe(from)
      expect(state.ui.pendingArea).toBe(to)
      expect((await ui.find({ key: 'area:confirmation' }))?.text).toContain(`${NAMES[to]} preview`)
      expect((await ui.find({ key: 'area:confirm' }))?.text.trim()).toBe('Switch')
      expect((await ui.find({ key: 'area:cancel' }))?.text.trim()).toBe('Back')
      if (surface === 'desktop') expect((await ui.find({ key: `area:${from}` }))?.props.variant).toBe('primary')
      else expect((await ui.findAll({ type: 'Text', text: NAMES[from].toUpperCase() })).some(t => t.props.inverse === true)).toBe(true)
      expect((await ui.find({ key: `area:${to}` }))?.props.variant).toBe('secondary')
      const tree = JSON.stringify(await ui.drawn())
      expect(tree.indexOf('area:confirmation') < tree.indexOf(tabKey(to, TABS[to][0]!))).toBe(true)
      for (const tab of TABS[to]) {
        await ui.press({ key: tabKey(to, tab) })
        expect(await ui.find({ type: 'Text', text: /^panel error:/ })).toBeUndefined()
      }
      expect(await compose()).toEqual(beforePrompt)
      expect((await ($.tool as any).call({ tool: 'Edit', tool_use_id: `preview:${to}` })).deny).toBe(beforeGuard)
      expect(JSON.stringify(state.stage)).toBe(held)
      expect(JSON.stringify(store['mode:preview'])).toBe(saved)
      await ui.press({ key: 'area:cancel' })
      expect(state.ui.area).toBe(from)
      expect(state.ui.pendingArea).toBeUndefined()
      expect(await ui.find({ key: tabKey(from, TABS[from][0]!) })).toBeDefined()
      await ui.press({ key: `area:${to}` })
      await ui.press({ key: `area:${from}` })
      expect(state.ui.pendingArea).toBeUndefined()
    }
    await ui.unmount()
  })

  test(`Switch applies the preview and Back works while main or Claude subagents block switching (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'dashboard', busy: true, scenario: 'preview' })
    const { store } = setup(on, state)
    const toasts: string[] = []
    on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    for (const target of ['work', 'vibe'] as const) {
      await ui.press({ key: `area:${target}` })
      expect((await ui.find({ key: 'area:confirm' }))?.text.trim()).toBe('switch after this turn')
      expect((await ui.find({ key: 'area:confirm' }))?.props.dimColor).toBe(true)
      await ui.press({ key: 'area:confirm' })
      expect(state.ui.area).toBe('overview')
      expect(toasts.at(-1)).toBe(REASON)
      await ui.press({ key: 'area:cancel' })
      expect(await ui.find({ key: 'tab:dashboard' })).toBeDefined()
    }
    state.main.working = false
    await ui.press({ key: 'area:work' })
    expect((await ui.find({ key: 'area:confirm' }))?.text.trim()).toBe('switch after this turn')
    // Old Claude agents and side providers do not hold the current turn open.
    state.nodes.find((n: any) => n.provider === 'claude').startedAt = state.main.since - 1
    await ui.redraw()
    expect((await ui.find({ key: 'area:confirm' }))?.text.trim()).toBe('Switch')
    // Recheck the live state even if a turn starts after this bar was drawn.
    state.main.working = true
    await ui.press({ key: 'area:confirm' })
    expect(state.ui.area).toBe('overview')
    state.main.working = false
    await ui.redraw()
    await ui.press({ key: 'area:confirm' })
    expect(state.ui.area).toBe('work')
    expect(state.ui.pendingArea).toBeUndefined()
    expect(store['mode:preview']).toMatchObject({ area: 'work', stage: { at: 'plan' } })
    await ui.press({ key: 'area:vibe' }); await ui.press({ key: 'area:confirm' })
    expect(store['mode:preview'].area).toBe('vibe')
    await ui.unmount()
  })

  test(`preview mode actions are dim and inert while source and decision navigation works (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const state = fixture({ area: 'work', current: 'overview', tab: 'plan', stage: 'plan', scenario: 'preview' })
    setup(on, state)
    let submits = 0
    on('prompt.submit', () => { submits++; return { status: 'submitted' } as any })
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    const inert = async (keys: string[]) => {
      const before = JSON.stringify(state)
      for (const key of keys) {
        const button = await ui.find({ type: 'Button', key })
        if (!button) throw new Error(`Missing preview action: ${key}`)
        if (button.props.dimColor !== true) throw new Error(`Preview action is not dim: ${key}`)
        await ui.press({ key })
      }
      expect(JSON.stringify(state)).toBe(before)
      expect(submits).toBe(0)
    }
    await inert(['plan:advance'])
    // The model and effort are shared with Default.
    expect(await ui.find({ type: 'Select', key: 'plan:model' })).toBeDefined()
    await ui.press({ key: 'wtab:source' })
    await ui.press({ key: 'src:commit:0000000000000000000000000000000000000006' })
    if (!await ui.find({ key: 'src:files' })) throw new Error('Preview commit did not open')
    await ui.press({ key: 'src:cfile:hooks/view.tsx' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toContain('+new')
    await ui.press({ key: 'src:back' })
    for (const [tab, stage, keys] of [
      ['implement', 'implement', ['impl:launch', 'impl:review', 'impl:on:0', 'impl:down:0']],
      ['review', 'review', ['rev:launch', 'rprof:edit', 'find:fix', 'find:dismiss', 'ship:commit']],
      ['review', 'ship', ['ship:push', 'ship:pr', 'ship:new']],
      ['settings', 'plan', ['wset:ponytail:off', 'wset:grill:off', 'wset:reset']],
    ] as const) {
      Object.assign(state, fixture({ area: 'work', current: 'overview', tab, stage, scenario: tab === 'review' && stage === 'review' ? 'review-selected-preview' : 'preview' }))
      await ui.redraw()
      await inert([...keys])
    }
    state.ui.confirm = 'wset:reset'; await ui.redraw(); await inert(['wset:reset:yes'])
    Object.assign(state, fixture({ area: 'work', current: 'overview', tab: 'review', stage: 'review', editing: true, scenario: 'preview' }))
    await ui.redraw()
    expect(await ui.find({ type: 'Input', key: 'rev:instructions' })).toBeUndefined()
    const instructions = await ui.find({ type: 'Text', text: 'Check the diff against the plan and explain actionable findings with evidence.' })
    if (!instructions?.props.dimColor) throw new Error('Preview instructions are not dim')
    expect(await ui.find({ type: 'Select', key: 'rev:model:0' })).toBeUndefined()
    await inert(['rev:add', 'rev:del:0'])
    Object.assign(state, fixture({ area: 'vibe', current: 'overview', tab: 'crew', scenario: 'preview' }))
    await ui.redraw(); await inert(['crew:handoff'])
    Object.assign(state, fixture({ area: 'vibe', current: 'overview', tab: 'crew', scenario: 'preview', undo: true }))
    await ui.redraw(); await inert(['crew:undo'])
    await ui.press({ key: 'crew:on:codex' }); expect(state.routing.on.codex).toBe(false)
    await ui.press({ key: 'vtab:powerups' })
    await ui.press({ key: 'power:force:feature:codex-images' }); expect(state.guard.codexImages).toBe('force')
    await ui.press({ key: 'power:fold:plugin:ponytail' })
    if (!await ui.find({ key: 'skill:skill:ponytail:ponytail-audit' })) throw new Error('Preview power-up fold did not open')
    await ui.press({ key: 'mode:plugin:ponytail:on' }); expect(state.toggles['plugin:ponytail']).toBe('on')
    await ui.press({ key: 'vtab:decisions' })
    await ui.press({ key: `vdec:open:${state.decisions[0].at}:0` })
    expect(state.ui.vibeExpanded).toContain(`${state.decisions[0].at}:0`)
    await ui.press({ key: 'vtab:settings' }); await inert(['vstyle:office:off', 'vmotion:still'])
    await ui.unmount()
  })
}

test('callbacks drawn in the active mode cannot edit after leaving it', async () => {
  const state = fixture({ area: 'work', tab: 'plan', scenario: 'preview' })
  const api = { state: { get: async ({ key }: { key: string }) => ({ value: state[key], version: 0 }) } } as unknown as EngineInterface
  let calls = 0
  const element = (p: any) => p
  const E = await modeControls(api, { Button: element, Select: element, Input: element }, 'work')
  const button = E.Button({ onPress: () => calls++ }), select = E.Select({ onSelect: () => calls++ }), input = E.Input({ onInput: () => calls++, onSubmit: () => calls++ })
  state.ui.area = 'vibe'
  await button.onPress(); await select.onSelect('x'); await input.onInput('x'); await input.onSubmit('x')
  expect(calls).toBe(0)
})

for (const surface of ['desktop', 'terminal'] as const) test(`every pane fixture has bounded Selects and no interactive SVG embeds images (${surface})`, { timeoutMs: 60000 }, async ($, on) => {
  const state = fixture(PREVIEWS[0]!)
  setup(on, state)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  for (const p of PREVIEWS) {
    Object.assign(state, fixture(p))
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /^panel error:/ })).toBeUndefined()
    for (const select of await ui.findAll({ type: 'Select' })) {
      const options = select.props.options as unknown[]
      expect(options.length).toBeGreaterThan(0)
      expect(options.length).toBeLessThanOrEqual(64)
    }
    for (const svg of await ui.findAll({ type: 'Svg' })) {
      if (svg.props.isInteractive) expect(String(svg.props.source)).not.toContain('<image')
      if (String(svg.props.source).includes('<image')) expect(!!svg.props.isInteractive).toBe(false)
    }
  }
  await ui.unmount()
})
