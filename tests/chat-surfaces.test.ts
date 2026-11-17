import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On, PluginState, RenderElement } from 'claude-code'
import type { AgentNode, AlertKind, Provider } from '../types'
import { blank, defaultRouting, normalGuard, tagOf, withPicks, withTag } from '../hooks/state'
import { contextHint, mentionSuggestions, MENTIONS, usageLines } from '../hooks/chat-surfaces'
import { isTestCommand, literalWords, permissionContext } from '../hooks/chat-permission'

type State = Partial<PluginState['agent-overview']>
const NOW = 1000000
const commandOrigin = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const children = (tree: RenderElement) => tree.type === 'engine' ? undefined : tree.children
function setup(on: On, initial: State = {}) {
  const clock = mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/fixture' })
  const state: State = {
    ui: { tab: 'settings', pick: 'claude' }, main: { model: 'claude-opus-4-6' },
    routing: withPicks(defaultRouting(), [{ provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' }, { provider: 'opencode', model: 'open/model', effort: 'high' }, { provider: 'commandcode', model: 'cmd-model', effort: 'low' }, { provider: 'antigravity', model: 'gemini-model' }]),
    providers: { claude: { ...blank(), status: 'ok' }, codex: { ...blank(), status: 'ok' }, opencode: { ...blank(), status: 'ok' }, commandcode: { ...blank(), status: 'ok' }, antigravity: { ...blank(), status: 'ok' } },
    guard: normalGuard(undefined), nodes: [], edits: [], decisions: [], findings: [],
    chatSurface: { editVersion: 0, alerts: {} }, ...initial,
  }
  const versions: Record<string, number> = {}
  on('state.get', { plugin: 'agent-overview' }, (_$, e) => ({ value: { value: state[e.key], version: versions[e.key] ?? 0 } } as any))
  on('state.set', { plugin: 'agent-overview' }, (_$, e) => {
    const version = versions[e.key] ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
    Object.assign(state, { [e.key]: JSON.parse(JSON.stringify(e.value)) }); versions[e.key] = version + 1
    return { value: { isSet: true, version: version + 1 } }
  })
  on('process.run', (_$, e) => ({ value: { stdout: '', stderr: '', exitCode: e.argv.includes('--cached') ? 0 : 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.id', () => ({ value: 'chat-surfaces' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => { throw new Error('fixture has no files') })
  on('http.fetch', () => { throw new Error('fixture has no network') })
  const notifications: string[] = [], sounds: string[] = [], toasts: string[] = [], notices: { id: string; text?: string }[] = []
  on('ui.notify', (_$, e) => { notifications.push(e.text); return { value: { isSent: true, channel: 'fixture' } as any } })
  on('audio.play', (_$, e) => { sounds.push('asset' in e.clip ? e.clip.asset ?? 'other' : 'other'); return { value: undefined } })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.notice', (_$, e) => { notices.push({ id: e.tool_use_id, text: e.text }); return { value: undefined } })
  const unit = {
    state: { get: async (ref: { key: keyof State }) => ({ value: state[ref.key], version: 0 }) },
    clock: { now: async () => clock.now() }, session: { cwd: async () => '/repo' },
    process: { run: async (_argv: readonly string[], _init?: unknown) => ({ stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false }) },
    fs: { exists: async (_path: string) => false, stat: async (_path: string) => ({ kind: 'file', size: 0, mtimeMs: 0, isLink: false }), list: async (_path?: string) => [] as any[] },
  }
  return { state, clock, notifications, sounds, toasts, notices, unit, api: unit as unknown as EngineInterface }

}
const pane = { title: 'Agent panel', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const band = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const user = { origin: { kind: 'composer' as const }, wait: false }
const run = (id: string, patch: Partial<AgentNode> = {}): AgentNode => ({ id, provider: 'codex', kind: 'Codex', model: 'gpt-6.1-sol', label: 'Fix parser', state: 'running', steps: 1, startedAt: NOW - 134000, ...patch })
function renderEngine(on: On) {
  on('ui.render', { component: 'SessionMode' }, (_$, e) => ({ type: 'Text', props: {}, children: [e.props.modes.join(' & ')] }))
  on('ui.render', { component: 'PromptHint' }, (_$, e) => ({ type: 'Text', props: {}, children: [e.props.hint + (e.props.tail ? ` ${e.props.tail}` : '')] }))
  on('ui.render', { component: 'Spinner' }, (_$, e) => ({ type: 'Text', props: {}, children: [(e.props.message ?? e.props.word) + e.props.suffix] }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['engine band'] }))
}

test('chat switches migrate old saves, keep false, and sounds start off', () => {
  const g = normalGuard(undefined).chat
  expect(g.hint).toBe(true); expect(g.sounds).toBe(false)
  for (const kind of ['run', 'review', 'quota', 'question'] as AlertKind[]) expect(g.events[kind]).toEqual({ notify: true, sound: true })
  const held = { ...g, hint: false, stripRuns: false, mentions: false, events: { ...g.events, quota: { notify: false, sound: false } } }
  expect(normalGuard({ chat: held }).chat).toEqual(held)
})

test('passing-test claims require a test runner, not a quoted mention or masked shell failure', () => {
  for (const command of ['npm test', 'npm run test:e2e', 'npx -y vitest run', 'python3 -m pytest', 'claude plugin test .']) expect(isTestCommand(literalWords(command)!)).toBe(true)
  for (const command of ['echo "npm test"', 'npm test || true', 'printf "test"', 'tsc -p .']) expect(isTestCommand(literalWords(command) ?? [])).toBe(false)
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`footer keeps engine labels and adds only the active mode and preset (${surface})`, async ($, on) => {
    const { state } = setup(on); renderEngine(on)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'SessionMode', props: { modes: ['focus', 'memory paused'] } })
    expect(children(await ui.drawn())).toEqual(['focus & memory paused'])
    state.ui!.area = 'work'; state.ui!.preset = { name: 'Cheap' }; state.stage = { at: 'review', reached: ['plan', 'review'], round: 1 }
    await ui.redraw(); expect(children(await ui.drawn())).toEqual(['focus & memory paused & Work · Review & Cheap'])
    state.ui!.pendingArea = 'vibe'; await ui.redraw(); expect(children(await ui.drawn())).toEqual(['focus & memory paused & Work · Review & Cheap'])
    state.ui!.area = 'vibe'; await ui.redraw(); expect(children(await ui.drawn())).toEqual(['focus & memory paused & Vibe & Cheap'])
    state.ui!.area = 'overview'; state.ui!.preset = undefined; await ui.redraw(); expect(children(await ui.drawn())).toEqual(['focus & memory paused'])
    await ui.unmount()
  })
  test(`hint selects one owner action and otherwise keeps the engine line (${surface})`, async ($, on) => {
    const { state } = setup(on); renderEngine(on)
    state.guard!.usageTail = false
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'PromptHint', props: { hint: 'engine hint', isDraft: false, isWorking: false } })
    expect(children(await ui.drawn())).toEqual(['engine hint'])
    state.ui!.area = 'work'; state.providers!.claude.meters = [{ label: '5h', percent: 88 }]
    await ui.redraw(); expect(children(await ui.drawn())).toEqual(['plan locked · advance in panel'])
    state.stage = { at: 'review', reached: ['review'], round: 1 }
    state.findings = [1, 2].map(i => ({ file: `f${i}`, severity: 'high', text: 'bug', by: ['reviewer'], at: NOW }))
    await ui.redraw(); expect(children(await ui.drawn())).toEqual(['Claude 12% left · /handover'])
    state.providers!.claude.meters = [{ label: 'Context', percent: 99 }, { label: '5h', percent: 80 }]
    await ui.redraw(); expect(children(await ui.drawn())).toEqual(['review · 2 high findings'])
    state.findings[0]!.dismissed = true; await ui.redraw(); expect(children(await ui.drawn())).toEqual(['review · 1 high finding'])
    state.ui!.area = 'vibe'; state.chatSurface!.waiting = 'question'
    await ui.redraw(); expect(children(await ui.drawn())).toEqual(['waiting on you'])
    state.guard!.chat.hint = false; await ui.redraw(); expect(children(await ui.drawn())).toEqual(['engine hint'])
    await ui.unmount()
  })
  test(`band shows driven runs, finishes for 20s, keeps old content and shares undo (${surface})`, async ($, on) => {
    const { state, clock } = setup(on); renderEngine(on)
    state.nodes = [run('driver', { provider: 'claude', agentId: 'driver-agent', label: 'Fix parser', model: 'sonnet' }), run('side', { parentId: 'driver-agent' }), run('done', { provider: 'opencode', state: 'done', endedAt: NOW - 1 })]
    state.providers!.claude.meters = [{ label: '5h', percent: 88 }, { label: 'Context', percent: 89 }]
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'AbovePrompt', props: band })
    const rail = await ui.find({ type: 'Svg' })
    expect(!!rail).toBe(surface === 'desktop')
    if (rail) {
      expect(rail.props.source).toContain('viewBox="0 0 192 20"')
      expect(rail.props.isInteractive).toBeUndefined()
      expect(String(rail.props.alt).length).toBeGreaterThan(0)
      expect(rail.props.source).toContain('data-provider="codex" data-state="working"')
      expect(rail.props.source).toContain('data-provider="claude" data-state="idle"')
    }
    expect((await ui.find({ type: 'Text', text: 'Codex·gpt-6.1-sol · Fix parser' }))?.text).toBe('Codex·gpt-6.1-sol · Fix parser')
    expect(await ui.find({ type: 'Text', text: '· 2:14' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Claude·sonnet · Fix parser' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'OpenCode done ·' }))?.text).toBe('OpenCode done · 2m 13s')
    expect(await ui.find({ type: 'Text', text: /context 89%/ })).toBeDefined()
    await ui.press({ key: 'chat:handoff' }); await ui.redraw(); expect(tagOf(state.routing!, 'codex')).toBe('main'); expect(tagOf(state.routing!, 'claude')).toBe('saver')
    await ui.press({ key: 'chat:undo' }); expect(tagOf(state.routing!, 'claude')).toBe('normal')
    await clock.advance(20000); await ui.redraw(); expect(await ui.find({ type: 'Text', text: 'OpenCode done ·' })).toBeUndefined()
    state.guard!.chat.stripRuns = false; state.guard!.chat.stripQuota = false
    await ui.redraw(); expect(await ui.find({ type: 'Text', text: 'Codex·gpt-6.1-sol · Fix parser' })).toBeUndefined(); expect(await ui.find({ key: 'chat:quota' })).toBeUndefined()
    await ui.unmount()
    const survey = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'AbovePrompt', props: { ...band, hasSurvey: true } })
    expect(children(await survey.drawn())).toEqual(['engine band']); await survey.unmount()
  })
  test(`shared switches persist across Default Work and Vibe settings (${surface})`, async ($, on) => {
    const { state } = setup(on)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: pane })
    await ui.press({ key: 'chat:hint:false' }); await ui.press({ key: 'chat:sounds:true' })
    await ui.press({ key: 'chat:review:notify:false' }); await ui.press({ key: 'chat:review:sound:false' })
    expect(await ui.find({ key: 'chat:row:office' })).toBeDefined()
    for (const office of ['off', 'slim', 'glass', 'heads', 'dock', 'peek', 'line', 'ticker'] as const) {
      expect(await ui.find({ key: `chat:office:${office}` })).toBeDefined()
      await ui.press({ key: `chat:office:${office}` })
      expect(state.guard!.chat.office).toBe(office)
    }
    for (const area of ['work', 'vibe'] as const) {
      state.ui!.area = area; state.ui!.pendingArea = undefined; state.ui!.workTab = 'settings'; state.ui!.vibeTab = 'settings'
      await ui.redraw()
      expect(await ui.find({ key: 'chat:settings' })).toBeDefined()
      expect(state.guard!.chat).toMatchObject({ office: 'ticker', hint: false, sounds: true, events: { review: { notify: false, sound: false } } })
      expect(await ui.find({ key: 'chat:office:off' })).toBeDefined()
      expect(await ui.find({ key: 'chat:office:slim' })).toBeDefined()
      expect(await ui.find({ key: 'chat:quota:sound:true' })).toBeDefined()
    }
    await ui.unmount()
  })
}

test('office stays above existing engine content in every mode, with stable source and fixed height', async ($, on) => {
  const { state, clock } = setup(on); renderEngine(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'AbovePrompt', props: band })
  const first = (await ui.find({ type: 'Svg' }))!.props.source
  for (const area of ['overview', 'work', 'vibe'] as const) {
    state.ui!.area = area
    await clock.advance(3000); await ui.redraw()
    const rail = (await ui.find({ type: 'Svg' }))!
    expect(rail.props.source).toBe(first)
    expect(rail.props.source).toContain('viewBox="0 0 192 20"')
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    const tree = await ui.drawn()
    expect(tree.type === 'Box' && (tree.children?.[0] as any).props.key).toBe('chat:office')
    // The engine refuses its own drawing under a Box with a width.
    expect((tree as any).props.width).toBeUndefined()
  }
  state.guard!.chat.office = 'glass'; state.main!.working = true
  await ui.redraw()
  expect((await ui.find({ type: 'Svg' }))!.props.source).toContain('viewBox="0 0 192 30"')
  expect((await ui.find({ type: 'Svg' }))!.props.source).toContain('data-provider="claude" data-state="working"')
  state.guard!.chat.office = 'off'; await ui.redraw()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(children(await ui.drawn())).toEqual(['engine band'])
  await ui.unmount()
})

test('all five agents-only rails mount as plain SVGs at fixed CSS-pixel heights in every mode', async ($, on) => {
  const { state, clock } = setup(on); renderEngine(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'AbovePrompt', props: band })
  for (const [style, height] of [['heads', 20], ['dock', 24], ['peek', 16], ['line', 24], ['ticker', 20]] as const) {
    state.guard!.chat.office = style
    await ui.redraw()
    const first = (await ui.find({ type: 'Svg' }))!.props.source
    for (const area of ['overview', 'work', 'vibe'] as const) {
      state.ui!.area = area
      await clock.advance(3000); await ui.redraw()
      const rail = (await ui.find({ type: 'Svg' }))!
      expect(rail.props).toMatchObject({ width: 2000, height, source: first })
      expect(rail.props.isInteractive).toBeUndefined()
      expect(String(rail.props.alt).length).toBeGreaterThan(0)
      expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    }
  }
  await ui.unmount()
})

test('no quota hand-off hint without an available other provider; threshold is strictly below 20', async ($, on) => {
  const { state, api } = setup(on)
  state.providers!.claude.meters = [{ label: '5h', percent: 80 }]
  expect(await contextHint(api)).toBeUndefined()
  state.providers!.claude.meters[0]!.percent = 81
  for (const p of ['codex', 'opencode', 'commandcode', 'antigravity'] as Provider[]) state.routing!.on[p] = false
  expect(await contextHint(api)).toBeUndefined()
})

test('desktop spinner names only active side work; terminal and Claude work keep engine text', async ($, on) => {
  const { state } = setup(on); renderEngine(on)
  state.nodes = [run('side')]
  const props = { word: 'Working', message: null, suffix: '…', mode: 'tool-use' as const }
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Spinner', props })
  expect(children(await ui.drawn())).toEqual(['Codex Fix parser · 2:14'])
  state.nodes = [run('driver', { provider: 'claude', agentId: 'driver-agent', model: 'sonnet' }), run('side', { parentId: 'driver-agent' })]
  state.acts = { main: { key: 'main', tool: 'Agent', toolUseId: 'driver', title: 'Fix parser', state: 'running', at: NOW } }
  await ui.redraw(); expect(children(await ui.drawn())).toEqual(['Codex Fix parser · 2:14'])
  state.acts = { main: { key: 'main', tool: 'Edit', title: 'view.tsx', state: 'running', at: NOW } }
  await ui.redraw(); expect(children(await ui.drawn())).toEqual(['Working…'])
  state.acts = {}; state.guard!.chat.spinner = false
  await ui.redraw(); expect(children(await ui.drawn())).toEqual(['Working…']); await ui.unmount()
  const terminal = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Spinner', props })
  expect(children(await terminal.drawn())).toEqual(['Working…']); await terminal.unmount()
})

test('provider autocomplete displays routing model and effort and hides off providers', async (_$, on) => {
  const { state } = setup(on)
  const suggestions = mentionSuggestions(state.routing!, '@')
  expect(suggestions).toHaveLength(6)
  expect(suggestions.find(s => s.text === '@codex')?.description).toBe('Codex · gpt-6.1-sol · xhigh')
  state.routing!.on.codex = false
  expect(mentionSuggestions(state.routing!, '@c').some(s => s.text === '@codex')).toBe(false)
  expect(mentionSuggestions(state.routing!, '@GEM')).toEqual([{ text: '@gemini', description: 'Antigravity · gemini-model' }])
})

test('all aliases delegate a complete run using HOW; file mentions, commands and meta prompts stay intact', async ($, on) => {
  const { state, toasts } = setup(on)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('prompt.mention', () => ({ type: 'file' }))
  for (const [alias, provider] of Object.entries(MENTIONS)) {
    const result = await $.prompt.submit({ ...user, text: `Please @${alias} fix parser` })
    expect(result.text).toContain('in one complete run')
    expect(result.text).toContain('Task:\nPlease  fix parser')
    expect(result.text).toContain(provider === 'antigravity' ? state.routing!.agyVisualModel : state.routing!.picks.find(p => p.provider === provider)!.model)
    expect((await $.prompt.mention({ mention: alias, path: `/repo/${alias}` })).type).toBeNull()
  }
  state.routing!.on.codex = false
  expect((await $.prompt.submit({ ...user, text: '@codex fix this' })).text).toBe('@codex fix this')
  expect(toasts.at(-1)).toBe('Codex is off; prompt unchanged')
  expect((await $.prompt.submit({ ...user, text: 'read @codex/file.ts and mail x@codex.com' })).text).toBe('read @codex/file.ts and mail x@codex.com')
  expect((await $.prompt.mention({ mention: 'codex/file.ts', path: '/repo/codex/file.ts' })).type).toBe('file')
  expect((await $.prompt.submit({ ...user, text: '@opencode fix', isMeta: true })).text).toBe('@opencode fix')
  state.guard!.chat.mentions = false
  expect((await $.prompt.submit({ ...user, text: '@opencode fix' })).text).toBe('@opencode fix')
})

test('slash hand-off and undo share Crew, and undo refuses later routing edits', async ($, on) => {
  const { state, clock, toasts } = setup(on)
  expect((await $.command.run({ ...commandOrigin, command: 'handover', args: '' })).text).toContain('Codex is Main')
  expect(state.ui!.vibeUndo).toBeDefined()
  expect((await $.command.run({ ...commandOrigin, command: 'handover', args: 'undo' })).text).toBe('Hand-off undone.')
  await $.command.run({ ...commandOrigin, command: 'handover', args: '' }); state.routing!.agyCoding = true
  expect((await $.command.run({ ...commandOrigin, command: 'handover', args: 'undo' })).text).toBe('No hand-off to undo.')
  expect(toasts.at(-1)).toBe('Routing changed')
  await clock.advance(30000)
  expect((await $.command.run({ ...commandOrigin, command: 'handover', args: 'undo' })).text).toBe('No hand-off to undo.')
})

test('slash mode opens the real preview; only its confirmation between turns changes mode', async ($, on) => {
  const { state } = setup(on); state.main!.working = true
  expect((await $.command.run({ ...commandOrigin, command: 'mode', args: 'work' })).text).toContain('Finish or stop this turn')
  expect(state.ui!.area).toBeUndefined(); expect(state.ui!.pendingArea).toBe('work')
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: pane })
  await ui.press({ key: 'area:confirm' }); expect(state.ui!.area).toBeUndefined()
  state.main!.working = false; await ui.redraw(); await ui.press({ key: 'area:confirm' })
  expect(state.ui!.area).toBe('work'); expect(state.stage!.at).toBe('plan')
  await $.command.run({ ...commandOrigin, command: 'mode', args: 'vibe' }); await ui.redraw(); await ui.press({ key: 'area:cancel' })
  expect(state.ui!.area).toBe('work')
  expect((await $.command.run({ ...commandOrigin, command: 'mode', args: 'unknown' })).text).toBe('Use /mode default|work|vibe.')
  await ui.unmount()
})

test('preset, guard, usage and decisions commands use shared state', async ($, on) => {
  const { state } = setup(on)
  expect((await $.command.run({ ...commandOrigin, command: 'preset', args: '' })).text).toContain('Cheap')
  expect((await $.command.run({ ...commandOrigin, command: 'preset', args: 'cheap' })).text).toBe('Preset: Cheap.')
  expect(state.ui!.preset?.name).toBe('Cheap')
  expect((await $.command.run({ ...commandOrigin, command: 'preset', args: 'unknown' })).text).toContain('Unknown preset')
  expect((await $.command.run({ ...commandOrigin, command: 'preset', args: 'Custom' })).text).toBe('Preset: Custom.')
  for (const value of ['enforce', 'off', 'warn'] as const) { await $.command.run({ ...commandOrigin, command: 'guard', args: value }); expect(state.guard!.routingGuard).toBe(value) }
  expect((await $.command.run({ ...commandOrigin, command: 'guard', args: 'bad' })).text).toBe('Use /guard warn|enforce|off.')
  state.providers!.claude.meters = [{ label: '5h', percent: 87.25, detail: 'resets in 2h' }]
  expect(usageLines(state.providers!, state.routing!)).toContain('Claude: 5h 12.75% left · resets in 2h')
  expect((await $.command.run({ ...commandOrigin, command: 'usage', args: '' })).text?.split('\n')).toHaveLength(5)
  state.decisions = Array.from({ length: 7 }, (_, i) => ({ decision: `Choice ${i}`, why: 'Reason', impact: 'low', at: NOW + i }))
  expect((await $.command.run({ ...commandOrigin, command: 'decisions', args: '' })).text).toBe([2, 3, 4, 5, 6].map(i => `Choice ${i} · Reason`).join('\n'))
})

test('notifications fire on transitions, rate limit each kind for a minute, and sounds require master', async ($, on) => {
  const { state, clock, notifications, sounds } = setup(on)
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    await clock.advance(134000)
    return String((e as any).command).includes('quota') ? { result: 'quota exceeded', text: 'quota exceeded', isError: true } : { result: 'done' }
  })
  await ($.tool.call as any)({ tool: 'Bash', tool_use_id: 'long', command: 'codex exec "fix"' } as any)
  expect(notifications).toHaveLength(1); expect(notifications[0]).toContain('Codex done · 2m 14s'); expect(sounds).toHaveLength(0)
  const high = async (file: string) => ($.tool.call as any)({ tool: 'mcp__agent-overview__review_log', tool_use_id: file, file, severity: 'high', text: 'bug', by: 'reviewer' } as any)
  await high('a'); await high('a'); await high('b'); expect(notifications).toHaveLength(2)
  await ($.tool.call as any)({ tool: 'Bash', tool_use_id: 'quota', command: 'codex exec "quota"' } as any)
  expect(notifications.some(n => n === 'Codex is out of quota')).toBe(true)
  await clock.advance(60000)
  state.guard!.chat.sounds = true
  await high('c'); expect(sounds).toEqual(['sounds/review.wav'])
  state.guard!.chat.events.review = { notify: false, sound: false }
  await clock.advance(60000); const count = notifications.length
  await high('d'); expect(sounds).toHaveLength(1); expect(notifications).toHaveLength(count)
})

test('sounds can be selected independently of notifications and playback failures leave tool results intact', async ($, on) => {
  const { state, notifications } = setup(on)
  state.guard!.chat.sounds = true; state.guard!.chat.events.review.notify = false
  on('audio.play', { clip: { asset: 'sounds/review.wav' } } as any, () => { throw new Error('no player') })
  const result = await ($.tool.call as any)({ tool: 'mcp__agent-overview__review_log', tool_use_id: 'high', file: 'file.ts', severity: 'high', text: 'bug', by: 'reviewer' } as any)
  expect(result.result).toBe('logged'); expect(notifications).toHaveLength(0)
})

test('Vibe questions after ten minutes notify, hints clear on the owner reply, and other modes stay quiet', async ($, on) => {
  const { state, notifications, api } = setup(on)
  state.ui!.area = 'vibe'
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  await $.turn.complete({ turnId: 'long', answer: 'Which branch?', durationMs: 600001, isAborted: false, reason: 'answer' })
  expect(notifications).toEqual(['Claude is waiting on you']); expect(await contextHint(api)).toBe('waiting on you')
  await $.prompt.submit({ ...user, text: 'main' }); expect(state.chatSurface!.waiting).toBeUndefined()
  state.ui!.area = 'overview'
  await $.turn.complete({ turnId: 'default', answer: 'Which branch?', durationMs: 900000, isAborted: false, reason: 'answer' })
  expect(state.chatSurface!.waiting).toBeUndefined(); expect(notifications).toHaveLength(1)
})

test('an allowed Vibe question notifies once even when its check or dialog repeats a minute later', async ($, on) => {
  const { state, notifications, clock } = setup(on)
  state.ui!.area = 'vibe'; state.chatSurface!.waiting = 'question'; state.chatSurface!.vibeSince = NOW - 600001
  on('ui.render', { component: 'AskUserQuestion' }, () => ({ type: 'engine', ref: 0 }))
  on('tool.check', () => ({ decision: 'allow' }))
  const input = { tool: 'AskUserQuestion', tool_use_id: 'question', input: { questions: [] } }
  await $.tool.check(input)
  const dialog = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'AskUserQuestion', requestId: 'question', props: { tool: 'AskUserQuestion', questions: [] } })
  expect(notifications).toEqual(['Claude is waiting on you'])
  await clock.advance(61000); await $.tool.check(input); await dialog.redraw(); expect(notifications).toHaveLength(1)
  await dialog.unmount()
})

test('repository metadata changes outside tool calls invalidate a passing-test notice', async (_$, on) => {
  const { state, unit, api } = setup(on)
  unit.process.run = async argv => ({ stdout: argv.includes('--cached') ? 'file.ts\0' : 'feature\n', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false })
  unit.fs.stat = async () => ({ kind: 'file', size: 10, mtimeMs: 2, isLink: false })
  state.chatSurface!.test = { at: NOW - 180000, version: 0, passed: true, cwd: '/repo', files: JSON.stringify([['file.ts', 10, 1]]) }
  expect(await permissionContext(api, 'Bash', { command: 'git push origin feature' })).toBe('push to feature · tests not run since last edit')
  state.chatSurface!.test.files = JSON.stringify([['file.ts', 10, 2]])
  expect(await permissionContext(api, 'Bash', { command: 'git push origin feature' })).toBe('push to feature · tests passed 3m ago')
})

test('permission context tracks successful tests, invalidates on edits, and never changes permission decisions', async ($, on) => {
  const { state, clock, notices, api } = setup(on)
  state.git = { branch: 'feature', commit: '', dirty: 1, ahead: '' }
  on('tool.call', () => ({ result: 'ok' }))
  on('tool.check', () => ({ decision: 'ask' }))
  await ($.tool.call as any)({ tool: 'Bash', tool_use_id: 'tests', command: 'npm test' } as any)
  await clock.advance(180000)
  const ask = { tool: 'Bash', tool_use_id: 'push', input: { command: 'git push origin HEAD' } }
  expect(await $.tool.check(ask)).toEqual({ decision: 'ask' })
  expect(notices.at(-1)).toEqual({ id: 'push', text: 'push to feature · tests passed 3m ago' })
  await ($.tool.call as any)({ tool: 'Write', tool_use_id: 'edit', file_path: 'x', content: 'new' } as any)
  await $.tool.check(ask)
  expect(notices.at(-1)?.text).toBe('push to feature · tests not run since last edit')
  state.routing = withTag(state.routing!, 'codex', 'main')
  expect(await permissionContext(api, 'Agent', { model: 'opus' })).toBe('Opus subagent while Codex is Main')
  state.guard!.chat.permission = false
  const before = notices.length; await $.tool.check(ask); expect(notices).toHaveLength(before)
})

test('permission context counts literal rm targets without following links; unknown commands add no line', async ($, on) => {
  const { unit, api } = setup(on)
  unit.fs.exists = async () => true
  unit.fs.stat = async path => ({ kind: path === '/repo/cache' ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: path.endsWith('link') })
  unit.fs.list = async () => [{ name: 'one' }, { name: 'link' }]
  expect(await permissionContext(api, 'Bash', { command: 'rm -rf cache' })).toBe('deletes 2 files')
  for (const command of ['echo "rm -rf cache"', 'rm -rf "$HOME"', 'rm -rf cache/*', 'git status', 'rm -rf cache; git status']) expect(await permissionContext(api, 'Bash', { command })).toBeUndefined()
  expect(literalWords("rm -rf 'cache folder'")).toEqual(['rm', '-rf', 'cache folder'])
  expect(literalWords('rm -rf $(find .)')).toBeUndefined()
})

test('reset counts only known deleted tracked files and push/PR use explicit branch targets', async ($, on) => {
  const { unit, api } = setup(on)
  unit.process.run = async argv => ({ stdout: argv.includes('diff') ? 'new.ts\0' : '', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false })
  expect(await permissionContext(api, 'Bash', { command: 'git reset --hard' })).toBe('deletes 1 files')
  expect(await permissionContext(api, 'Bash', { command: 'git push origin HEAD:topic' })).toBe('push to topic · tests not run since last edit')
  expect(await permissionContext(api, 'Bash', { command: 'gh pr create --head topic --title "Small fix"' })).toBe('push to topic · tests not run since last edit')
})

test('the rail names the active preset (Custom without one) and the label can be switched off', async ($, on) => {
  const { state } = setup(on); renderEngine(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'AbovePrompt', props: band })
  state.ui = { ...state.ui!, preset: { name: 'Cheap' } as any }; await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Cheap' })).toBeDefined()
  state.ui = { ...state.ui!, preset: undefined }; await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Custom' })).toBeDefined()
  for (const office of ['heads', 'glass'] as const) {
    state.guard!.chat.office = office; await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Custom' })).toBeDefined()
  }
  state.guard!.chat.railPreset = false; await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Custom' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})
