// Mounted chat surfaces, painted by pane-preview's existing desktop and terminal harness.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentNode, ChatSurfaceState } from '../types'
import { fixture, NOW } from './pane-fixtures'
import { CONFIG } from './preview-config'

if (CONFIG.scenario === 'chat-surfaces') test('preview chat surfaces', { timeoutMs: 60000 }, async ($, on) => {
  const state = { ...fixture({ area: 'work', tab: 'settings', scenario: 'chat-surfaces' }), chatSurface: { editVersion: 0, alerts: {}, waiting: 'owner' } as ChatSurfaceState }
  state.nodes = [
    { id: 'codex', provider: 'codex', model: 'gpt-6.1-sol', kind: 'Codex', state: 'running', label: 'Fix parser', steps: 3, startedAt: NOW - 134000 },
    { id: 'gemini', provider: 'antigravity', model: 'gemini-3.1-pro', kind: 'Antigravity', state: 'running', label: 'Check layout', steps: 2, startedAt: NOW - 42000 },
    { id: 'done', provider: 'opencode', model: 'kimi', kind: 'OpenCode', state: 'done', label: 'Review tests', steps: 1, startedAt: NOW - 143000, endedAt: NOW - 9000 },
  ] as AgentNode[]
  state.ui.preset = { name: 'Cheap' }
  state.providers.claude.meters = [{ label: '5h', percent: 88 }, { label: 'Context', percent: 84 }]
  state.acts = {}
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: (state as any)[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) Object.assign(state, { [e.key]: e.value }); return r })
  on('session.id', () => ({ value: 'preview-chat' }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'SessionMode' }, (_$, e) => ({ type: 'Text', props: { dimColor: true }, children: [e.props.modes.join(' & ')] }))
  on('ui.render', { component: 'PromptHint' }, (_$, e) => ({ type: 'Text', props: { dimColor: true }, children: [e.props.hint] }))
  on('ui.render', { component: 'Spinner' }, (_$, e) => ({ type: 'Text', props: {}, children: [e.props.message ?? e.props.word] }))
  for (const surface of ['desktop', 'terminal'] as const) for (const width of CONFIG[surface]) {
    const columns = surface === 'desktop' ? Math.floor((width - 24) / 8) : width
    for (const area of ['work', 'vibe', 'overview'] as const) {
      state.ui.area = area; state.ui.pendingArea = undefined
      const status = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'SessionMode', props: { modes: ['focus'] } })
      const hint = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'PromptHint', props: { hint: '? for shortcuts', isDraft: false, isWorking: true } })
      const band = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: columns, scroll: { offset: 0, bodyRows: 10 }, view: {} } })
      const spinner = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Spinner', props: { word: 'Working', message: null, suffix: '…', mode: 'tool-use' } })
      const tree = { type: 'Box', props: { flexDirection: 'column', gap: 1, paddingX: 1 }, children: [
        { type: 'Text', props: { weight: 'bold' }, children: ['Prompt surfaces'] },
        await spinner.drawn(), await band.drawn(),
        { type: 'Box', props: { borderStyle: 'round', paddingX: 1 }, children: [{ type: 'Text', props: {}, children: ['@codex fix the parser'] }] },
        await hint.drawn(), await status.drawn(),
      ] }
      expect(JSON.stringify(tree).includes('panel error:')).toBe(false)
      console.log('PANE_TREE:' + JSON.stringify({ surface, width, area, tab: 'prompt', scenario: `${area}-chat-surfaces`, tree }))
      for (const ui of [status, hint, band, spinner]) await ui.unmount()
      state.ui.tab = 'settings'; state.ui.workTab = 'settings'; state.ui.vibeTab = 'settings'
      const settings = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: { title: 'Agent panel', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 70 }, view: {} } })
      expect(await settings.find({ key: 'chat:settings' })).toBeDefined()
      console.log('PANE_TREE:' + JSON.stringify({ surface, width, area, tab: 'settings', scenario: `${area}-chat-settings`, tree: await settings.drawn() }))
      await settings.unmount()
    }
  }
})
