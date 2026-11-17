// Real mounted AbovePrompt trees, painted by the same harness as the panel.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentNode } from '../types'
import { defaultRouting } from '../hooks/state'
import { fixture, NOW } from './pane-fixtures'
import { CONFIG } from './preview-config'

test('preview office rail', { timeoutMs: 60000 }, async ($, on) => {
  const state = fixture({ area: 'overview', tab: 'settings', scenario: 'office-rail' })
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: (state as any)[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) Object.assign(state, { [e.key]: e.value }); return r })
  on('session.id', () => ({ value: 'preview-office' }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['Existing band content'] }))
  for (const surface of ['desktop', 'terminal'] as const) for (const width of CONFIG[surface]) {
    const columns = surface === 'desktop' ? Math.floor((width - 24) / 8) : width
    for (const [style, idle, area] of [
      ['slim', false, 'overview'], ['glass', false, 'work'], ['slim', true, 'vibe'], ['glass', true, 'overview'], ['off', true, 'work'],
      ...(['heads', 'dock', 'peek', 'line', 'ticker'] as const).flatMap(style => [
        [style, false, 'overview'], [style, true, 'overview'],
      ] as const),
    ] as const) {
      state.ui.area = area; state.ui.pendingArea = undefined
      state.guard.chat.office = style; state.routing = defaultRouting()
      state.providers.claude.meters = []; state.edits = []; state.live = null; state.main.working = !idle
      state.nodes = idle ? [] : [
        { id: 'driver', agentId: 'driver-agent', provider: 'claude', model: 'sonnet', kind: 'task', state: 'running', label: 'Fix parser', steps: 1 },
        { id: 'codex', parentId: 'driver-agent', provider: 'codex', model: 'gpt-6.1-sol', kind: 'Codex', state: 'running', label: 'Run side work', steps: 3, startedAt: NOW - 134000 },
      ] as AgentNode[]
      if (!idle) {
        state.routing.on.opencode = false
        state.routing.paused = { commandcode: { why: 'quota', at: NOW - 1000, until: NOW + 1000 } }
      }
      const band = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: !idle, maxRows: 10, bodyColumns: columns, scroll: { offset: 0, bodyRows: 10 }, view: {} } })
      const tree = { type: 'Box', props: { flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch', gap: 1 }, children: [
        { type: 'Text', props: { weight: 'bold' }, children: [`${style} office · ${idle ? 'idle' : 'working / idle / off / paused'}`] },
        await band.drawn(),
        { type: 'Box', props: { borderStyle: 'round', paddingX: 1 }, children: [{ type: 'Text', props: {}, children: ['Ask anything…'] }] },
      ] }
      console.log('PANE_TREE:' + JSON.stringify({ surface, width, area, tab: 'prompt', scenario: `${style}-${idle ? 'idle' : 'mixed'}`, tree }))
      await band.unmount()
    }
    for (const area of ['overview', 'work', 'vibe'] as const) {
      state.ui.area = area; state.ui.tab = 'settings'; state.ui.workTab = 'settings'; state.ui.vibeTab = 'settings'
      const settings = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: { title: 'Agent panel', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 70 }, view: {} } })
      expect(await settings.find({ key: 'chat:row:office' })).toBeDefined()
      console.log('PANE_TREE:' + JSON.stringify({ surface, width, area, tab: 'settings', scenario: 'office-settings', tree: await settings.drawn() }))
      await settings.unmount()
    }
  }
})
