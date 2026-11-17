import { expect, mock, test } from 'claude-code/testing'
import type { Stage, Tab, Ui, VibeStyle, VibeTab, WorkTab } from '../types'
import { normalGuard } from '../hooks/state'

// Every area, tab and vibe style draws on both surfaces at a narrow and a wide pane.
const overview: Tab[] = ['dashboard', 'agents', 'models', 'activity', 'plugins', 'settings']
const work: WorkTab[] = ['source', 'plan', 'implement', 'review', 'settings']
const vibe: [VibeTab, VibeStyle][] = [['live', 'office'], ['live', 'arcade'], ['decisions', 'office'], ['settings', 'office']]
const views: Ui[] = [
  ...overview.map(tab => ({ tab, pick: 'claude', area: 'overview' }) as Ui),
  ...work.map(workTab => ({ tab: 'dashboard', pick: 'claude', area: 'work', workTab }) as Ui),
  ...vibe.map(([vibeTab, vibeStyle]) => ({ tab: 'dashboard', pick: 'claude', area: 'vibe', vibeTab, vibeStyle }) as Ui),
]

for (const surface of ['terminal', 'desktop'] as const) for (const bodyColumns of [64, 110]) {
  test(`every area and tab draws on ${surface} at ${bodyColumns} columns`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    let ui: Ui = views[0]!
    const stage: Stage = { at: 'review', reached: ['plan', 'implement', 'review'], round: 1 }
    on('state.get', { plugin: 'agent-overview', key: 'ui' }, () => ({ value: { value: ui, version: 0 } }))
    on('state.get', { plugin: 'agent-overview', key: 'stage' }, () => ({ value: { value: stage, version: 0 } }))
    on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: normalGuard({}), version: 0 } }))
    const pane = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
      title: 'Overview', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {},
    } })
    for (const view of views) {
      ui = view
      await pane.redraw()
      expect(await pane.drawn()).toMatchObject({ type: 'Box' })
      if (view.area === 'work') expect(await pane.find({ key: `work:${view.workTab}` })).toBeDefined()
      if (view.area === 'vibe' && view.vibeTab === 'live') expect(await pane.find({ type: 'Text', text: view.vibeStyle === 'arcade' ? /Agent Arcade/ : /Agent HQ/ })).toBeDefined()
    }
    await pane.unmount()
  })
}
