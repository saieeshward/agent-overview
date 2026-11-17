import { expect, mock, test } from 'claude-code/testing'
import type { AgentNode, DecisionItem, Guard, Policy, Providers, RouteLogItem, Routing } from '../types'
import { FALLBACK, TASK_TYPES, declarationText, defaultPolicy, defaultTable, isProblem, lanesOpen, normalPolicy, parseDeclaration, resolveRoute } from '../hooks/policy'
import { PROVIDERS, blank, defaultRouting, normalGuard } from '../hooks/state'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const everyone = () => Object.fromEntries(PROVIDERS.map(p => [p.id, blank()])) as Providers
const withOllama = (r: Routing): Routing => ({ ...r, on: { ...r.on, ollama: true } })
const up = { installed: true, up: true }

test('a declaration leads the description: task type then sensitivity, both on the table', () => {
  expect(parseDeclaration('task:build sensitivity:internal Add the parser')).toEqual({ type: 'build', sensitivity: 'internal', rest: 'Add the parser' })
  expect(parseDeclaration('  TASK:private-extract  sensitivity:Client')).toMatchObject({ type: 'private-extract', sensitivity: 'client' })
  const missing = parseDeclaration('Add the parser')
  expect(isProblem(missing) && missing.problem).toBe('missing')
  expect(isProblem(missing) && missing.fix).toContain('task:<type> sensitivity:<client|internal|public>')
  const late = parseDeclaration('Add the parser task:build sensitivity:public')
  expect(isProblem(late) && late.fix).toContain('must come first')
  const odd = parseDeclaration('task:refactor sensitivity:public Tidy')
  expect(isProblem(odd) && odd).toMatchObject({ problem: 'off-table', type: 'refactor' })
  expect(isProblem(parseDeclaration('task:build sensitivity:secret x')) && 'off-table').toBe('off-table')
})

test('the table defaults come from the evals, old saves fill in, and bad entries fall back', () => {
  const t = defaultTable()
  expect(t.summarise).toEqual({ lane: 'ollama', model: 'qwen3.5:9b' })
  expect(t['private-extract'].lane).toBe('ollama')
  expect(t.visual).toEqual({ lane: 'gemini', model: 'gemini-3.8-flash-medium' })
  expect(t.lookup).toEqual({ lane: 'claude', model: 'claude-haiku-5-5', effort: 'low' })
  expect(t.design).toEqual({ lane: 'claude', model: 'claude-opus-5-5', effort: 'high' })
  expect(Object.keys(t).sort()).toEqual([...TASK_TYPES].sort())
  expect(normalPolicy(undefined)).toEqual(defaultPolicy())
  const p = normalPolicy({ declare: 'block', table: { build: { lane: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' }, review: { lane: 'gemini', model: 'not a model!' } }, allow: ['/a/b/', '/a/b', 3] })
  expect(p.declare).toBe('block')
  expect(p.table.build).toEqual({ lane: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' })
  expect(p.table.review).toEqual(defaultTable().review)
  expect(p.allow).toEqual(['/a/b'])
})

test('side lanes close in Claude only, when off or down, and the cloud lane always closes for client work', () => {
  const r = withOllama(defaultRouting())
  expect(lanesOpen(r, up)).toMatchObject({ ollama: true, gemini: true })
  const only = lanesOpen({ ...r, role: 'claude' }, up)
  expect(only).toMatchObject({ ollama: false, gemini: false, why: { ollama: 'Claude only', gemini: 'Claude only' } })
  expect(lanesOpen(defaultRouting(), up).why.ollama).toBe('Ollama is off')
  expect(lanesOpen(r, { installed: true, up: false }).why.ollama).toBe('Ollama is not running')
  expect(lanesOpen(r, up, 'client')).toMatchObject({ ollama: true, gemini: false })
  expect(lanesOpen(r, up, 'client').why.gemini).toContain('client')
  expect(lanesOpen(r, up, 'internal', { allowed: false, why: 'project not on the allowlist' }).why.gemini).toBe('project not on the allowlist')

  const p = defaultPolicy()
  expect(resolveRoute(p, 'summarise', lanesOpen(r, up))).toMatchObject({ lane: 'ollama', model: 'qwen3.5:9b' })
  // Claude only keeps task routing within Claude: the side lanes' work goes to the fallbacks.
  expect(resolveRoute(p, 'summarise', only)).toMatchObject({ ...FALLBACK.ollama, moved: 'Claude only' })
  expect(resolveRoute(p, 'visual', lanesOpen(r, up, 'client'))).toMatchObject({ ...FALLBACK.gemini })
  expect(resolveRoute(p, 'build', only)).toMatchObject({ lane: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' })
})

test('the routing text states the declaration format and the live table briefly', () => {
  const r = withOllama(defaultRouting())
  const text = declarationText(defaultPolicy(), lanesOpen(r, up))
  expect(text).toContain('task:<type> sensitivity:<client|internal|public>')
  expect(text).toContain('summarise → Ollama qwen3.5:9b via ollama_run, no subagent')
  expect(text).toContain('build → Claude claude-sonnet-5-5 (medium)')
  expect(text).toContain('never goes to Gemini')
  expect(text.split('\n').length).toBe(2)
  expect(declarationText(defaultPolicy(), lanesOpen({ ...r, role: 'claude' }, up))).toContain('summarise → Claude claude-haiku-5-5 (low);')
  expect(declarationText({ ...defaultPolicy(), declare: 'block' }, lanesOpen(r, up))).toContain('enforced')
  expect(declarationText({ ...defaultPolicy(), declare: 'off' }, lanesOpen(r, up))).toBe('')
})

function held(on: any, initial: Record<string, any>) {
  const state: Record<string, any> & { nodes: AgentNode[]; decisions: DecisionItem[]; routing: Routing; guard: Guard; policy: Policy; routeLog: RouteLogItem[]; providers: Providers } = {
    nodes: [], decisions: [], routing: withOllama(defaultRouting()), guard: normalGuard(undefined), policy: defaultPolicy(), routeLog: [],
    providers: { ...everyone(), ollama: { ...blank(), status: 'ok', models: [{ id: 'qwen3.5:9b' }] } }, ...initial,
  }
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => {
    const result = await next(e)
    return e.key in state ? { value: { ...result.value, value: state[e.key] } } : result
  })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => {
    const result = await next(e)
    if (e.key in state && result.value?.isSet) state[e.key] = e.value
    return result
  })
  return state
}

test('Agent spawns: the table sets model and effort, a missing declaration warns or blocks, and every decision is logged', async ($, on) => {
  mock.clock(on); mock.store(on)
  const state = held(on, {})
  const toasts: string[] = []
  on('ui.toast', (_$, e: any) => { toasts.push(String(e.text ?? e.message ?? e)); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'tasks' }))
  const spawned: any[] = []
  on('agent.spawn', (_$, e: any) => { spawned.push(e); return { model: e.model ?? 'inherit', agentId: `a${spawned.length}` } })
  const efforts: (string | undefined)[] = []
  on('tool.call', async (_$, e: any) => {
    efforts.push(e.effort)
    const ran = await ($.agent as any).spawn({ tool_use_id: e.tool_use_id, prompt: e.prompt, description: e.description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-chat', background: false, fork: false })
    return ran.deny ? { deny: ran.deny } : { result: { status: 'completed', agentId: ran.agentId, usage: { input_tokens: 100, output_tokens: 20 }, totalDurationMs: 4000 } }
  })
  const call = (id: string, description: string) => ($.tool as any).call({ tool: 'Agent', tool_use_id: id, prompt: 'Do it', description })

  const built = await call('b1', 'task:build sensitivity:internal Add the parser')
  expect(built.deny).toBeUndefined()
  expect(spawned.at(-1).model).toBe('claude-sonnet-5-5')
  expect(efforts.at(-1)).toBe('medium')
  expect(state.routeLog.at(-1)).toMatchObject({ id: 'b1', type: 'build', sensitivity: 'internal', declared: 'ok', lane: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', outcome: 'done', tokens: 120, ms: 4000, agentId: 'a1' })

  // Warn: an undeclared spawn runs, with a toast and a log entry.
  const before = spawned.length
  expect((await call('w1', 'Look around')).deny).toBeUndefined()
  expect(spawned.length).toBe(before + 1)
  expect(toasts.some(t => t.includes('has no task declaration'))).toBe(true)
  expect(state.routeLog.find(x => x.id === 'w1')).toMatchObject({ declared: 'missing', outcome: 'warned' })

  // A side-lane task as a subagent: warn runs it on the Claude fallback and says to call the tool directly.
  await call('s1', 'task:summarise sensitivity:internal Summarise the log')
  expect(spawned.at(-1).model).toBe('claude-haiku-5-5')
  expect(efforts.at(-1)).toBe('low')
  expect(state.routeLog.find(x => x.id === 's1')!.note).toContain('mcp__agent-overview__ollama_run directly')

  // Block refuses both, with the fix, and starts nothing.
  state.policy = { ...state.policy, declare: 'block' }
  const n = spawned.length
  const refused = await call('x1', 'Look around')
  expect(refused.deny ?? refused.text).toContain('task:<type> sensitivity:<client|internal|public>')
  const lane = await call('x2', 'task:private-extract sensitivity:client Pull fields from the brief')
  expect(lane.deny ?? lane.text).toContain('ollama_run')
  expect(spawned.length).toBe(n)
  expect(state.routeLog.filter(x => x.outcome === 'denied').map(x => x.id)).toEqual(['x1', 'x2'])

  // Claude only: side lanes are refused, so the same task runs within Claude on its fallback.
  state.routing = { ...state.routing, role: 'claude' }
  expect((await call('c1', 'task:private-extract sensitivity:client Pull fields')).deny).toBeUndefined()
  expect(spawned.at(-1).model).toBe('claude-haiku-5-5')
  expect(state.routeLog.find(x => x.id === 'c1')!.note).toContain('Claude only')
})

test('Models shows the task table, declaration modes and the routing log; edits persist', async ($, on) => {
  mock.clock(on)
  let stored: Policy | undefined
  on('store.set', { key: 'policy' }, (_$, e, next) => { stored = e.value as Policy; return next(e) })
  mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  const state = held(on, { routeLog: [{ at: 0, id: 'r1', tool: 'Agent', type: 'build', sensitivity: 'internal', declared: 'ok', lane: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', outcome: 'done', tokens: 1200, ms: 5000 }] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props })
    await ui.press({ key: 'tab:models' })
    expect(await ui.find({ type: 'Text', text: 'TASK ROUTING' })).toBeDefined()
    for (const t of TASK_TYPES) expect(await ui.find({ key: `task:lane:${t}` })).toBeDefined()
    expect(await ui.find({ key: 'rl:r1:0' })).toBeDefined()
    await ui.press({ key: 'tasks:declare:block' })
    expect(stored?.declare).toBe('block')
    await ui.select({ key: 'task:effort:build', value: 'high' })
    expect(stored?.table.build.effort).toBe('high')
    await ui.select({ key: 'task:lane:review', value: 'ollama' })
    expect(stored?.table.review).toEqual({ lane: 'ollama', model: 'qwen3.5:9b' })
    await ui.press({ key: 'tasks:reset' })
    expect(stored?.table).toEqual(defaultTable())
    await ui.press({ key: 'tasks:declare:warn' })
    expect(state.policy.declare).toBe('warn')
    await ui.unmount()
  }
})
