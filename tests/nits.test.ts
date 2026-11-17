import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { fixture, NOW } from '../tools/pane-fixtures'
import { offText } from '../hooks/toggles'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { arcadePlan } from '../hooks/vibe/arcade'
import { taskQa } from '../hooks/work/stage'

function setup(on: On, state: Record<string, any>) {
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('session.id', () => ({ value: 'preview' }))
  on('process.run', () => ({ value: { stdout: 'abc123', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => { sent.push(e.text); return { text: e.text } })
  return sent
}
const props = (bodyColumns: number, bodyRows = 60) => ({ title: 'Agent panel', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} })

test('off parents explicitly except enabled skills and tools without allowing off siblings', () => {
  const text = offText({ 'plugin:supermatt': 'off', 'skill:supermatt:grilling': 'on', 'skill:supermatt:review': 'off',
    'server:checks': 'off', 'tool:mcp__checks__inspect': 'force', 'tool:mcp__checks__write': 'off' })
  expect(text).toContain('supermatt (except supermatt:grilling, explicitly enabled)')
  expect(text).toContain('checks (except mcp__checks__inspect, explicitly enabled)')
  expect(text).toContain(', supermatt:review,')
  expect(text).toContain(', mcp__checks__write.')
  expect(offText({ 'plugin:supermatt': 'off', 'skill:supermatt:grilling': 'off' })).not.toContain('except')
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Review chat turns never claim reviewers, before or after a review (${surface})`, async ($, on) => {
    const state = fixture({ area: 'work', tab: 'review', stage: 'review', scenario: 'review-chat', busy: true })
    state.nodes = []
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(84) })
    for (const since of [undefined, NOW - 1000]) {
      state.stage.reviewStartedAt = since
      state.nodes = [{ kind: 'task', state: 'running', startedAt: NOW - 2000 }]
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /^Reviewing/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'Claude is working' })).toBeDefined()
      expect(await ui.find({ key: 'rev:launch' })).toBeUndefined()
    }
    state.nodes = [{ kind: 'task', state: 'running', startedAt: NOW }]
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Reviewing · 1 reviewer' })).toBeDefined()
    await ui.unmount()
  })

  test(`earlier Q&A can join Plan, the ADR and implementation without rewriting history (${surface})`, async ($, on) => {
    const state = fixture({ area: 'work', tab: 'plan', stage: 'plan', scenario: 'archived-qa' })
    state.grill = [{ question: 'Before Work or Reset', answer: 'Keep the old decision', at: NOW - 1000 }]
    const original = [...state.grill], sent = setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(84) })
    expect(taskQa(state.grill, state.stage)).toEqual([])
    expect((await ui.find({ key: 'plan:earlier' }))?.text).toContain('Earlier Q&A (1)')
    await ui.press({ key: 'plan:earlier' })
    expect((await ui.find({ key: 'plan:earlier:0' }))?.text).toContain('Keep the old decision')
    state.main.working = true; await ui.redraw()
    expect(await ui.find({ key: 'plan:include-earlier' })).toBeUndefined()
    state.main.working = false; await ui.redraw()
    await ui.press({ key: 'plan:include-earlier' })
    expect(state.grill).toEqual(original)
    expect(taskQa(state.grill, state.stage)).toEqual(original)
    expect(state.stage.startedAt).toBe(NOW)
    await ui.press({ key: 'plan:advance' })
    expect(sent[0]).toContain('Owner answer: Keep the old decision')
    await ui.press({ key: 'impl:launch' })
    expect(sent[1]).toContain('Keep the old decision')
    expect(state.grill[0].at).toBe(NOW - 1000)
    await ui.unmount()
  })

  test(`narrow history budgets both lines and day separators (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'agents', scenario: 'agents-history' })
    state.nodes = []
    state.history.items = Array.from({ length: 30 }, (_, i) => ({ session: 'preview', at: NOW - (30 - i) * 1000, label: `Task ${i}`, model: 'gpt-6.1-sol', state: 'done', ms: 1000, steps: 1 }))
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(49, 20) })
    const shown = async () => (await ui.findAll({ type: 'Box' })).filter(n => String(n.props.key).startsWith('h:'))
    expect((await shown()).length).toBe(5)
    // A new day costs its heading and top margin, leaving no partial two-line item.
    state.history.items.at(-3).at -= 86400000
    await ui.redraw()
    expect((await shown()).length).toBe(3)
    await ui.unmount()
  })

  test(`inherited Off has an inheritance mark without explicit selection fill (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'plugins', scenario: 'expanded-plugins', expanded: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(84) })
    const key = 'mode:skill:supermatt:grilling:off'
    const inherited = await ui.find({ key })
    expect(inherited?.text).toContain('↳Off')
    expect(inherited?.props.variant).not.toBe('primary')
    expect(inherited?.children[0]).not.toMatchObject({ props: { inverse: true } })
    await ui.press({ key: 'mode:skill:supermatt:grilling:on' })
    expect((await ui.find({ key: 'mode:skill:supermatt:grilling:on' }))?.text).not.toContain('↳')
    await ui.unmount()
  })
}

test('arcade markers stay clear of every docking sweep below 128 columns', () => {
  for (const width of [64, 100, 127, 140]) for (const provider of ['claude', 'codex', 'opencode', 'commandcode', 'antigravity'] as const) for (const kind of ['provider-on', 'provider-off', 'handoff'] as const) {
    const d = { ...FIXTURES.busy, events: [{ kind, provider, at: NOW }, { kind: 'priority' as const, at: NOW }, { kind: 'decision' as const, at: NOW }, { kind: 'powerup' as const, at: NOW }] }
    const plan = arcadePlan(d, width)
    for (const marker of plan.markers) for (const dock of plan.docking) {
      expect(marker.x + marker.w < dock.x || marker.x > dock.x + dock.w).toBe(true)
    }
  }
})

