import { expect, mock, test } from 'claude-code/testing'
import type { AgentNode, DecisionItem, Guard, Routing } from '../types'
import { defaultRouting, normalGuard, routingText, subagentRoute, withPicks } from '../hooks/state'

const props = { title: 'Agents', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }
const route = (tag: 'main' | 'normal' | 'saver' = 'normal'): Routing => withPicks({ ...defaultRouting(), tags: { claude: tag, codex: tag === 'main' ? 'normal' : 'main' } }, [
  { provider: 'codex', model: 'gpt-builder' }, { provider: 'claude', model: 'claude-worker' },
])
const spawn = (id: string, extra: object = {}) => ({ tool_use_id: id, prompt: 'Review the change', description: 'Review', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-chat', background: false, fork: false, ...extra })
function held(on: any, initial: Record<string, any>) {
  const state: Record<string, any> & { nodes: AgentNode[]; decisions: DecisionItem[]; routing: Routing; guard: Guard } = { nodes: [] as AgentNode[], decisions: [] as DecisionItem[], routing: route(), guard: normalGuard(undefined), ...initial }
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

test('routing guard normalises old settings and describes the live mode', async () => {
  expect(normalGuard({}).routingGuard).toBe('warn')
  expect(normalGuard({ routingGuard: 'invalid' }).routingGuard).toBe('warn')
  for (const mode of ['warn', 'enforce', 'off'] as const) {
    expect(normalGuard({ routingGuard: mode }).routingGuard).toBe(mode)
    expect(routingText(route(), {}, [], { routingGuard: mode }).includes('Routing guard:')).toBe(mode !== 'off')
    expect(routingText({ ...route(), role: 'claude' }, {}, [], { routingGuard: mode }).includes('Routing guard:')).toBe(mode !== 'off')
  }
  expect(routingText(route())).toContain('Routing guard: warn.')
})

for (const tool of ['Agent', 'Workflow'] as const) test(`${tool}: every Claude tag and guard mode; warnings preserve results and never block`, async ($, on) => {
  mock.clock(on)
  const state = held(on, {})
  on('session.id', () => ({ value: 'routing-test' }))
  on('ui.invalidate', () => ({ value: undefined }))
  let persisted: DecisionItem[] = []
  on('store.set', { key: 'decisions:routing-test' }, (_$, e, next) => { persisted = e.value as DecisionItem[]; return next(e) })
  mock.store(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let starts = 0
  on('agent.spawn', () => ({ model: 'claude-worker', agentId: `agent-${++starts}` }))
  on('tool.call', async (_$, e: any) => {
    const ran = await ($.agent as any).spawn(spawn(e.tool_use_id, tool === 'Workflow' ? { workflow: { runId: `wf-${e.tool_use_id}`, agentIndex: 1 } } : {}))
    return ran.deny ? { deny: ran.deny } : { result: 'ok', text: 'original output', ref: 37, isReadOnly: true, context: ['existing context'] }
  })
  let seq = 0
  for (const tag of ['main', 'normal', 'saver'] as const) for (const mode of ['warn', 'enforce', 'off'] as const) {
    state.routing = route(tag); state.guard = normalGuard({ routingGuard: mode }); state.nodes = []; state.decisions = []
    await ($.turn as any).start({ text: 'Review', turnId: `turn-${++seq}` })
    const before = starts
    const result = await ($.tool as any).call({ tool, tool_use_id: `call-${seq}`, script: '', prompt: 'Review the change', description: 'Review' })
    const blocked = mode === 'enforce' && tag !== 'main'
    expect(starts - before).toBe(blocked ? 0 : 1)
    if (blocked) {
      expect(result.deny).toContain(tag === 'saver' ? 'Claude is Saver' : 'Reason: ')
      expect(state.nodes.length).toBe(0)
      expect(state.decisions.length).toBe(0)
    } else {
      expect(result).toMatchObject({ result: 'ok', text: 'original output', ref: 37, isReadOnly: true })
      const warned = mode === 'warn' && tag !== 'main'
      expect(result.context.length).toBe(warned ? 2 : 1)
      expect(result.context[0]).toBe('existing context')
      expect(state.decisions.length).toBe(warned ? 1 : 0)
      if (warned) {
        const notice = tag === 'saver' ? 'Claude is Saver: conserve it; hand this to Codex (gpt-builder).' : 'Routing: Main is Codex (gpt-builder). Prefer handing tasks to it; use Claude subagents when a task needs Claude.'
        expect(result.context[1]).toBe(notice)
        expect(state.nodes.find(n => n.agentId)?.offRoute).toBe(notice)
        expect(state.decisions[0]).toMatchObject({ decision: 'Claude subagent used while Main is Codex: Review', why: notice, impact: tag === 'saver' ? 'medium' : 'low' })
        expect(persisted).toEqual(state.decisions)
      }
    }
  }
})

for (const tool of ['Agent', 'Workflow'] as const) test(`${tool}: enforce needs a same-turn retry with a nonempty reason and logs it`, async ($, on) => {
  mock.clock(on); mock.store(on)
  const state = held(on, { guard: normalGuard({ routingGuard: 'enforce' }) })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-worker', agentId: 'reason-agent' }))
  on('tool.call', async (_$, e: any) => {
    const ran = await ($.agent as any).spawn(spawn(e.tool_use_id, { prompt: e.prompt ?? 'workflow placeholder', description: e.description ?? 'Review', ...(tool === 'Workflow' ? { workflow: { runId: 'wf-reason', agentIndex: 1 } } : {}) }))
    return ran.deny ? { deny: ran.deny } : { result: 'ok' }
  })
  const run = (id: string, reason: string) => ($.tool as any).call({ tool, tool_use_id: id, prompt: 'Review', description: reason, script: `// ${reason}\nexport default {}` })
  await ($.turn as any).start({ text: 'Review', turnId: 'first' })
  expect((await run('first', 'Reason: needs Claude context')).deny).toContain('call again in this turn')
  expect((await run('empty', 'Reason: ')).deny).toContain('Reason: ')
  expect((await run('no-reason', 'Review')).deny).toContain('Reason: ')
  expect((await run('accepted', 'Reason: needs Claude context')).result).toBe('ok')
  expect(state.decisions.length).toBe(1)
  expect(state.decisions[0]).toMatchObject({ why: 'Reason: needs Claude context', impact: 'low' })
  expect(state.nodes.find(n => n.agentId)?.offRoute).toBe('Reason: needs Claude context')
  await ($.turn as any).start({ text: 'Review again', turnId: 'second' })
  expect((await run('next-turn', 'Reason: needs Claude context')).deny).toContain('call again in this turn')
})

test('guard checks fresh, forked and resumed spawns before any run, and marks accepted resumes', async ($, on) => {
  mock.clock(on); mock.store(on)
  const state = held(on, { guard: normalGuard({ routingGuard: 'enforce' }), nodes: [{ id: 'old', agentId: 'resume', label: 'Existing', kind: 'task', model: 'claude', state: 'done', steps: 1 }] })
  let calls = 0
  on('agent.spawn', (_$, e) => ({ model: 'claude', agentId: e.resume?.agentId ?? `new-${++calls}` }))
  for (const extra of [{}, { fork: true }, { resume: { agentId: 'resume' } }]) expect((await ($.agent as any).spawn(spawn(`blocked-${calls}`, extra))).deny).toContain('Reason: ')
  expect(calls).toBe(0)
  expect(state.nodes[0]!.state).toBe('done')
  const accepted = await ($.agent as any).spawn(spawn('retry', { resume: { agentId: 'resume' }, prompt: 'Reason: keep the existing context' }))
  expect(accepted.agentId).toBe('resume')
  expect(state.nodes[0]).toMatchObject({ state: 'running', offRoute: 'Reason: keep the existing context' })
  expect(state.decisions[0]!.why).toBe('Reason: keep the existing context')
  state.guard.routingGuard = 'warn'
  await ($.agent as any).spawn(spawn('fork', { fork: true }))
  expect(state.decisions.length).toBe(2)
})

test('Saver enforce hands each workflow agent to Main; fixed resumes and forks are refused', async ($, on) => {
  mock.clock(on); mock.store(on)
  const state = held(on, { routing: withPicks(route('saver'), [{ provider: 'codex', model: 'gpt-builder' }]), guard: normalGuard({ routingGuard: 'enforce', planSubagents: 'handoff' }) })
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    expect(state.nodes.at(-1)!.model).toBe('…')
    prompts.push(e.prompt)
    return { model: 'claude', agentId: `handoff-${prompts.length}` }
  })
  on('tool.call', async (_$, e: any) => {
    for (let i = 1; i <= 2; i++) await ($.agent as any).spawn(spawn(e.tool_use_id, { workflow: { runId: 'wf-handoff', agentIndex: i } }))
    return { result: 'ok' }
  })
  expect((await ($.tool as any).call({ tool: 'Workflow', tool_use_id: 'handoff', script: '' })).result).toBe('ok')
  expect(prompts.length).toBe(2)
  for (const prompt of prompts) {
    expect(prompt).toContain('Claude is Saver')
    expect(prompt).toContain('codex exec -m gpt-builder')
    expect(prompt).toContain('Check what comes back')
    expect(prompt).toContain('Review the change')
  }
  for (const extra of [{ fork: true }, { resume: { agentId: 'existing' } }]) expect((await ($.agent as any).spawn(spawn('fixed', extra))).deny).toContain('Claude is Saver')
  expect(state.decisions.length).toBe(0)
})

test('a workflow reason covers agents started after the tool returns', async ($, on) => {
  mock.clock(on); mock.store(on)
  const state = held(on, { guard: normalGuard({ routingGuard: 'enforce' }) })
  on('agent.spawn', () => ({ model: 'claude', agentId: 'late' }))
  on('tool.call', () => ({ result: 'background workflow' }))
  const input = { tool: 'Workflow', script: '// Reason: needs Claude review context', tool_use_id: 'background' }
  expect((await ($.tool as any).call(input)).deny).toContain('Reason: ')
  expect((await ($.tool as any).call({ ...input, tool_use_id: 'background-retry' })).result).toBe('background workflow')
  const ran = await ($.agent as any).spawn(spawn('background-retry', { workflow: { runId: 'wf-background', agentIndex: 1 } }))
  expect(ran.agentId).toBe('late')
  expect(state.decisions.at(-1)!.why).toBe('Reason: needs Claude review context')
})

test('no allowed side model, Claude Main, Claude only and Plans only retain their rules', async () => {
  const g = normalGuard({ routingGuard: 'enforce' })
  for (const r of [route('main'), { ...route(), role: 'claude' as const }, { ...route(), role: 'plan' as const }, { ...route(), on: { ...route().on, codex: false } }, { ...route(), paused: { codex: { why: 'quota', at: 0, until: 999 } } }]) expect(subagentRoute(r, g, {}, false)).toEqual({})
  const saver = route('saver')
  saver.tags!.codex = 'saver'
  expect(subagentRoute(saver, normalGuard(undefined), {}, false).notice).toContain('hand this to Codex')
})

for (const surface of ['terminal', 'desktop'] as const) test(`${surface}: shared routing guard switch persists on Settings and Crew; off-route graph, list and detail`, async ($, on) => {
  mock.clock(on)
  const state = held(on, { ui: { tab: 'settings', pick: 'claude', area: 'overview' }, nodes: [{ id: 'marked', agentId: 'marked-agent', label: 'Review', kind: 'task', model: 'claude', state: 'running', steps: 1, startedAt: 1, offRoute: 'Reason: needs Claude context' }] })
  let saved = normalGuard(undefined)
  on('store.set', { key: 'guard' }, (_$, e, next) => { saved = e.value as Guard; return next(e) })
  mock.store(on)
  let invalidations = 0
  on('ui.invalidate', (_$, e) => { if (e.event === 'prompt.section') invalidations++; return { value: undefined } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  for (const mode of ['warn', 'enforce', 'off'] as const) expect(await ui.find({ key: `setting:routingGuard:${mode}` })).toBeDefined()
  await ui.press({ key: 'setting:routingGuard:enforce' })
  expect(state.guard.routingGuard).toBe('enforce')
  expect(saved.routingGuard).toBe('enforce')
  state.ui = { ...state.ui, area: 'vibe', vibeTab: 'crew' }; await ui.redraw()
  expect(await ui.find({ key: 'setting:routingGuard:warn' })).toBeDefined()
  await ui.press({ key: 'setting:routingGuard:warn' })
  expect(state.guard.routingGuard).toBe('warn')
  expect(invalidations).toBe(2)
  state.ui = { ...state.ui, area: 'overview', tab: 'agents', agents: 'graph' }; await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^ ?off-route$/ })).toMatchObject({ props: { color: 'warning' } })
  await ui.press({ key: 'gopen:marked' })
  expect((await ui.find({ type: 'Text', text: /off-route: Reason:/ }))?.text).toContain('Reason: needs Claude context')
  await ui.press({ key: 'detail:back' })
  await ui.press({ key: 'chip:list' })
  expect(await ui.find({ type: 'Text', text: /^ ?off-route$/ })).toBeDefined()
  await ui.unmount()
})

test('Plans only and Claude only keep their Agent and Workflow rules in every guard mode', async ($, on) => {
  mock.clock(on); mock.store(on)
  const state = held(on, {})
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => { prompts.push(e.prompt); return { model: 'claude', agentId: `role-${prompts.length}` } })
  on('tool.call', async (_$, e: any) => {
    const ran = await ($.agent as any).spawn(spawn(e.tool_use_id, e.tool === 'Workflow' ? { workflow: { runId: 'wf-role', agentIndex: 1 } } : {}))
    return ran.deny ? { deny: ran.deny } : { result: 'ok' }
  })
  for (const mode of ['warn', 'enforce', 'off'] as const) {
    state.guard = normalGuard({ routingGuard: mode })
    state.routing = { ...route('saver'), role: 'plan' }
    for (const tool of ['Agent', 'Workflow']) expect((await ($.tool as any).call({ tool, tool_use_id: `block-${tool}-${mode}`, script: '' })).deny).toContain('no Claude subagents or workflows')
    state.guard.planSubagents = 'handoff'
    for (const tool of ['Agent', 'Workflow']) {
      expect((await ($.tool as any).call({ tool, tool_use_id: `handoff-${tool}-${mode}`, script: '' })).result).toBe('ok')
      expect(prompts.at(-1)).toContain('Claude plans only')
    }
    state.routing.role = 'claude'
    for (const tool of ['Agent', 'Workflow']) {
      const result = await ($.tool as any).call({ tool, tool_use_id: `claude-${tool}-${mode}`, script: '' })
      expect(result.result).toBe('ok')
      expect(result.context).toBeUndefined()
      expect(prompts.at(-1)).toBe('Review the change')
    }
    expect(state.decisions.length).toBe(0)
  }
})

for (const tool of ['Agent', 'Workflow'] as const) test(`${tool}: warn preserves the underlying error and existing context`, async ($, on) => {
  mock.clock(on); mock.store(on)
  const state = held(on, {})
  on('agent.spawn', () => ({ model: 'claude', agentId: 'error-agent' }))
  on('tool.call', async (_$, e: any) => {
    await ($.agent as any).spawn(spawn(e.tool_use_id, tool === 'Workflow' ? { workflow: { runId: 'wf-error', agentIndex: 1 } } : {}))
    return { result: 'underlying failure', text: 'original error', isError: true, ref: 19, context: ['existing'] }
  })
  const result = await ($.tool as any).call({ tool, tool_use_id: 'error', script: '' })
  expect(result).toMatchObject({ result: 'underlying failure', text: 'original error', isError: true, ref: 19 })
  expect(result.deny).toBeUndefined()
  expect(result.context[0]).toBe('existing')
  expect(result.context[1]).toContain('Routing: Main is Codex')
  expect(state.decisions.length).toBe(1)
})
