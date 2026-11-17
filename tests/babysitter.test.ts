import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import type { AgentNode, Guard, Routing } from '../types'
import { BABYSITTER_MODEL, babysitting, babysitterModel, displayAgents, displayHistory } from '../hooks/babysitter'
import { normalGuard, routingText, subagentRoute, withPicks } from '../hooks/state'
import { stagesOf, buildTree } from '../hooks/graph'
import { vibeData } from '../hooks/vibe/data'
import { officeStatus } from '../hooks/vibe/office'
import { arcadePlan } from '../hooks/vibe/arcade'
import { fixture, NOW } from '../tools/pane-fixtures'

const prompt = 'Run Codex with codex exec "Review the math" and wait, then report back its result.'
const spawn = (id: string, extra: object = {}) => ({ tool_use_id: id, prompt, description: 'review:codex-math', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false, ...extra })
const props = { title: 'Agent panel', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 100 }, view: {} }
const textOf = (tree: any): string => typeof tree === 'string' ? tree : (tree?.children ?? []).map(textOf).join(' ')
function held(on: On, initial: Record<string, any>) {
  const state = fixture({ area: 'overview', tab: 'agents', busy: true, scenario: 'babysitter-list', list: true })
  Object.assign(state, initial)
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.id', () => ({ value: 'preview' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const r = await next(e)
    return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r
  })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const r = await next(e)
    if (r.value?.isSet) state[e.key] = e.value
    return r
  })
  return state
}

test('babysitting detection requires a side run and a return, and rejects work for the driver', () => {
  for (const task of [prompt, 'Run opencode run "Review types" and report back.', 'Run commandcode --model worker -p "Review" and return the result.', 'Use gemini_visual_qa and report back.', 'Use the Command Code CLI with -p and report back.', 'Ask Antigravity to review and report back.', 'Hand to Command Code and return its answer.']) expect(babysitting(task)).toBe(true)
  for (const task of ['Implement routing and add tests.', 'Review the Codex integration.', 'Explain how codex exec works.', 'Explain how codex exec works and report the options.', 'Run Codex for a review.', `${prompt} Implement fixes after.`, 'Do not run Codex; report on the implementation.', `${prompt} Also implement the fixes yourself.`, 'Ask OpenCode for a review and report back, then fix the code.', 'Run codex exec "Review" and report back; personally write the tests.']) expect(babysitting(task)).toBe(false)
  expect(babysitterModel(prompt, undefined)).toBe(BABYSITTER_MODEL)
  expect(babysitterModel(prompt, 'claude-opus-5-5')).toBe(BABYSITTER_MODEL)
  expect(babysitterModel(prompt, 'haiku')).toBe('haiku')
  expect(babysitterModel(prompt, 'sonnet')).toBe('sonnet')
  expect(babysitterModel(prompt, 'claude-haiku-4-5')).toBe('claude-haiku-4-5')
  expect(babysitterModel(prompt, 'claude-sonnet-5-5', 'claude-haiku-4-5')).toBe('claude-haiku-4-5')
  expect(babysitterModel('Implement the change', 'claude-opus-5-5')).toBeUndefined()
})

test('guard defaults migrate saved values and routing describes the shared model', () => {
  for (const value of [undefined, null, {}, { babysitterModel: '' }, { babysitterModel: 3 }, { babysitterModel: 'gpt-6.1-sol' }]) expect(normalGuard(value).babysitterModel).toBe(BABYSITTER_MODEL)
  expect(normalGuard({ babysitterModel: 'claude-haiku-4-5' }).babysitterModel).toBe('claude-haiku-4-5')
  const state = fixture({ area: 'overview', tab: 'models', scenario: 'babysitter-models' })
  const r = withPicks({ ...state.routing, tags: { claude: 'saver', codex: 'main' } }, [{ provider: 'codex', model: 'gpt-6.1-sol' }])
  expect(routingText(r)).toContain(`Subagents that only run and wait on a side provider use ${BABYSITTER_MODEL}.`)
  for (const routingGuard of ['warn', 'enforce'] as const) {
    const g = normalGuard({ routingGuard })
    expect(subagentRoute(r, g, { prompt, model: BABYSITTER_MODEL }, false)).toEqual({})
    expect(subagentRoute(r, g, { prompt, model: 'claude-haiku-4-5' }, false)).toEqual({})
    expect(subagentRoute(r, g, { prompt: 'Write the code', model: BABYSITTER_MODEL }, false)).not.toEqual({})
    expect(subagentRoute(r, g, { prompt, model: 'claude-opus-5-5' }, false)).not.toEqual({})
  }
})

test('projection hides only drivers with linked side runs, preserves labels, state, run and ancestry', () => {
  const state = fixture({ area: 'overview', tab: 'agents', scenario: 'babysitter-list', busy: true })
  const list = state.nodes as AgentNode[]
  const shown = displayAgents(list)
  expect(shown.length).toBe(4)
  expect(shown.map(n => n.label)).toEqual(['review:codex', 'review:opencode', 'review:commandcode', 'review:antigravity'])
  expect(shown.every(n => n.state === 'running' && !n.parentNode)).toBe(true)
  expect(displayAgents(shown)).toEqual(shown)
  expect(list[1]!.label).toBe('Run side review')
  expect(buildTree(shown).length).toBe(4)
  expect(stagesOf(shown)[0]!.nodes.length).toBe(4)
  const prelaunch = list.filter(n => n.agentId)
  expect(displayAgents(prelaunch).length).toBe(4)
  list[1]!.parentNode = undefined
  expect(displayAgents(list).length).toBe(4)
  list[0]!.parentNode = 'workflow'
  expect(displayAgents(list).find(n => n.id === 'driven:0')!.parentNode).toBe('workflow')
  list[1]!.parentNode = 'driver:0'
  expect(displayAgents(list).find(n => n.id === 'driven:0')!.parentNode).toBe('workflow')
  for (const evidence of [{ ownEdits: true }, { trail: [{ tool: 'Edit', at: NOW }] }]) {
    const working = list.map(n => n.id === 'driver:0' ? { ...n, ...evidence } : n)
    expect(displayAgents(working).length).toBe(5)
    expect(displayAgents(working).find(n => n.id === 'driven:0')!.label).toBe('Run side review')
  }
  expect(displayAgents(list, [{ agent: 'claude:0', file: 'a.ts', lines: [] }]).length).toBe(5)
  const h = list.map(n => ({ at: n.startedAt!, label: n.label, model: n.model, provider: n.provider, state: 'done' as const, ms: 10, session: 'preview' }))
  expect(displayHistory(h, list).map(n => n.label)).toEqual(shown.map(n => n.label))
  expect(displayHistory(h, list).length).toBe(4)
})

for (const tool of ['Agent', 'Workflow'] as const) test(`${tool} rewrites costly babysitters before spawn and keeps cheaper explicit calls; guard stays quiet`, async ($, on) => {
  const state = held(on, { nodes: [], decisions: [], guard: normalGuard({ routingGuard: 'enforce' }) })
  state.routing = withPicks({ ...state.routing, tags: { claude: 'saver', codex: 'main' } }, [{ provider: 'codex', model: 'gpt-6.1-sol' }])
  const seen: any[] = []
  on('agent.spawn', (_$, e) => { seen.push(e); return { model: e.model ?? 'claude-opus-5-5', agentId: `spawned:${seen.length}` } })
  on('tool.call', async (_$, e: any) => {
    const ran = await ($.agent as any).spawn(spawn(e.tool_use_id, { model: e.model, ...(tool === 'Workflow' ? { workflow: { runId: 'wf-babysitter', agentIndex: seen.length + 1 } } : {}) }))
    return ran.deny ? { deny: ran.deny } : { result: 'ok' }
  })
  for (const [i, model] of [undefined, 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'].entries()) {
    const result = await ($.tool as any).call({ tool, tool_use_id: `babysitter-${tool}-${i}`, prompt, script: `export default async () => agent(${JSON.stringify(prompt)})`, model })
    expect(result.result).toBe('ok')
    expect(result.context).toBeUndefined()
    expect(seen[i]!.model).toBe(i === 3 ? 'claude-haiku-4-5' : BABYSITTER_MODEL)
  }
  expect(state.decisions.length).toBe(2)
  expect(state.decisions.every((d: any) => d.decision === `babysitter moved to ${BABYSITTER_MODEL}`)).toBe(true)
  expect(state.nodes.every((n: any) => !n.offRoute)).toBe(true)
  state.guard = normalGuard({ routingGuard: 'off', babysitterModel: 'claude-haiku-4-5' })
  await ($.agent as any).spawn(spawn('custom', { model: 'claude-opus-5-5' }))
  expect(seen.at(-1)!.model).toBe('claude-haiku-4-5')
  for (const extra of [{ prompt: 'Implement routing yourself', model: 'claude-opus-5-5' }, { fork: true }, { resume: { agentId: 'existing' } }]) {
    await ($.agent as any).spawn(spawn('untouched', extra))
    expect(seen.at(-1)!.model).toBe('model' in extra ? extra.model : undefined)
  }
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`all five babysitter pickers edit the same saved guard (${surface})`, async ($, on) => {
    let saved: Guard | undefined
    on('store.set', { key: 'guard' }, (_$, e, next) => { saved = e.value as Guard; return next(e) })
    const state = held(on, {})
    const original = JSON.stringify(state.routing)
    for (const [area, tab] of [['overview', 'settings'], ['overview', 'models'], ['vibe', 'crew'], ['vibe', 'settings'], ['work', 'settings']]) {
      Object.assign(state.ui, { area, tab: area === 'overview' ? tab : 'dashboard', vibeTab: area === 'vibe' ? tab : 'live', workTab: area === 'work' ? tab : 'plan', detail: undefined })
      const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
      expect((await ui.find({ key: 'babysitter:model' }))?.props.value).toBe(state.guard.babysitterModel)
      await ui.select({ key: 'babysitter:model', value: 'claude-haiku-4-5' })
      expect(state.guard.babysitterModel).toBe('claude-haiku-4-5')
      expect(saved!.babysitterModel).toBe('claude-haiku-4-5')
      await ui.select({ key: 'babysitter:model', value: BABYSITTER_MODEL })
      expect(saved!.babysitterModel).toBe(BABYSITTER_MODEL)
      await ui.unmount()
    }
    expect(JSON.stringify(state.routing)).toBe(original)
  })
  test(`dashboard, graph, list, Work and Vibe expose driven runs once (${surface})`, async ($, on) => {
    const state = held(on, {})
    state.main = { model: 'claude-chat', working: false }
    state.stage = { at: 'implement', reached: ['plan', 'implement'], round: 1, seen: ['plan', 'implement'] }
    state.nodes = state.nodes.map((n: AgentNode) => n.agentId ? { ...n, model: 'claude-opus-driver' } : n)
    for (const [area, tab, agents] of [['overview', 'dashboard', 'graph'], ['overview', 'agents', 'graph'], ['overview', 'agents', 'list'], ['work', 'implement', 'graph'], ['vibe', 'live', 'graph']]) {
      Object.assign(state.ui, { area, tab: area === 'overview' ? tab : 'dashboard', workTab: tab, vibeTab: tab, agents, detail: undefined })
      const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
      const tree = await ui.drawn(), text = textOf(tree)
      expect(text).not.toContain('panel error:')
      expect(JSON.stringify(tree)).not.toContain('opus-driver')
      expect(text).not.toContain('Run side review')
      if (tab !== 'live') expect(JSON.stringify(tree)).toContain('review:codex')
      if (tab === 'dashboard') {
        if (surface === 'desktop') expect((await ui.find({ key: 'tile:run' }))?.text).toContain('4')
        expect((await ui.find({ key: 'tab:agents' }))?.text).toContain('4')
        expect(await ui.find({ key: 'tile:done' })).toBeUndefined()
      }
      await ui.unmount()
    }
    const api = { clock: { now: async () => NOW }, state: { get: async ({ key }: { key: string }) => ({ value: state[key] ?? ({ prices: { catalog: {}, overrides: {} }, turnCosts: [], live: null, sideLive: null } as Record<string, unknown>)[key], version: 0 }) } } as unknown as EngineInterface
    const d = await vibeData(api)
    expect(d.agents.length).toBe(4)
    expect(d.agents.map(a => a.label)).toContain('review:codex')
    expect(officeStatus(d, 'claude').typing).toBe(false)
    expect(officeStatus(d, 'codex').typing).toBe(true)
    expect(arcadePlan(d).ships.filter(s => s.working).length).toBe(4)
    Object.assign(state.ui, { area: 'overview', tab: 'agents', detail: 'driven:0' })
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    expect((await ui.find({ type: 'Text', text: /Driven by Claude/ }))?.text).toContain('Driven by Claude')
    expect((await ui.find({ type: 'Text', text: /Driven by Claude/ }))?.props.dimColor).toBe(true)
    await ui.unmount()
    state.nodes = state.nodes.map((n: AgentNode) => ({ ...n, state: 'done', endedAt: NOW - 100 }))
    const finished = await vibeData(api)
    expect(finished.finishedTasks).toBe(4)
    expect(finished.agents.filter(n => n.state === 'done').length).toBe(4)
    Object.assign(state.ui, { area: 'overview', tab: 'dashboard', detail: undefined })
    const done = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    expect(await done.find({ key: 'tile:run' })).toBeUndefined()
    expect(await done.find({ key: 'tile:done' })).toBeDefined()
    if (surface === 'desktop') expect((await done.find({ key: 'tile:done' }))?.text).toContain('4')
    await done.unmount()
  })
}

test('history persists only the driven result and its driver task label', async ($, on) => {
  const state = held(on, {})
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'review complete' }))
  await ($.turn as any).complete({ agentId: 'claude:0', answer: 'Relayed result', reason: 'answer', turnId: 'driver-finished' })
  expect(state.history.items.length).toBe(0)
  // The real side-run recorder persists through track(), independently of the driver's completion.
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'history-side', agentId: 'claude:1', command: 'opencode run "Review"', description: 'Run side review' })
  expect(state.history.items.length).toBe(1)
  expect(state.history.items[0]).toMatchObject({ label: 'review:opencode', provider: 'opencode', state: 'done' })
  state.nodes = []
  expect(displayHistory(state.history.items, []).length).toBe(1)
})
