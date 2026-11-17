import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const TABS = ['dashboard', 'agents', 'models', 'activity', 'plugins', 'settings']

test('every tab draws on desktop, and only the terminal reads the spinner tick', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  const ticks = { terminal: 0, desktop: 0 }
  let surface: keyof typeof ticks = 'terminal'
  on('state.get', { plugin: 'agent-overview', key: 'tick' }, (_$, e, next) => { ticks[surface]++; return next(e) })
  for (const s of ['terminal', 'desktop'] as const) {
    surface = s
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface: s, ...PANE, props })
    for (const tab of TABS) {
      await ui.press({ key: `tab:${tab}` })
      expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    }
    await ui.unmount()
  }
  expect(ticks.terminal).toBeGreaterThan(0)
  // A desktop redraw ships the whole tree: a spinner there would redraw it ~7 times a second.
  expect(ticks.desktop).toBe(0)
})

test('desktop shows the selected tab with a fill, the counters as one line, and no terminal key hint', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  // A desktop button ignores the colours inside it, so the selected one is drawn primary.
  expect((await ui.find({ key: 'tab:dashboard' }))?.props).toMatchObject({ variant: 'primary' })
  expect((await ui.find({ key: 'tab:agents' }))?.props.variant).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '█▀█' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'ctrl+x then tab to use this panel' })).toBeUndefined()
  await ui.unmount()
})

test('Claude cost shows the ledger for the whole chat, replies before this launch included', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('state.get', { plugin: 'agent-overview', key: 'costs' }, () => ({ value: { value: { rows: [], claude: {}, agy: {}, engineUsd: 3.2 }, version: 1 } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props })
    expect(await ui.find({ type: 'Text', text: /nothing counted yet/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\$3\.20/ })).toBeDefined()
    await ui.unmount()
  }
})
