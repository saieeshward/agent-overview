import { expect, mock, test } from 'claude-code/testing'
import type { Stage, Ui } from '../types'
import { normalGuard } from '../hooks/state'
import { SVG_MAX } from '../hooks/vibe/engine'

for (const surface of ['terminal', 'desktop'] as const) for (const bodyColumns of [64, 110]) {
  test(`area navigation and stage gating on ${surface} at ${bodyColumns} columns`, async ($, on) => {
    mock.clock(on)
    mock.store(on); on('session.id', () => ({ value: 'test-chat' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    let stage: Stage | null = null, version = 0, ticks = 0, writes = 0
    on('state.get', { plugin: 'agent-overview', key: 'stage' }, () => ({ value: { value: stage, version } }))
    on('state.set', { plugin: 'agent-overview', key: 'stage' }, (_$, e) => {
      stage = e.value; writes++
      return { value: { isSet: true, version: ++version } }
    })
    on('state.get', { plugin: 'agent-overview', key: 'tick' }, (_$, e, next) => { ticks++; return next(e) })
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
      title: 'Overview', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {},
    } })
    for (const id of ['overview', 'work', 'vibe']) expect(await ui.find({ key: `area:${id}` })).toBeDefined()
    expect(await ui.find({ key: 'tab:dashboard' })).toBeDefined()
    if (surface === 'desktop') {
      expect((await ui.find({ key: 'area:overview' }))?.props.variant).toBe('primary')
      expect((await ui.find({ key: 'area:work' }))?.props.variant).toBeUndefined()
    } else {
      expect((await ui.findAll({ type: 'Text', text: 'DEFAULT' })).some(x => x.props.inverse === true && x.props.color === 'claude')).toBe(true)
    }
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(stage).toEqual({ at: 'plan', reached: ['plan'], round: 1, startedAt: 0, seen: ['plan'] })
    expect(await ui.find({ key: 'work:header' })).toBeDefined()
    expect(await ui.find({ key: 'work:plan' })).toBeDefined()
    expect(await ui.find({ key: 'tab:dashboard' })).toBeUndefined()
    expect(await ui.find({ key: 'wtab:implement' })).toBeUndefined()
    expect(await ui.find({ key: 'wtab:review' })).toBeUndefined()
    for (const tab of ['source', 'plan', 'settings']) {
      await ui.press({ key: `wtab:${tab}` })
      expect(await ui.drawn()).toMatchObject({ type: 'Box' })
      expect(await ui.find({ key: `work:${tab}` })).toBeDefined()
    }
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(writes).toBe(1)
    stage = { at: 'review', reached: ['plan', 'implement', 'review'], round: 2 }
    version++
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /↺ round 2/ })).toBeDefined()
    for (const tab of ['implement', 'review']) {
      await ui.press({ key: `wtab:${tab}` })
      expect(await ui.find({ key: `work:${tab}` })).toBeDefined()
    }
    await ui.press({ key: 'area:vibe' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(await ui.find({ key: 'wtab:source' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '◆ REVIEW' })).toBeUndefined()
    if (surface === 'desktop') {
      expect((await ui.find({ key: 'area:vibe' }))?.props.variant).toBe('primary')
      expect((await ui.find({ key: 'area:work' }))?.props.variant).toBeUndefined()
      const svg = await ui.find({ type: 'Svg' })
      expect(svg?.props.isInteractive).toBe(true)
      expect(String(svg?.props.source).length).toBeLessThanOrEqual(SVG_MAX)
    } else {
      expect(await ui.find({ type: 'Raster', key: 'vibe:scene' })).toBeDefined()
    }
    for (const tab of ['live', 'decisions', 'settings']) {
      await ui.press({ key: `vtab:${tab}` })
      expect(await ui.drawn()).toMatchObject({ type: 'Box' })
      expect(await ui.find({ type: 'Text', text: tab === 'live' ? /Agent HQ/ : tab === 'decisions' ? 'no decisions' : 'Styles in use' })).toBeDefined()
    }
    await ui.press({ key: 'area:overview' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(await ui.find({ key: 'tab:dashboard' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◆ REVIEW' })).toBeUndefined()
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(stage.at).toBe('review')
    expect(await ui.find({ key: 'work:review' })).toBeDefined()
    expect(stage.round).toBe(2)
    if (surface === 'desktop') expect(ticks).toBe(0)
    await ui.unmount()
  })
}

test('hidden saved Work tab falls back to Plan and live respects enabled style and still motion', async ($, on) => {
  mock.clock(on)
  mock.store(on); on('session.id', () => ({ value: 'test-chat' }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  let state: Ui = { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'implement', vibeStyle: 'office' }
  on('state.get', { plugin: 'agent-overview', key: 'ui' }, () => ({ value: { value: state, version: 0 } }))
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: normalGuard({ vibe: { styles: ['arcade'], motion: 'still' } }), version: 0 } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    state = { ...state, area: 'work' }
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
      title: 'Overview', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {},
    } })
    expect(await ui.find({ key: 'work:plan' })).toBeDefined()
    expect(await ui.find({ key: 'work:implement' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'no stage yet' })).toBeDefined()
    state = { ...state, area: 'vibe' }
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Agent Arcade/ })).toBeDefined()
    if (surface === 'desktop') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('<animate')
    await ui.unmount()
  }
})

test('Work and Vibe guard settings normalize old, invalid and duplicate values', () => {
  expect(normalGuard(undefined)).toMatchObject({ work: { ponytail: true, grill: true }, vibe: { styles: ['office', 'arcade'], motion: 'full' } })
  expect(normalGuard({ work: { ponytail: false, grill: false }, vibe: { styles: ['arcade', 'bad', 'office', 'arcade'], motion: 'calm' } })).toMatchObject({ work: { ponytail: false, grill: false }, vibe: { styles: ['office', 'arcade'], motion: 'calm' } })
  expect(normalGuard({ work: { ponytail: 0, grill: 'false' }, vibe: { styles: [], motion: 'fast' } })).toMatchObject({ work: { ponytail: true, grill: true }, vibe: { styles: ['office', 'arcade'], motion: 'full' } })
  expect(normalGuard({ vibe: { styles: 'office', motion: null } }).vibe).toEqual({ styles: ['office', 'arcade'], motion: 'full' })
  expect(normalGuard({ vibe: { styles: ['arcade'], motion: 'still' } }).vibe).toEqual({ styles: ['arcade'], motion: 'still' })
})
