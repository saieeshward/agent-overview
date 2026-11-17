import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { reviewCwd } from '../hooks/register'
import { blank, defaultRouting, loadRouting, normalGuard, normalRouting, pruneStore, storeRouting, withFlags } from '../hooks/state'
import type { Act, AgentNode, EditItem } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
function held(on: On, state: Record<string, any>) {
  let version = 0
  on('state.get', { plugin: 'agent-overview' }, (_$, e, next) => e.key in state ? { value: { value: state[e.key], version } } : next(e))
  on('state.set', { plugin: 'agent-overview' }, (_$, e, next) => { if (!(e.key in state)) return next(e); state[e.key] = e.value; return { value: { isSet: true, version: ++version } } })
}
const fail = { value: { stdout: '', stderr: 'unavailable', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }
const child: AgentNode = { id: 'parent', agentId: 'agent', kind: 'general-purpose', model: 'claude', label: 'Build the thing', state: 'running', steps: 0, startedAt: 1000, run: 'turn:new' }

test('routing edits change this chat only, while guard edits keep other chats changes', async ($, on) => {
  mock.clock(on)
  const saved = defaultRouting()
  saved.on.opencode = false
  saved.picks = [{ provider: 'codex', model: 'other-chat-pick' }]
  mock.store(on, { routing: saved, guard: normalGuard({ caps: { codex: 12 }, review: true }) })
  const state = { routing: defaultRouting(), guard: normalGuard(undefined) }
  held(on, state)
  on('process.run', () => fail)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  await ui.press({ key: 'tab:models' })
  await ui.press({ key: 'open:codex' })
  await ui.press({ key: 'pon:codex' })
  expect(state.routing.on.opencode).toBe(true)
  expect(state.routing.on.codex).toBe(false)
  expect(state.routing.picks.some(p => p.model === 'other-chat-pick')).toBe(false)
  await ui.press({ key: 'tab:settings' })
  await ui.press({ key: 'setting:mediaWidget:false' })
  expect(state.guard.caps.codex).toBe(12)
  expect(state.guard.review).toBe(true)
  expect(state.guard.mediaWidget).toBe(false)
  await ui.unmount()
})

test('desktop hides terminal settings and provider Off stays unfilled; all available models and errors are reachable', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const models = Array.from({ length: 84 }, (_, i) => ({ id: `model-${i}` }))
  held(on, { providers: { claude: blank(), codex: { ...blank(), status: 'error', note: 'old account data', error: 'usage failed', models }, opencode: blank(), commandcode: blank(), antigravity: blank() } })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props })
    await ui.press({ key: 'tab:settings' })
    expect(!!await ui.find({ key: 'card:settings:chat' })).toBe(surface === 'terminal')
    expect(!!await ui.find({ key: 'setting:ticker:true' })).toBe(surface === 'terminal')
    await ui.press({ key: 'tab:models' })
    await ui.press({ key: 'open:codex' })
    await ui.press({ key: 'model:add:codex' })
    const ranges = (await ui.find({ key: 'model:addmodel:codex:range' }))!.props.options as { value: string }[]
    await ui.select({ key: 'model:addmodel:codex:range', value: ranges.at(-1)!.value })
    expect(((await ui.find({ key: 'model:addmodel:codex' }))!.props.options as { value: string }[]).some(o => o.value === 'model-83')).toBe(true)
    await ui.press({ key: 'model:add:codex' })
    expect(await ui.find({ type: 'Text', text: 'old account data' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'usage failed' })).toBeDefined()
    if (surface === 'desktop') {
      expect((await ui.find({ key: 'pon:codex' }))?.props.variant).toBe('primary')
      await ui.press({ key: 'pon:codex' })
      expect((await ui.find({ key: 'pon:codex' }))?.props.variant).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('cap controls exist without usage blocks, and side session costs use a short period label', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const state = { guard: normalGuard(undefined), costs: { rows: [], claude: {}, agy: {}, base: [] } as any }
  held(on, state)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  await ui.press({ key: 'tab:settings' })
  for (const p of ['codex', 'opencode', 'commandcode']) {
    await ui.press({ key: 'cap:add' })
    await ui.select({ key: 'cap:provider', value: p })
    await ui.input({ key: `capinput:${p}`, text: '5' })
    expect(state.guard.caps[p as 'codex']).toBe(5)
  }
  await ui.press({ key: 'tab:dashboard' })
  state.costs.rows = [{ provider: 'codex', model: 'gpt', period: 'today', input: 10, output: 0, cacheRead: 0, cacheWrite: 0 }]
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /cap off · no price for gpt/ })).toBeDefined()
  await ui.unmount()
})

test('group parents can stop and resume, detail LIVE has no watch chips, and non-answer ends fail', async ($, on) => {
  mock.clock(on, { now: 10000 })
  mock.store(on)
  const state = { nodes: [{ ...child, ownEdits: true }, { ...child, id: 'helper', agentId: undefined, parentNode: child.id, provider: 'codex', label: 'Helper' }] as AgentNode[] }
  held(on, state)
  on('agent.spawn', () => ({ agentId: 'agent', model: 'claude' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  expect(await ui.find({ key: 'stop:parent' })).toBeDefined()
  await ui.press({ key: 'stop:parent' })
  expect(state.nodes[0]?.stopping).toBe(true)
  await ($.agent as any).spawn({ tool_use_id: 'resume', resume: { agentId: 'agent' }, prompt: 'Continue', parentModel: 'claude', description: 'Build the thing' })
  expect(state.nodes[0]?.stopping).toBeUndefined()
  expect((await ($.tool as any).call({ tool: 'Read', tool_use_id: 'allowed', agentId: 'agent', file_path: '/x' })).deny).toBeUndefined()
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'gopen:parent' })
  expect(await ui.find({ key: 'watch:main' })).toBeUndefined()
  await ($.turn as any).complete({ turnId: 'one', agentId: 'agent', answer: 'Error', reason: 'error', isAborted: false, usage: null })
  expect(state.nodes[0]?.state).toBe('failed')
  await ui.unmount()
})

test('turn completion clears streamed acts for main and subagents while keeping real tool ownership', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const state = { acts: { main: { key: 'main', tool: 'Write', title: 'stream', state: 'running', at: 1 }, sub: { key: 'sub', tool: 'Edit', title: 'stream', state: 'running', at: 1 }, real: { key: 'real', tool: 'Write', title: 'real', toolUseId: 'tool', state: 'running', at: 1 } } as Record<string, Act> }
  held(on, state)
  on('process.run', () => fail)
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  for (const agentId of [undefined, 'sub', 'real']) await ($.turn as any).complete({ turnId: 'one', agentId, reason: 'aborted', answer: '', isAborted: true, usage: null })
  expect(state.acts.main?.state).toBe('failed')
  expect(state.acts.sub?.state).toBe('failed')
  expect(state.acts.real?.state).toBe('running')
})

test('Workflow failures and remote launches settle their local groups', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const state = { nodes: [] as AgentNode[] }
  held(on, state)
  let result: any = { error: 'Syntax error' }
  on('tool.call', () => ({ result }))
  await ($.tool as any).call({ tool: 'Workflow', tool_use_id: 'bad', script: 'broken' })
  expect(state.nodes[0]?.state).toBe('failed')
  result = { status: 'remote_launched' }
  await ($.tool as any).call({ tool: 'Workflow', tool_use_id: 'remote', script: 'remote' })
  expect(state.nodes[1]?.state).toBe('done')
})

test('background shells never create instant done nodes, and only a failed run reports a quota hit', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const state = { nodes: [] as AgentNode[], providers: { claude: blank(), codex: blank(), opencode: blank(), commandcode: blank(), antigravity: blank() } }
  held(on, state)
  on('process.run', () => fail)
  on('ui.toast', () => ({ value: undefined }))
  let failed = false
  on('tool.call', () => (failed ? { result: 'usage limit reached', isError: true as const } : { result: 'added a rate limit: usage limit reached returns 429' }))
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'bg', command: 'codex exec "task"', run_in_background: true })
  expect(state.nodes).toEqual([])
  expect(state.providers.codex.alert).toBeUndefined()
  failed = true
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'bg2', command: 'codex exec "task"', run_in_background: true })
  expect(state.providers.codex.alert).toBe('quota hit · its run said so')
})

test('home paths expand literally and reject shell substitutions and other users', async () => {
  expect(reviewCwd('cd ~/repo && codex exec -C ~/repo "task"', 'codex', '/home/test')).toEqual({ cwd: '/home/test/repo' })
  expect(reviewCwd('codex exec -C ~ "task"', 'codex', '/home/test')).toEqual({ cwd: '/home/test' })
  for (const p of ['~other/repo', '$HOME/repo', '`pwd`/repo']) expect(reviewCwd(`codex exec -C ${p} "task"`, 'codex', '/home/test')).toBeUndefined()
})

test('reload reconciles finished agents, preserves side pids, and an idle workflow does not tick', async ($, on) => {
  const clock = mock.clock(on, { now: 10000 })
  mock.store(on, { guard: normalGuard({ ticker: false }) })
  mock.env(on, { HOME: '/home/test' })
  const state = { nodes: [{ ...child }, { ...child, id: 'side', agentId: undefined, provider: 'codex', pid: 42 }] as AgentNode[], tick: 0 }
  held(on, state)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [{ id: 'agent', status: 'completed', description: child.label }] as any }))
  on('session.model', () => ({ value: 'claude' }))
  on('session.id', () => ({ value: 'chat' }))
  on('process.run', () => fail)
  on('fs.read', () => ({ value: '{}' }))
  on('fs.list', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await ($.session as any).start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  expect(state.nodes[0]?.state).toBe('done')
  expect(state.nodes[1]?.state).toBe('running')
  state.nodes = [{ ...child, id: 'wf', agentId: undefined, kind: 'workflow' }, { ...child, state: 'done', parentNode: 'wf' }]
  await clock.advance(300)
  expect(state.tick).toBe(0)
})

test('Activity reaches every pending file and QA delete control and expands full decisions on desktop', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const files: EditItem[] = Array.from({ length: 15 }, (_, at) => ({ file: `/repo/file${at}.ts`, lines: [], before: [], after: [], at, review: 'pending' }))
  const decision = 'Use the existing model catalog. '.repeat(6) + 'DECISION_END'
  held(on, { edits: files, grill: Array.from({ length: 30 }, (_, i) => ({ question: `Question ${i}`, answer: `Answer ${i}`, at: i })), decisions: [{ decision, why: 'Keep the source', impact: 'low', at: 1 }] })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  await ui.press({ key: 'tab:activity' })
  expect(await ui.find({ key: 'file:/repo/file0.ts' })).toBeDefined()
  await ui.press({ key: 'qaedit:act' })
  expect(await ui.find({ key: 'qadel:act:0' })).toBeDefined()
  await ui.press({ key: 'fold:dec:1' })
  expect(await ui.find({ type: 'Text', text: /DECISION_END/ })).toBeDefined()
  await ui.unmount()
})

test('chat model changes immediately and OpenCode effort dropdowns use that models real variants', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const r = defaultRouting()
  r.picks = [{ provider: 'opencode', model: 'deepseek' }, { provider: 'opencode', model: 'none' }]
  const state = { routing: r, main: { model: 'opus' }, providers: { claude: { ...blank(), models: [{ id: 'sonnet', isDefault: true }] }, codex: blank(), opencode: { ...blank(), models: [{ id: 'deepseek', efforts: ['high', 'xhigh'] }, { id: 'none', efforts: [] }] }, commandcode: blank(), antigravity: blank() } }
  held(on, state)
  on('command.run', () => ({ text: '' }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  await ui.press({ key: 'tab:models' })
  for (const effort of ['high', 'xhigh', undefined]) {
    await ui.select({ key: 'effort:opencode/deepseek', value: effort ?? 'default' })
    expect(state.routing.picks[0]?.effort).toBe(effort)
  }
  expect(await ui.find({ key: 'effort:opencode/none' })).toBeUndefined()
  await ui.press({ key: 'open:claude' })
  await ui.press({ key: 'chat:sonnet' })
  expect(state.main.model).toBe('sonnet')
  await ui.unmount()
})

test('quota auto-pause keeps this chat routing and only changes the blocked provider', async ($, on) => {
  mock.clock(on)
  const saved = defaultRouting()
  saved.on.opencode = false
  saved.picks = [{ provider: 'codex', model: 'other-chat-pick' }]
  mock.store(on, { routing: saved })
  const state = { routing: defaultRouting(), providers: { claude: blank(), codex: blank(), opencode: blank(), commandcode: blank(), antigravity: blank() } }
  held(on, state)
  on('process.run', () => fail)
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'usage limit reached', isError: true }))
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'quota', command: 'codex exec "task"' })
  expect(state.routing.on.codex).toBe(false)
  expect(state.routing.on.opencode).toBe(true)
  expect(state.routing.picks.some(p => p.model === 'other-chat-pick')).toBe(false)
  expect(state.routing.paused?.codex).toBeDefined()
})

test('Agents can return from a pinned old run to live work', async ($, on) => {
  mock.clock(on, { now: 10000 })
  const state = { nodes: [{ ...child, id: 'old', run: 'turn:old', state: 'done', startedAt: 1, endedAt: 10 }, { ...child, id: 'new', run: 'turn:new' }] as AgentNode[] }
  held(on, state)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'run:turn:old' })
  expect(await ui.find({ key: 'run:live' })).toBeDefined()
  await ui.press({ key: 'run:live' })
  expect(await ui.find({ key: 'run:live' })).toBeUndefined()
  expect(await ui.find({ key: 'gopen:new' })).toBeDefined()
  await ui.unmount()
})

test('pinned skills follow plugin Off, ponytail modes dispatch commands, and desktop tools have friendly names', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/test' })
  held(on, { pins: ['plugin:ponytail', 'skill:ponytail:ponytail'], toggles: { 'plugin:ponytail': 'off' }, installed: { plugins: [{ name: 'ponytail', enabled: true, where: 'claude', skills: ['ponytail'] }], skills: 1, mcpServers: [], tools: ['mcp__random-media-server__account_balance', 'mcp__linear-personal__list_issues'] } })
  on('fs.read', () => ({ value: 'full' }))
  let command = ''
  on('command.run', (_$, e) => { command = `${e.command} ${e.args}`; return { text: '' } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  expect((await ui.find({ key: 'mode:skill:ponytail:ponytail:off' }))?.text).toContain('↳Off')
  expect((await ui.find({ key: 'mode:skill:ponytail:ponytail:off' }))?.props.variant).not.toBe('primary')
  await ui.press({ key: 'swfold:plugin:ponytail' })
  expect((await ui.find({ key: 'pmode:full' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'pmode:lite' })
  expect(command).toBe('ponytail lite')
  await ui.press({ key: 'tab:plugins' })
  expect(await ui.find({ type: 'Text', text: 'Magnific' })).toBeDefined()
  await ui.press({ key: 'srvfold:linear-personal' })
  expect(await ui.find({ type: 'Text', text: 'List issues' })).toBeDefined()
  await ui.unmount()
})

test('routing is per chat: a change in one chat leaves another alone, and a new chat starts from the last one set', async () => {
  const store: Record<string, unknown> = {}
  let id = 'chat-a'
  const api = { session: { id: async () => id }, store: { get: async (k: string) => store[k], set: async (k: string, v: unknown) => { store[k] = v } } } as unknown as EngineInterface
  await storeRouting(api, { ...normalRouting(undefined), role: 'plan' })
  id = 'chat-b'
  expect(normalRouting(await loadRouting(api)).role).toBe('plan')
  await storeRouting(api, { ...normalRouting(undefined), role: 'claude' })
  id = 'chat-a'
  expect(normalRouting(await loadRouting(api)).role).toBe('plan')
  id = 'chat-c'
  expect(normalRouting(await loadRouting(api)).role).toBe('claude')
})

test('a pipe into a codex group keeps its stdin; a pipe in an earlier command does not', async () => {
  expect(withFlags('git diff | (cd repo && codex exec "review")', 'codex', {})).not.toContain('/dev/null')
  expect(withFlags('ls | wc -l; codex exec "task"', 'codex', {})).toContain('< /dev/null')
})

test('store pruning bounds side bases, routings and session decisions', async () => {
  const store: Record<string, unknown> = { 'base:old': { day: 'Mon Jan 01 2001' }, 'base:now': { day: new Date(0).toDateString() }, routing: {} }
  for (let i = 0; i < 205; i++) store[`routing:${i}`] = {}
  for (let i = 0; i < 55; i++) store[`decisions:${i}`] = []
  const api = { clock: { now: async () => 0 }, store: { keys: async () => Object.keys(store), get: async (k: string) => store[k], delete: async (k: string) => { delete store[k] } } } as unknown as EngineInterface
  await pruneStore(api)
  expect(store['base:old']).toBeUndefined()
  expect(store['base:now']).toBeDefined()
  expect(store.routing).toBeDefined()
  expect(Object.keys(store).filter(k => k.startsWith('routing:')).length).toBe(200)
  expect(store['routing:204']).toBeDefined()
  expect(Object.keys(store).filter(k => k.startsWith('decisions:'))).toHaveLength(50)
  expect(store['decisions:0']).toBeUndefined()
  expect(store['decisions:54']).toBeDefined()
})
