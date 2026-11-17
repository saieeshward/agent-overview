import type { EngineInterface, On, PluginState } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { AgentNode, Costs, Prices, VibeLog } from '../types'
import { blank, defaultRouting, normalGuard } from '../hooks/state'
import { actKind, COMMIT_RE, PUSH_RE, TEST_RE, sampleTps, sceneKey, sessionCost, vibeData } from '../hooks/vibe/data'
import { frameCells, play, stopPlayback, stopVibe, vibeTick, vibePhase, registerVibe, watchVibe } from '../hooks/vibe/loop'
import { C, CLAWD, OFFICE_ACCENTS, OFFICE_CAST, ROOM, FPS, H, PALETTE, SVG_MAX, W, canvas, quotaHud, remap, toCells, toSvg } from '../hooks/vibe/engine'
import { office, officeActor, officeLayout, MASCOTS, DESKS, DESK_X, OFFICE_W, OFFICE_H } from '../hooks/vibe/office'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { restoreDecisions } from '../hooks/vibe/decisions'
import { SCENES } from '../hooks/vibe/scenes'

type State = Partial<PluginState['agent-overview']>
function held(on: On, initial: State = {}) {
  const state: State = { ui: { tab: 'dashboard', pick: 'claude', area: 'vibe', vibeTab: 'live' }, guard: normalGuard(undefined), ...initial }
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const result = await next(e)
    return e.key in state && result.value ? { value: { ...result.value, value: state[e.key as keyof State] } } as any : result
  })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const result = await next(e)
    if (e.key in state && result.value?.isSet) Object.assign(state, { [e.key]: e.value })
    return result
  })
  return state
}
const props = (bodyColumns = 110, bodyRows = 50) => ({ title: 'Overview', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} })
const emptyLog = (): VibeLog => ({ acts: [], combo: 0, commits: 0, pushes: 0, best: 0, phase: '' })
const node = (id: string, rest: Partial<AgentNode> = {}): AgentNode => ({ id, label: id, kind: 'agent', model: 'gpt-6.1-sol', state: 'running', steps: 5, startedAt: 90000, ...rest })
const decoded = (cells: string) => new DataView(Uint8Array.from(atob(cells), x => x.charCodeAt(0)).buffer)
function snapshotApi(state: State, now: () => number): EngineInterface {
  const defaults = { main: { model: '' }, nodes: [], edits: [], live: null, sideLive: null, acts: {}, decisions: [],
    providers: { claude: blank(), codex: blank(), opencode: blank(), antigravity: blank(), commandcode: blank() },
    routing: defaultRouting(), costs: { rows: [], claude: {}, agy: {} }, prices: { catalog: {}, overrides: {} }, turnCosts: [], findings: [], history: { since: 0, items: [] }, vibe: emptyLog() }
  return { clock: { now: async () => now() }, state: { get: async ({ key }: { key: keyof typeof defaults }) => ({ value: state[key] ?? defaults[key], version: 0 }) } } as unknown as EngineInterface
}

function sessionMocks(on: On, sessionId = () => 'chat') {
  mock.env(on, { HOME: '/home/test' })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('session.model', () => ({ value: 'claude' }))
  on('session.id', () => ({ value: sessionId() }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: '{}' }))
  on('fs.list', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

test('Vibe snapshots derive agents, edit precedence, quotas, costs, decisions and session totals', async ($, on) => {
  mock.clock(on, { now: 100000 })
  const r = { ...defaultRouting(), order: ['opencode', 'codex', 'commandcode', 'antigravity'] as const as any, tags: { claude: 'saver' as const, opencode: 'main' as const }, paused: { commandcode: { why: 'quota', at: 1, until: 200000 } } }
  const ps = { claude: blank(), codex: blank(), opencode: blank(), commandcode: blank(), antigravity: blank(), ollama: blank() }
  ps.claude.meters = [{ label: 'Context', percent: 91 }, { label: 'Week', percent: 23 }]
  ps.codex.meters = [{ label: 'Daily', percent: 45 }, { label: 'Week', percent: 100 }, { label: 'Context', percent: 99 }]
  ps.antigravity.alert = 'quota exhausted'
  const state = held(on, {
    main: { model: 'claude-opus-5-5', effort: 'high', working: true, lastTool: 'Edit' },
    nodes: [node('workflow', { kind: 'workflow' }), node('old', { state: 'done', endedAt: 39999 }), node('codex', { agentId: 'cx', startedAt: 50000 }),
      node('agy', { model: 'gemini-4-argon-high', state: 'done', endedAt: 95000, startedAt: 60000 }), node('cc', { model: 'moonshotai/kimi-k3', provider: 'commandcode', startedAt: 70000 })],
    edits: [{ file: 'older.ts', lines: [], at: 99000, added: 10, removed: 3 }],
    live: { id: 'e', tool: 'Edit', file: 'live.ts', text: 'one\ntwo\nthree', agent: 'cx', seq: 1 },
    sideLive: { id: 'agy', at: 99000, files: [{ path: 'side.ts', added: 8, removed: 2, isNew: false }] },
    acts: { main: { key: 'main', tool: 'AskUserQuestion', title: 'Waiting', state: 'running', at: 99900 } },
    decisions: [{ decision: 'Keep it pure', why: 'Preview', impact: 'high', at: 99000 }], providers: ps, routing: r,
    costs: { rows: [], claude: {}, agy: {}, engineUsd: 2.35 }, prices: { catalog: {}, overrides: {} },
    findings: [{ file: 'x', text: 'a', severity: 'high', by: ['a'], at: 1 }, { file: 'y', text: 'b', severity: 'low', by: ['b'], at: 2, dismissed: true }],
    vibe: { ...emptyLog(), best: 15, combo: 6, commits: 2, pushes: 1, acts: [{ tool: 'Bash', title: 'npm test', state: 'done', kind: 'test', tests: 'pass', at: 99000 }] }, history: { since: 1, items: [] },
  })
  const api = snapshotApi(state, () => 100000)
  let d = await vibeData(api)
  expect(d.agents.map(a => [a.id, a.provider])).toEqual([['codex', 'codex'], ['agy', 'antigravity'], ['cc', 'commandcode']])
  expect(d.main).toEqual({ model: 'claude-opus-5-5', effort: 'high', working: true, lastTool: 'Edit', waiting: true })
  expect(d.edit).toEqual({ file: 'live.ts', added: 3, removed: 0, provider: 'codex' })
  expect(d.usage.map(u => u.provider)).toEqual(['claude', 'opencode', 'codex', 'commandcode', 'antigravity'])
  expect(d.usage[0]).toMatchObject({ percent: 23, tag: 'saver' })
  expect(d.usage[1]).toMatchObject({ tag: 'main', estimate: true })
  ps.opencode.usageSource = 'live'
  expect((await vibeData(api)).usage[1]?.estimate).toBe(false)
  expect(d.usage.slice(2).every(u => u.out)).toBe(true)
  expect(d).toMatchObject({ cost: 2.35, ctx: 91, lines: 13, best: 15, findings: 1, tests: 'pass', idle: 0, combo: 6, commits: 2, pushes: 1 })
  expect(d.acts[d.acts.length - 1]).toMatchObject({ tool: 'AskUserQuestion', state: 'running' })
  expect(d.agents[0]?.tokens).toBeUndefined()
  state.live = null
  expect((await vibeData(api)).edit).toEqual({ file: 'side.ts', added: 8, removed: 2, provider: 'antigravity' })
  state.sideLive = null
  expect((await vibeData(api)).edit).toMatchObject({ file: 'older.ts', added: 10, removed: 3, provider: 'claude' })
  state.main = { model: 'claude', working: false }; state.nodes = []; state.acts = {}; state.vibe = emptyLog(); state.decisions = []; state.edits = []
  state.history = { since: 60000, items: [] }
  d = await vibeData(api)
  expect(d).toMatchObject({ idle: 40, tps: 0, tests: null, edit: null, main: { waiting: true } })
  state.turnCosts = [{ at: 95000, durationMs: 1, tokens: 1 }]
  expect((await vibeData(api)).idle).toBe(5)
})

test('agent recency, eight-agent cap, running acts, edit and test expiry use the clock', async ($, on) => {
  mock.clock(on, { now: 100000 })
  const state = held(on, { main: { model: 'claude' }, history: { since: 1000, items: [] },
    nodes: Array.from({ length: 12 }, (_, i) => node(`agent${i}`, { startedAt: 80000 + i })),
    edits: [{ file: 'stale', lines: [], at: 79999, added: 4 }],
    acts: { main: { key: 'main', tool: 'Bash', title: 'npm run test', state: 'running', at: 90000 } },
    vibe: { ...emptyLog(), acts: [{ tool: 'Bash', title: 'tsc', state: 'failed', kind: 'test', tests: 'fail', at: 39999 }] } })
  const d = await vibeData(snapshotApi(state, () => 100000))
  expect(d.agents).toHaveLength(8)
  expect(d.agents[0]?.id).toBe('agent4')
  expect(d.agents[7]?.id).toBe('agent11')
  expect(d.acts[d.acts.length - 1]).toMatchObject({ kind: 'test', state: 'running' })
  expect(d).toMatchObject({ edit: null, tests: null, idle: 0, main: { waiting: false } })
})

test('eight-agent selection keeps running work before the most recently finished agents, then draws oldest first', async ($, on) => {
  const state = held(on, { nodes: [
    ...Array.from({ length: 10 }, (_, i) => node(`done${i}`, { state: i % 2 ? 'failed' : 'done', startedAt: 50000 + i * 1000, endedAt: 90000 + i })),
    node('old-running', { startedAt: 1000 }), node('new-running', { startedAt: 99000 }),
  ] })
  const d = await vibeData(snapshotApi(state, () => 100000))
  expect(d.agents.map(a => a.id)).toEqual(['old-running', 'done0', 'done2', 'done4', 'done6', 'done8', 'new-running'])
})

test('only runner commands count as tests, and commit or push commands always stay Bash', () => {
  for (const cmd of ['npm test', 'pnpm run test', 'yarn run test', 'bun run test', 'npx -y vitest run', 'npx jest', 'plugin test .',
    'tsc -p .', 'npm run build && tsc', 'git status; tsc --noEmit', 'cat files | tsc', 'npx -y tsc', 'npx tsc']) {
    expect(TEST_RE.test(cmd)).toBe(true)
    expect(actKind('Bash', cmd)).toBe('test')
  }
  for (const cmd of ['git commit -m "add test"', 'git push origin test', 'echo test', 'test -f file', 'cat jest.config.ts', 'echo tsc', 'npm run build', 'tsc.log']) {
    expect(TEST_RE.test(cmd)).toBe(false)
    expect(actKind('Bash', cmd)).toBe('bash')
  }
  for (const cmd of ['npm test && git commit -m "add test"', 'git push origin main && npx tsc']) expect(actKind('Bash', cmd)).toBe('bash')
})

test('sessionCost uses session baselines, priced tokens, engine dollars and excludes credit rows', () => {
  const token = { input: 0, output: 1000000, cacheRead: 0, cacheWrite: 0 }
  const pr: Prices = { catalog: {}, overrides: { 'claude-opus-5-5': { input: 1, output: 2 }, 'gemini-4-argon': { input: 1, output: 3 } } }
  const c: Costs = { claude: { 'claude-opus-5-5': token }, engineUsd: 4, agy: { 'gemini-4-argon-high': token }, rows: [
    { ...token, provider: 'codex', model: 'gpt-6.1-sol', period: 'today', reported: 7 },
    { ...token, provider: 'opencode', model: 'deepseek', period: 'period', reported: 90, credits: true },
    { ...token, provider: 'commandcode', model: 'kimi', period: 'period', reported: 2 },
  ], base: [{ ...token, output: 0, provider: 'codex', model: 'gpt-6.1-sol', period: 'today', reported: 5 }] }
  expect(sessionCost(c, pr)).toBe(11)
  expect(sessionCost({ ...c, base: undefined }, pr)).toBe(7)
  expect(sessionCost({ ...c, engineUsd: 1, rows: [] }, pr)).toBe(5)
})

test('token rate samples the recent window, idles at zero and resets on a new counter', () => {
  const samples: { at: number; out: number }[] = []
  expect(sampleTps(samples, 0, 100, true)).toBe(0)
  expect(sampleTps(samples, 1000, 180, true)).toBe(80)
  expect(sampleTps(samples, 2000, 260, false)).toBe(0)
  for (let i = 3; i <= 40; i++) sampleTps(samples, i * 1000, 100 + i * 80, true)
  expect(sampleTps(samples, 41000, 3380, true)).toBe(80)
  expect(samples.length).toBeLessThanOrEqual(32)
  expect(sampleTps(samples, 42000, 1, true)).toBe(0)
  expect(sampleTps(samples, 100, 2, true)).toBe(0)
})

test('sceneKey ignores HUD clocks and speed while keeping drawn day parts and idle transitions', () => {
  const d = { ...FIXTURES.waiting, now: 100000, idle: 40 }
  expect(sceneKey(d)).toBe(sceneKey({ ...d, now: 102000, idle: 42 }))
  expect(sceneKey(d)).toBe(sceneKey({ ...d, hour: 9 }))
  expect(sceneKey(d)).not.toBe(sceneKey({ ...d, idle: 120 }))
  expect(sceneKey(d)).not.toBe(sceneKey({ ...d, hour: 18 }))
  expect(sceneKey({ ...d, tps: 22 })).toBe(sceneKey({ ...d, tps: 58 }))
  expect(sceneKey({ ...d, tps: 58 })).toBe(sceneKey({ ...d, tps: 61 }))
  const event = { ...d, acts: [{ tool: 'Bash', title: 'git push', kind: 'bash' as const, state: 'done' as const, at: 95000 }] }
  expect(sceneKey(event)).toBe(sceneKey({ ...event, now: 102000 }))
  expect(sceneKey(event)).not.toBe(sceneKey({ ...event, now: 125000 }))
})

test('tool observer logs results unchanged, streaks, tests, commits, pushes and only twelve acts', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = held(on, { vibe: emptyLog() })
  const answer = { result: 'ok', text: 'unchanged', context: ['kept'] }
  on('tool.call', (_$, e) => (e as any).tool_use_id === 'deny' ? { deny: 'refused' } : (e as any).tool_use_id === 'fail' ? { result: 'boom', text: 'boom', isError: true } : answer)
  const call = (command: string, id = command) => ($.tool as any).call({ tool: 'Bash', tool_use_id: id, command })
  expect(await call('git status')).toEqual(answer)
  expect(state.vibe?.combo).toBe(1)
  await call('npm run test', 'fail')
  expect(state.vibe?.combo).toBe(0)
  expect(state.vibe?.acts[1]).toMatchObject({ kind: 'test', state: 'failed', tests: 'fail', at: 1000 })
  await call('git -C /repo commit -m "add test"')
  expect(state.vibe?.acts[2]).toMatchObject({ kind: 'bash', state: 'done' })
  await call('git push origin work-vibe')
  expect(state.vibe?.acts[3]).toMatchObject({ kind: 'bash', state: 'done' })
  await call('git push', 'deny')
  expect(state.vibe).toMatchObject({ commits: 1, pushes: 1, combo: 0 })
  await call('claude plugin test .')
  expect(state.vibe?.acts[state.vibe.acts.length - 1]).toMatchObject({ kind: 'test', tests: 'pass' })
  const before = JSON.stringify(state.vibe!.acts)
  await ($.tool as any).call({ tool: 'mcp__agent-overview__decision_log', tool_use_id: 'decision', decision: 'Keep pixels', why: 'Clarity', impact: 'low' })
  expect(JSON.stringify(state.vibe!.acts)).toBe(before)
  expect(state.vibe!.events?.slice(-1)[0]!.kind).toBe('decision')
  for (let i = 0; i < 14; i++) await call(`echo ${i}\nsecond line`)
  expect(state.vibe?.acts).toHaveLength(12)
  expect(state.vibe?.acts[11]?.title).toBe('echo 13')
  expect(COMMIT_RE.test('git -C /repo commit -m x')).toBe(true)
  expect(PUSH_RE.test('git push origin feature')).toBe(true)
  expect(COMMIT_RE.test('git status && echo commit')).toBe(false)
  for (const cmd of ['go test ./...', 'cargo test', 'bun test', 'npm test', 'pnpm test', 'yarn test', 'vitest', 'jest', 'pytest', 'mocha', 'tsc -p .']) expect(TEST_RE.test(cmd)).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) for (const columns of [64, 110, 256]) {
  test(`Vibe live HUD and real session scene on ${surface} at ${columns} columns`, async ($, on) => {
    mock.clock(on, { now: FIXTURES.busy.now }); mock.store(on)
    const state = held(on, { main: { model: 'claude-opus-5-5', effort: 'high', working: true }, costs: { rows: [], claude: {}, agy: {}, engineUsd: 2.35 },
      vibe: { ...emptyLog(), combo: 12 }, decisions: FIXTURES.review.decisions, nodes: FIXTURES.busy.agents.map(a => node(a.id, a)), routing: { ...defaultRouting(), tags: { codex: 'main', claude: 'saver' } } })
    let ticks = 0
    on('state.get', { plugin: 'agent-overview', key: 'tick' }, (_$, e, next) => { ticks++; return next(e) })
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(columns, 90) })
    expect(await ui.find({ type: 'Text', text: /opus-5-5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /t\/s/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /combo 12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /context/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$2.35/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Codex Main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Antigravity/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Preserve/ })).toBeDefined()
    expect(await ui.find({ key: 'vibe:pop' })).toBeUndefined()
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'vibe:scene' }))?.props).toMatchObject({ columns: Math.min(columns, OFFICE_W), rows: columns >= 160 ? 40 : Math.ceil(officeLayout(FIXTURES.review, columns).height / 2) })
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(svg?.props.isInteractive).toBe(true)
      expect(String(svg?.props.source).length).toBeLessThanOrEqual(SVG_MAX)
      expect(String(svg?.props.alt)).toContain('5 agents working')
      expect(ticks).toBe(0)
    }
    await ui.press({ key: 'vibe:style' }); await ui.redraw()
    expect(state.ui?.vibeStyle).toBe('arcade')
    expect(await ui.find({ type: 'Text', text: /Agent Arcade/ })).toBeDefined()
    await ui.unmount(); stopPlayback()
  })
}

test('terminal scene also fits the pane height and displays idle time', async ($, on) => {
  mock.clock(on, { now: 180000 })
  held(on, { main: { model: 'claude', working: false }, history: { since: 0, items: [] } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: props(256, 40) })
  // Short panes crop the height without shrinking scene pixels.
  expect(Number((await ui.find({ key: 'vibe:scene' }))?.props.rows)).toBeLessThanOrEqual(32)
  expect(await ui.find({ type: 'Text', text: /idle 3m/ })).toBeDefined()
  await ui.unmount(); stopPlayback()
})

test('short panes reserve room for every native HUD row and navigation', async ($, on) => {
  mock.clock(on, { now: FIXTURES.busy.now })
  held(on, { main: { model: 'claude-opus-5-5', effort: 'high', working: true }, nodes: FIXTURES.busy.agents.map(a => node(a.id, a)) })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: props(64, 40) })
  const rows = Number((await ui.find({ key: 'vibe:scene' }))?.props.rows)
  const native = (await ui.findAll({ type: 'Text' })).filter(t => t.key?.startsWith('vibe:hud:'))
  expect(rows + native.length + 10).toBeLessThanOrEqual(40)
  await ui.unmount(); stopPlayback()
})

test('terminal loop blits changing pixels, persists the best and stops for still, hidden, unplaced and denied scenes', async ($, on) => {
  const clock = mock.clock(on, { now: 100000 })
  let best = 0
  on('store.set', { key: 'vibeBest' }, (_$, e, next) => { best = e.value as number; return next(e) })
  mock.store(on, { vibeBest: 11 }); sessionMocks(on)
  const state = held(on, { main: { model: 'claude', working: true }, vibe: emptyLog(), history: { since: 100000, items: [] }, edits: [{ file: 'x', lines: [], added: 24, removed: 7 }] })
  let placed = true, shown = true, deny = false
  on('ui.panes', () => ({ value: [{ id: 'agent-overview', title: 'Overview', isPlaced: placed, isShown: shown, isFocused: true }] }))
  const blits: string[] = []
  on('ui.blit', (_$, e) => { if ('cells' in e && e.key === 'vibe:scene') blits.push(e.cells); return { value: deny ? { deny: 'unmounted' } : {} } })
  await ($.session as any).start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(state.vibe?.best).toBe(11)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: props() })
  await clock.advance(1800)
  expect(blits.length).toBeGreaterThanOrEqual(4)
  expect(new Set(blits).size).toBeGreaterThanOrEqual(2)
  expect(state.vibe?.best).toBe(31)
  expect(best).toBe(31)
  state.guard = normalGuard({ vibe: { styles: ['office'], motion: 'still' } }); await ui.redraw(); await clock.advance(1000)
  let count = blits.length; await clock.advance(500); expect(blits.length).toBe(count)
  state.guard = normalGuard(undefined); await ui.redraw(); await clock.advance(1000); await clock.advance(200)
  state.ui = { ...state.ui!, vibeTab: 'decisions' }; await clock.advance(1000)
  count = blits.length; await clock.advance(500); expect(blits.length).toBe(count)
  state.ui = { ...state.ui!, vibeTab: 'live' }; await ui.redraw(); await clock.advance(1000); await clock.advance(200)
  placed = false; await clock.advance(1000)
  count = blits.length; await clock.advance(500); expect(blits.length).toBe(count)
  placed = true; await ui.redraw(); await clock.advance(1000); await clock.advance(200)
  shown = false; await clock.advance(1000)
  count = blits.length; await clock.advance(500); expect(blits.length).toBe(count)
  shown = true; await ui.redraw(); await clock.advance(1000); deny = true
  count = blits.length; await clock.advance(500); expect(blits.length).toBe(count + 1)
  await clock.advance(1000); await clock.advance(500); expect(blits.length).toBe(count + 1)
  await ui.unmount(); stopPlayback()
})

test('desktop mounts use SMIL and never register terminal blits', async ($, on) => {
  const clock = mock.clock(on, { now: 100000 }); mock.store(on); sessionMocks(on)
  held(on)
  on('ui.panes', () => ({ value: [{ id: 'agent-overview', title: 'Overview', isPlaced: true, isShown: true, isFocused: true }] }))
  let blits = 0
  on('ui.blit', () => { blits++; return { value: {} } })
  await ($.session as any).start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: props() })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('<animate')
  await clock.advance(1000); await clock.advance(1500)
  expect(blits).toBe(0)
  await ui.unmount()
})

test('fast frames only blit cached cells without polling state or pane placement', async () => {
  const state: State = { ui: { tab: 'dashboard', pick: 'claude', area: 'vibe' }, guard: normalGuard(undefined), vibe: emptyLog() }
  const snapshot = snapshotApi(state, () => 100000)
  state.vibe!.phase = vibePhase(await vibeData(snapshot))
  let reads = 0, advance: (() => void) | undefined, cancelled = false
  const blits: string[] = []
  const api = {
    ...snapshot,
    state: { get: async (ref: any) => { reads++; return snapshot.state.get(ref) } },
    ui: {
      panes: async () => { reads++; return [{ id: 'agent-overview', isPlaced: true, isShown: true }] },
      blit: async (e: { cells: string }) => { blits.push(e.cells); return {} },
    },
    clock: { now: async () => 100000, every: (_ms: number, fn: () => void) => { advance = fn; return { cancel: () => { cancelled = true } } } },
  } as unknown as EngineInterface
  stopPlayback()
  play([canvas(2, 2, C.claude), canvas(2, 2, C.codex)], 2, 1, 'test-cache', 12)
  await vibeTick(api)
  expect(advance).toBeDefined()
  const before = reads
  for (let i = 0; i < 6; i++) advance!()
  expect(blits).toHaveLength(6)
  expect(new Set(blits).size).toBe(2)
  expect(reads).toBe(before)
  stopPlayback()
  expect(cancelled).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) test(`Vibe decisions filter newest first and settings persist on ${surface}`, async ($, on) => {
  mock.clock(on, { now: FIXTURES.review.now })
  let savedGuard = normalGuard(undefined)
  on('store.set', { key: 'guard' }, (_$, e, next) => { savedGuard = e.value as typeof savedGuard; return next(e) })
  mock.store(on)
  const state = held(on, { decisions: FIXTURES.review.decisions, ui: { tab: 'dashboard', pick: 'claude', area: 'vibe', vibeTab: 'decisions' } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props() })
  const cards = (await ui.findAll({ type: 'Box' })).filter(x => x.key?.startsWith('vdec:'))
  expect(cards.map(x => x.key)).toEqual([...FIXTURES.review.decisions].reverse().map(d => `vdec:${d.at}:${FIXTURES.review.decisions.indexOf(d)}`))
  for (const [impact, count] of [['all', 3], ['high', 1], ['medium', 1], ['low', 1]] as const) {
    expect((await ui.find({ key: `vfilter:${impact}` }))?.text).toContain(`${impact} ${count}`)
    await ui.press({ key: `vfilter:${impact}` }); await ui.redraw()
    expect((await ui.findAll({ type: 'Box' })).filter(x => x.key?.startsWith('vdec:')).length).toBe(count)
  }
  state.decisions = []; await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /no decisions/ })).toBeDefined()
  await ui.press({ key: 'vtab:settings' })
  await ui.press({ key: 'vstyle:arcade:off' })
  expect(state.guard?.vibe.styles).toEqual(['office'])
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'vstyle:office:off' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Agent HQ/ })).toBeDefined()
  expect(state.guard?.vibe.styles).toEqual(['office'])
  expect(await ui.find({ type: 'Text', text: /at least one stays on/ })).toBeUndefined()
  await ui.press({ key: 'vmotion:calm' })
  expect(savedGuard.vibe).toEqual({ styles: ['office'], motion: 'calm' })
  await ui.press({ key: 'vmotion:still' }); await ui.press({ key: 'vtab:live' })
  expect(await ui.find({ key: 'vibe:style' })).toBeUndefined()
  if (surface === 'desktop') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('<animate')
  await ui.unmount(); stopPlayback()
})

test('terminal cropping preserves source pixels at every narrow width', () => {
  const c = canvas()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c.px[y * W + x] = (x + y * 3) % 44
  const crop = toCells(c, 110), view = decoded(crop.cells)
  expect(crop.rows).toBe(36)
  for (let x = 0; x < 110; x++) {
    expect(view.getUint32(x * 12 + 4, true)).toBe(PALETTE[c.px[9 + x]!])
    expect(view.getUint32(x * 12 + 8, true)).toBe(PALETTE[c.px[W + 9 + x]!])
  }
  const small = toCells(c, 64), down = decoded(small.cells)
  expect(small.rows).toBe(36)
  expect(down.getUint32(4, true)).toBe(PALETTE[c.px[32]!])
  expect(down.getUint32(8, true)).toBe(PALETTE[c.px[W + 32]!])
  remap(c, -1, -1, 3, 3, { [c.px[0]!]: C.red })
  expect(c.px[0]).toBe(C.red)
})

const officeText = (d: typeof FIXTURES.busy, w = 128) => { const h = office.hud!(d, w); return [...h.top, ...h.bottom].map(row => row.map(s => s.text).join('')).join('\n') }
const region = (c: ReturnType<typeof canvas>, x: number, y: number, w: number, h: number) => Array.from({ length: h }, (_, yy) => [...c.px.slice((y + yy) * c.w + x, (y + yy) * c.w + x + w)]).flat()
for (const [name, d] of Object.entries(FIXTURES)) for (const motion of ['full', 'calm', 'still'] as const) {
  test(`Agent HQ ${name} ${motion} is deterministic, bounded and uses at most fourteen room colours, five provider accents and two detail accents`, () => {
    const frames = office.frames(d, { motion }), allowed = new Set([...Object.values(ROOM), ...Object.values(OFFICE_CAST), ...Object.values(OFFICE_ACCENTS)])
    expect(frames).toHaveLength(motion === 'still' ? 1 : 12)
    expect(frames.every(c => c.w === OFFICE_W && c.h === OFFICE_H && c.px.every(p => allowed.has(p)))).toBe(true)
    expect(Object.values(ROOM)).toHaveLength(14)
    expect(new Set(frames.flatMap(c => [...c.px])).size).toBeLessThanOrEqual(21)
    expect(office.frames(d, { motion }).map(c => [...c.px])).toEqual(frames.map(c => [...c.px]))
    expect(toSvg(frames, { fps: FPS[motion], hotspots: office.hotspots?.(d) }).length).toBeLessThanOrEqual(SVG_MAX)
    const spots = office.hotspots!(d)
    d.agents.forEach((a, i) => { expect(spots[i]?.title).toContain(a.model); expect(spots[i]?.title).toContain(a.label); expect(spots[i]?.title).not.toContain(`${a.steps} steps`) })
  })
}

test('office labels and stats are native HUD text, with at most five agent rows and only coloured dots', () => {
  const renamed = { ...FIXTURES.busy, cost: 99, lines: 999, tps: 12, combo: 6, ctx: 70, main: { ...FIXTURES.busy.main, model: 'Other model', effort: 'low' }, agents: FIXTURES.busy.agents.map(a => ({ ...a, label: 'Different label', model: 'Different model', steps: 999 })), edit: { ...FIXTURES.busy.edit!, file: 'other.ts', added: 222, removed: 333 }, decisions: FIXTURES.busy.decisions.map(a => ({ ...a, decision: 'Other words' })) }
  expect(office.frames(renamed, { motion: 'full' }).map(c => [...c.px])).toEqual(office.frames(FIXTURES.busy, { motion: 'full' }).map(c => [...c.px]))
  for (const w of [64, 100, 128]) {
    const h = office.hud!(FIXTURES.busy, w), agents = h.bottom.filter(row => row[0]?.text === '●')
    expect(agents).toHaveLength(5)
    for (const row of agents) {
      expect(row[0]!.color).toBeDefined(); expect(row.slice(1).every(s => !s.color)).toBe(true)
      expect(row.map(s => s.text).join('').length).toBeLessThanOrEqual(w)
    }
    expect(officeText(FIXTURES.busy, w)).toContain('view.tsx +24 −7')
  }
  expect(officeText(FIXTURES.busy)).toContain('Agent HQ · opus-5-5 · high')
  expect(officeText(FIXTURES.busy)).toContain('Claude sonnet-5-5')
  expect(officeText(FIXTURES.busy)).not.toContain('claude-')
  expect(officeText(FIXTURES.busy)).toContain('85 t/s · $2.35 · ctx 46%')
  expect(officeText(FIXTURES.failing)).toContain('tests failed')
  expect(officeText(FIXTURES.review)).toContain('decision: Preserve the arcade contract')
  expect(officeText(FIXTURES.quota)).toContain('asleep')
  expect(officeText(FIXTURES.waiting)).toContain('waiting on owner')
  expect(office.focus!(FIXTURES.waiting).w).toBe(OFFICE_W)
  expect(officeText({ ...FIXTURES.busy, agents: [{ ...FIXTURES.busy.agents[0]!, state: 'done' }], main: { ...FIXTURES.busy.main, working: false } })).toContain('done')
})

test('native office HUD keeps separate agents from one provider and preserves stats for long filenames', () => {
  const d = { ...FIXTURES.busy, agents: [{ ...FIXTURES.busy.agents[0]!, model: 'first-codex' }, { ...FIXTURES.busy.agents[0]!, id: 'second', model: 'second-codex', state: 'done' as const }], edit: { ...FIXTURES.busy.edit!, file: `hooks/${'long-name-'.repeat(30)}.tsx` } }
  const hud = office.hud!(d, 64)
  expect(officeText(d, 128)).toContain('first-codex')
  expect(officeText(d, 128)).toContain('second-codex')
  expect(hud.bottom.filter(row => row[0]?.text === '●')).toHaveLength(3)
  for (const row of hud.bottom.filter(row => row[0]?.text === '●')) expect(row.map(s => s.text).join('').length).toBeLessThanOrEqual(64)
  expect(officeText(d, 64)).toContain('.tsx +24 −7')
})

test('working agents type while idle, sleeping and Saver desks breathe', () => {
  const idle = office.frames(FIXTURES.waiting, { motion: 'full' })
  expect([...idle[0]!.px]).not.toEqual([...idle[6]!.px])
  const busy = office.frames({ ...FIXTURES.busy, tests: null, main: { ...FIXTURES.busy.main, lastTool: 'Edit' } }, { motion: 'full' })
  expect([...busy[0]!.px]).not.toEqual([...busy[6]!.px])
  const empty = office.frames({ ...FIXTURES.waiting, usage: FIXTURES.waiting.usage.map(u => u.provider === 'codex' ? { ...u, tag: 'saver' } : u) }, { motion: 'still' })[0]!
  expect(region(empty, DESK_X.codex, 41, 15, 20)).not.toContain(OFFICE_CAST.codex)
  const sleep = office.frames({ ...FIXTURES.quota, tests: null, main: { ...FIXTURES.quota.main, lastTool: 'Edit' } }, { motion: 'full' })
  expect(region(sleep[0]!, DESK_X.codex, 34, 15, 27)).not.toEqual(region(sleep[6]!, DESK_X.codex, 34, 15, 27))
  expect(region(sleep[0]!, DESK_X.codex + 7, 34, 3, 5).filter(p => p === ROOM.light)).toHaveLength(9)
})

test('office signals use the single door lamp, a moving folder or box, waiting bubble and dimmed room', () => {
  const frames = (d: typeof FIXTURES.busy) => office.frames(d, { motion: 'full' })
  const fail = frames(FIXTURES.failing), pass = frames(FIXTURES.busy)
  expect(fail[0]!.px[5 * OFFICE_W + 150]).toBe(ROOM.red); expect(fail[6]!.px[5 * OFFICE_W + 150]).toBe(ROOM.outline)
  expect(pass[0]!.px[5 * OFFICE_W + 150]).toBe(ROOM.green); expect(pass[6]!.px[5 * OFFICE_W + 150]).toBe(ROOM.green)
  const folder = frames({ ...FIXTURES.busy, tests: null }), box = frames(FIXTURES.review)
  expect(region(folder[0]!, 20, 36, 110, 5)).not.toEqual(region(folder[11]!, 20, 36, 110, 5))
  expect(region(box[0]!, 139, 72, 21, 4)).not.toEqual(region(box[11]!, 139, 72, 21, 4))
  const waiting = frames(FIXTURES.waiting)[0]!, idle = frames(FIXTURES.idle)[0]!
  expect(region(waiting, 12, 39, 3, 5)).toContain(ROOM.light)
  expect(waiting.px[0]).toBe(ROOM.wall); expect(idle.px[0]).toBe(ROOM.outline)
  const marked = frames(FIXTURES.busy)[0]!
  expect(marked.px[64 * OFFICE_W + DESK_X.codex + 7]).toBe(ROOM.gold)
  expect(DESKS).toHaveLength(5)
})

test('scene keys keep edit presence and colours while ignoring HUD counts and filenames', () => {
  const d = { ...FIXTURES.busy, now: 200000, agents: [], acts: [], decisions: [], edit: { file: 'a.ts', provider: 'codex' as const, added: 10, removed: 1 } }
  expect(sceneKey(d)).toBe(sceneKey({ ...d, edit: { ...d.edit, added: 49, removed: 9 } }))
  expect(sceneKey(d)).not.toBe(sceneKey({ ...d, edit: { ...d.edit, added: 0 } }))
  for (const added of [1, 50, 200]) expect(sceneKey(d)).toBe(sceneKey({ ...d, edit: { ...d.edit, added } }))
  expect(sceneKey(d)).toBe(sceneKey({ ...d, edit: { ...d.edit, file: 'b.ts' } }))
  const old = { ...d, acts: [{ tool: 'Read', title: 'a.ts', state: 'done' as const, kind: 'other' as const, at: 100000 }], decisions: [{ decision: 'Keep it', why: 'Clear', impact: 'low' as const, at: 100000 }] }
  expect(sceneKey(old)).toBe(sceneKey({ ...old, now: 210000 }))
  expect(sceneKey(old)).toBe(sceneKey({ ...old, now: 250000 }))
})

test('terminal frame encoding is shared across redraws and playback and keyed by size', () => {
  const frames = [canvas(), canvas(128, 72, C.codex)]
  const first = frameCells(frames, 0, 100)
  expect(frameCells(frames, 0, 100)).toBe(first)
  expect(frameCells(frames, 1, 100)).not.toBe(first)
  expect(frameCells(frames, 0, 64)).not.toBe(first)
  expect(frameCells(frames, 0, 100, { x: 10, y: 44, w: 64, h: 24 }, 12).rows).toBe(12)
})

test('plugin reload retains the vibe log for the same session and resets a new session', async ($, on) => {
  stopVibe()
  const clock = mock.clock(on); mock.store(on, { vibeBest: 19 })
  let sessionId = 'chat'
  sessionMocks(on, () => sessionId)
  const log: VibeLog = { ...emptyLog(), sessionId, combo: 7, commits: 2, pushes: 1, best: 40, acts: [{ tool: 'Bash', title: 'git status', state: 'done', at: 0, kind: 'bash' }] }
  const state = held(on, { vibe: log, ui: { tab: 'dashboard', pick: 'claude', area: 'overview' } })
  await ($.session as any).start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(state.vibe).toEqual(log)
  sessionId = 'new-chat'
  await ($.session as any).start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(state.vibe).toEqual({ ...emptyLog(), sessionId: 'new-chat', best: 19, startedAt: 0, pendingCommits: 0, visualChecks: 0 })
  stopVibe()
})

test('the visibility checker polls panes only in Vibe Live and stops on leaving', async ($, on) => {
  stopVibe()
  const clock = mock.clock(on); mock.store(on); sessionMocks(on)
  held(on, { ui: { tab: 'dashboard', pick: 'claude', area: 'overview' } })
  let polls = 0
  on('ui.panes', () => { polls++; return { value: [{ id: 'agent-overview', isPlaced: true, isShown: true, isFocused: true, title: 'Overview' }] } })
  await ($.session as any).start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.advance(3000); expect(polls).toBe(0)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: props() })
  await ui.press({ key: 'area:vibe' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' }); await clock.advance(2000)
  expect(polls).toBeGreaterThanOrEqual(2)
  await ui.press({ key: 'vtab:decisions' })
  let before = polls; await clock.advance(3000); expect(polls).toBe(before)
  await ui.press({ key: 'vtab:live' }); await clock.advance(1000); expect(polls).toBeGreaterThan(before)
  await ui.press({ key: 'area:overview' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
  before = polls; await clock.advance(3000); expect(polls).toBe(before)
  await ui.press({ key: 'area:vibe' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' }); await clock.advance(1000)
  await ui.press({ key: 'area:overview' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
  before = polls; await clock.advance(3000); expect(polls).toBe(before)
  await ui.unmount(); stopVibe()
})


test('the pane close hook cancels the visibility checker immediately', async () => {
  stopVibe()
  let close: any, cancelled = 0
  const api = { clock: { every: () => ({ cancel: () => { cancelled++ } }) } } as unknown as EngineInterface
  registerVibe(((name: string, _filter: unknown, callback: unknown) => { if (name === 'ui.close') close = callback }) as On)
  watchVibe(api, { tab: 'dashboard', pick: 'claude', area: 'vibe' })
  expect(cancelled).toBe(0)
  await close(api, { id: 'agent-overview' }, async () => ({}))
  expect(cancelled).toBe(1)
  stopVibe()
})

test('Clawd is the exact unobscured 16 by 10 banner sprite, with orange body and dark eyes', () => {
  const expected = [
    '..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..', '..OOkOOOOOOkOO..', '..OOkOOOOOOkOO..',
    'OOOOOOOOOOOOOOOO', 'OOOOOOOOOOOOOOOO', '..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..',
    '...O.O....O.O...', '...O.O....O.O...',
  ]
  expect(CLAWD).toEqual(expected)
  const c = office.frames(FIXTURES.busy, { motion: 'still' })[0]!
  expected.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') expect(c.px[(48 + y) * c.w + 6 + x]).toBe(ch === 'k' ? OFFICE_ACCENTS.eye : OFFICE_CAST.claude)
  }))
  expect(PALETTE[OFFICE_CAST.claude]).toBe(0xD97757)
  expect(PALETTE[OFFICE_ACCENTS.eye]).toBe(0x1A1A1A)
})

test('working mascots have distinct silhouettes, Clawd steps and blinks, and delegation adds a hop', () => {
  expect(new Set(DESKS.map(p => MASCOTS[p]).map(rows => rows.map(row => row.replace(/[^.]/g, '#')).join('\n'))).size).toBe(5)
  const d = { ...FIXTURES.busy, tests: null, main: { ...FIXTURES.busy.main, lastTool: 'Edit' } }
  const frames = office.frames(d, { motion: 'full' })
  expect(region(frames[0]!, 6, 56, 16, 2)).not.toEqual(region(frames[6]!, 6, 56, 16, 2))
  expect(region(frames[0]!, 6, 50, 16, 2)).toContain(OFFICE_ACCENTS.eye)
  expect(region(frames[10]!, 6, 50, 16, 2)).not.toContain(OFFICE_ACCENTS.eye)
  const hop = office.frames(FIXTURES.busy, { motion: 'full' })
  expect(region(hop[3]!, 6, 46, 16, 2)).toContain(OFFICE_CAST.claude)
  expect(region(frames[3]!, 6, 46, 16, 2)).not.toContain(OFFICE_CAST.claude)
  for (const p of DESKS.filter(p => p !== 'claude')) {
    const a = canvas(OFFICE_W, OFFICE_H, ROOM.wall), b = canvas(OFFICE_W, OFFICE_H, ROOM.wall)
    officeActor(a, d, p, 0); officeActor(b, d, p, 6)
    expect([...a.px]).not.toEqual([...b.px])
    expect(new Set(a.px).size).toBeLessThanOrEqual(5) // background, outline and at most three tones
  }
})

test('only an idle room gets the sleeping rug cat, even if an inconsistent busy snapshot has old activity', () => {
  const idle = office.frames(FIXTURES.idle, { motion: 'still' })[0]!
  const busy = office.frames({ ...FIXTURES.idle, main: { ...FIXTURES.busy.main } }, { motion: 'still' })[0]!
  expect(region(idle, 72, 71, 12, 5)).toContain(ROOM.gold)
  expect(region(busy, 72, 71, 12, 5)).not.toContain(ROOM.gold)
  const sub = office.frames({ ...FIXTURES.idle, agents: [FIXTURES.busy.agents[0]!] }, { motion: 'still' })[0]!
  expect(region(sub, 72, 71, 12, 5)).not.toContain(ROOM.gold)
})

test('office fits all five whole mascots and desks at 100 and 128 columns', () => {
  for (const width of [100, 128]) {
    const d = FIXTURES.busy, c = office.frames(d, { motion: 'still', width })[0]!, layout = officeLayout(d, width)
    const out = toCells(c, width, office.focus!(d, { width })), view = decoded(out.cells)
    expect(c.w).toBe(width); expect(out.columns).toBe(width); expect(layout.desks).toHaveLength(5)
    for (const desk of layout.desks) {
      expect(desk.x + desk.w).toBeLessThanOrEqual(width)
      const tint = OFFICE_CAST[desk.provider]
      expect(region(c, desk.x, 40 + desk.y, desk.w, 21)).toContain(tint)
      // Whole 16-pixel Clawd, including both eyes, is preserved at the smallest full-room width.
      if (desk.provider === 'claude') for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
        const color = c.px[(51 + y + desk.y) * c.w + desk.x + 1 + x]!
        if (CLAWD[y]![x] !== '.') expect(color).toBe(CLAWD[y]![x] === 'k' ? OFFICE_ACCENTS.eye : OFFICE_CAST.claude)
        const at = (Math.floor((51 + y + desk.y) / 2) * width + desk.x + 1 + x) * 12
        expect(view.getUint32(at + ((51 + y + desk.y) % 2 ? 8 : 4), true)).toBe(PALETTE[color])
      }
    }
  }
})

test('office usage pips and combo, arcade model and effort, and sixty-second decision priority are native HUD', () => {
  const d = { ...FIXTURES.review, now: 100000, decisions: [{ decision: 'Keep owner files', why: 'Preserve changes', impact: 'high' as const, at: 50000 }], acts: [{ tool: 'Bash', title: 'git push', state: 'done' as const, kind: 'bash' as const, at: 99999 }], combo: 5 }
  const text = (lines: { text: string }[][]) => lines.map(l => l.map(s => s.text).join('')).join('\n')
  const oh = office.hud!(d, 100)
  expect(text(oh.top)).toContain('COMBO ×5')
  expect(text(office.hud!({ ...d, combo: 4 }, 100).top)).not.toContain('COMBO')
  expect(text(oh.top)).toContain('Codex ▮▮▯▯')
  const arcade = SCENES.arcade
  expect(text(arcade.hud!(d, 100).top)).toContain('opus-5-5 · high')
  for (const scene of [office, arcade]) {
    const events = scene.hud!(d, 100).bottom.filter(l => l.some(s => s.text.includes('decision:') || s.text.includes('push') || s.text === 'SAVE STATE'))
    expect(text(events).split('\n')[0]).toBe('decision: Keep owner files')
    expect(text(events).split('\n')).toHaveLength(2)
    expect(text(scene.hud!({ ...d, now: 109999 }, 100).bottom)).toContain('decision: Keep owner files')
    expect(text(scene.hud!({ ...d, now: 110000 }, 100).bottom)).not.toContain('decision: Keep owner files')
  }
  expect(vibePhase(d)).not.toBe(vibePhase({ ...d, now: 110000 }))
})

test('scene-specific keys omit HUD-only stats and keep drawn signals and refreshed tooltips', () => {
  const d = FIXTURES.busy
  for (const scene of Object.values(SCENES)) {
    const key = sceneKey(d, scene)
    for (const patch of [{ cost: 99 }, { lines: 999 }, { best: 999 }, { combo: 99 }, { commits: 99, pushes: 99 }, { tps: 2 }, { usage: d.usage.map(u => ({ ...u, percent: 55, age: '3h old' })) }, { main: { ...d.main, model: 'Other', effort: 'low' } }, { edit: { ...d.edit!, file: 'other.ts', added: 50, removed: 50 } }]) expect(sceneKey({ ...d, ...patch }, scene)).toBe(key)
    expect(sceneKey({ ...d, agents: [] }, scene)).not.toBe(key)
    expect(sceneKey({ ...d, tests: 'fail', acts: [{ tool: 'Bash', title: 'npm test', kind: 'test', state: 'failed', at: d.now }] }, scene)).not.toBe(key)
  }
  expect(sceneKey({ ...d, ctx: 99 }, office)).toBe(sceneKey(d, office))
  expect(sceneKey({ ...d, ctx: 99 }, SCENES.arcade)).not.toBe(sceneKey(d, SCENES.arcade))
  const two = { ...d, agents: [{ ...d.agents[0]!, id: 'one' }, { ...d.agents[0]!, id: 'two', label: 'Second task' }] }
  const spots = office.hotspots!(two)
  expect(spots[0]!.x + spots[0]!.w).toBeLessThanOrEqual(spots[1]!.x)
  expect(spots[0]!.title).toContain('xhigh')
  expect(spots[1]!.title).toContain('Second task')
  expect(SCENES.arcade.hotspots!(two).find(h => h.title.includes('Codex'))?.title).toContain('xhigh')
})

test('64-column office keeps every enabled provider and drops wall decor', () => {
  const d = { ...FIXTURES.busy, agents: [FIXTURES.busy.agents[0]!, FIXTURES.busy.agents[4]!] }
  const layout = officeLayout(d, 64), c = office.frames(d, { motion: 'still', width: 64 })[0]!
  expect(layout.desks.map(a => a.provider)).toEqual(DESKS)
  for (const desk of layout.desks) expect(region(c, desk.x, 34 + desk.y, desk.w, 28)).toContain(OFFICE_CAST[desk.provider])
  expect(c.px.includes(OFFICE_CAST.antigravity)).toBe(true)
  expect(c.px.includes(OFFICE_CAST.opencode)).toBe(true)
  const all = officeLayout(FIXTURES.busy, 64), crowded = office.frames(FIXTURES.busy, { motion: 'still', width: 64 })[0]!
  expect(all.desks).toHaveLength(5)
  expect(crowded.h).toBeLessThanOrEqual(88)
  for (const desk of all.desks) expect(region(crowded, desk.x, 34 + desk.y, desk.w, 28)).toContain(OFFICE_CAST[desk.provider])
})


test('Office HUD follows quota order, retaining stable provider rows, at most five', () => {
  const d = { ...FIXTURES.busy, main: { ...FIXTURES.busy.main, working: false, waiting: true },
    agents: [node('done-old', { provider: 'codex', model: 'done-old', state: 'done', endedAt: 90000 }),
      node('running-old', { provider: 'opencode', model: 'running-old', startedAt: 1000 }),
      node('done-new', { provider: 'codex', model: 'done-new', state: 'done', endedAt: 99000 }),
      node('running-new', { provider: 'opencode', model: 'running-new', startedAt: 90000 }),
      node('done-mid', { provider: 'codex', model: 'done-mid', state: 'done', endedAt: 95000 }),
      node('done-older', { provider: 'codex', model: 'done-older', state: 'done', endedAt: 80000 })].map(a => ({ ...a, provider: a.provider! })) }
  const agents = office.hud!(d, 128).bottom.filter(row => row[0]?.text === '●').map(row => row.map(s => s.text).join(''))
  expect(agents).toHaveLength(5)
  for (const [i, label] of ['Claude', 'done-new', 'done-mid', 'done-old', 'done-older'].entries()) expect(agents[i]).toContain(label)
})

test('quota HUD clamps remaining percentages and bar counts to zero through one hundred', () => {
  for (const [percent, left] of [[108, 0], [-8, 100], [0, 100], [100, 0]]) {
    const d = { ...FIXTURES.busy, usage: [{ provider: 'codex' as const, on: true, percent: percent!, out: false, tag: 'normal' as const }] }
    const text = quotaHud(d, 128).flat().map(s => s.text).join('')
    expect(text).toContain(`${left}%`)
    expect(text).not.toContain('-8%')
    expect((text.match(/[▮▯]/g) ?? []).length).toBe(4)
  }
})

test('Vibe phase quantises HUD speed, cost and context; tooltips omit per-step counters', () => {
  const d = { ...FIXTURES.busy, tps: 81, cost: 2.31, ctx: 46 }
  expect(vibePhase({ ...d, tps: 89, cost: 2.39, ctx: 49 })).toBe(vibePhase(d))
  for (const patch of [{ tps: 90 }, { cost: 2.4 }, { ctx: 50 }]) expect(vibePhase({ ...d, ...patch })).not.toBe(vibePhase(d))
  const next = { ...d, agents: d.agents.map(a => ({ ...a, steps: a.steps + 1, tokens: 999 })), edit: { ...d.edit!, added: 99, removed: 40, file: 'other.ts' } }
  expect(office.hotspots!(next)).toEqual(office.hotspots!(d))
})

test('desktop SVG is reused while native HUD values and step counters advance', async ($, on) => {
  mock.clock(on, { now: 100000 })
  const state = held(on, { main: { model: 'claude', working: true }, nodes: [node('stable-svg', { provider: 'codex' })], costs: { rows: [], claude: {}, agy: {}, engineUsd: 2.31 }, edits: [{ file: 'first.ts', lines: [], provider: 'codex', added: 1, removed: 1, at: 99000 }] })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: props() })
  const source = (await ui.find({ type: 'Svg' }))?.props.source
  state.nodes![0]!.steps++
  state.costs!.engineUsd = 2.39
  state.edits![0] = { ...state.edits![0]!, file: 'second.ts', added: 20, removed: 30 }
  await ui.redraw()
  expect((await ui.find({ type: 'Svg' }))?.props.source === source).toBe(true)
  expect(await ui.find({ type: 'Text', text: /\$2.39/ })).toBeDefined()
  expect(await ui.find({ key: 'vibe:strip' })).toBeDefined()
  state.nodes![0]!.state = 'done'
  await ui.redraw()
  expect((await ui.find({ type: 'Svg' }))?.props.source === source).toBe(false)
  await ui.unmount(); stopPlayback()
})

test('decisions survive reload, stay isolated by session and retain three hundred entries', async ($, on) => {
  mock.clock(on, { now: 100000 })
  let id = 'decisions-first'
  sessionMocks(on, () => id)
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.delete', (_$, e) => { delete store[e.key]; return { value: undefined } })
  const state = held(on, { decisions: [] })
  const api = { session: { id: async () => id }, store: { get: async (key: string) => store[key] }, state: { get: async ({ key }: { key: keyof State }) => ({ value: state[key], version: 0 }), set: async ({ key }: { key: keyof State }, value: unknown) => { Object.assign(state, { [key]: value }); return { isSet: true, version: 1 } } } } as unknown as EngineInterface
  const start = () => restoreDecisions(api)
  await start()
  await ($.tool as any).call({ tool: 'mcp__agent-overview__decision_log', tool_use_id: 'persist', decision: 'Keep the model order', why: 'Owner ranked it', impact: 'high' })
  expect(store['decisions:decisions-first']).toEqual(state.decisions)
  state.decisions = []; await start()
  expect(state.decisions?.[0]?.decision).toBe('Keep the model order')
  id = 'decisions-second'; await start()
  expect(state.decisions).toEqual([])
  store['decisions:decisions-first'] = Array.from({ length: 300 }, (_, i) => ({ decision: `Choice ${i}`, why: 'Retained', impact: 'low', at: i }))
  id = 'decisions-first'; await start()
  await ($.tool as any).call({ tool: 'mcp__agent-overview__decision_log', tool_use_id: 'last', decision: 'Latest', why: 'Keep it', impact: 'low' })
  expect(state.decisions).toHaveLength(300)
  expect(state.decisions?.[0]?.decision).toBe('Choice 1')
  expect(state.decisions?.at(-1)?.decision).toBe('Latest')
  stopVibe()
})

test('older retained decisions fold without losing the current impact filter', async ($, on) => {
  mock.clock(on, { now: 100000 }); mock.store(on)
  held(on, { ui: { tab: 'dashboard', pick: 'claude', area: 'vibe', vibeTab: 'decisions' }, decisions: Array.from({ length: 24 }, (_, i) => ({ decision: `Choice ${i}`, why: 'Keep', impact: 'low', at: i })) })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: props() })
  const count = async () => (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('vdec:')).length
  expect(await count()).toBe(20)
  await ui.press({ key: 'vdec:older' }); await ui.redraw()
  expect(await count()).toBe(24)
  await ui.press({ key: 'vfilter:high' }); await ui.redraw()
  expect(await count()).toBe(0)
  await ui.unmount()
})
