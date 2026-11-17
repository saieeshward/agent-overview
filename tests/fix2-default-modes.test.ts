import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { capWindow, spendBy, unpricedModels } from '../hooks/cost'
import { powerups } from '../hooks/vibe/powerups'
import { stageDeny, workText } from '../hooks/work/stage'
import { fixture, NOW } from '../tools/pane-fixtures'

function setup(on: On, state: Record<string, any>) {
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'fix2' }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const r = await next(e)
    return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r
  })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => {
    const r = await next(e)
    if (r.value?.isSet) state[e.key] = e.value
    return r
  })
}
const props = (width = 122) => ({ title: 'Agent panel', isFocused: true, bodyColumns: width, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} })

test('unpriced usage disables the whole cap, while reported dollars and explicit free prices count', () => {
  const state = fixture({ area: 'overview', tab: 'dashboard', scenario: 'caps', caps: true })
  const c = state.costs, pr = { catalog: {}, overrides: {} }
  expect(capWindow('claude')).toBe('per chat'); expect(capWindow('antigravity')).toBe('per chat'); expect(capWindow('codex')).toBe('a day')
  expect(spendBy(c, pr).claude).toBe(2.35)
  expect(spendBy(c, pr).codex).toBeUndefined()
  expect(unpricedModels(c, pr, 'codex')).toEqual(['gpt-6.1-sol'])
  const priced = { ...pr, overrides: { 'gpt-6.1-sol': { input: 2, output: 10 } } }
  expect(spendBy(c, priced).codex).toBe(1.4)
  expect(spendBy(c, { ...pr, overrides: { 'gpt-6.1-sol': { input: 0, output: 0 } } }).codex).toBe(0)
  c.rows.push({ ...c.rows[0], model: 'unpriced', reported: 2 })
  expect(spendBy(c, priced).codex).toBe(3.4)
  c.rows.push({ ...c.rows[0], model: 'another-unpriced' })
  expect(spendBy(c, priced).codex).toBeUndefined()
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`cap display uses one amount, one price action and honest windows (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'dashboard', scenario: 'caps', caps: true })
    state.ui.cap = undefined
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props() })
    expect((await ui.find({ key: 'cost:claude' }))?.text).toContain('$2.35 / $5 per chat')
    expect((await ui.find({ key: 'cost:codex' }))?.text).toContain('cap off · no price for gpt-6.1-sol')
    expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('cost:setprice:'))).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /model split from next turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /context 46% used/ })).toBeDefined()
    await ui.press({ key: 'cost:setprice:codex' })
    expect(await ui.find({ key: 'pin:gpt-6.1-sol' })).toBeDefined()
    await ui.press({ key: 'prices:back' }); await ui.press({ key: 'tab:settings' })
    await ui.press({ key: 'cap:claude' })
    expect((await ui.find({ key: 'capinput:claude' }))?.props.placeholder).toContain('dollars per chat')
    await ui.select({ key: 'cap:provider', value: 'codex' })
    expect((await ui.find({ key: 'capinput:codex' }))?.props.placeholder).toContain('dollars per day')
    await ui.unmount()
  })

  test(`quota pauses agree across Dashboard and Models (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'dashboard', scenario: 'quota-paused', quota: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props() })
    const chart = await ui.find({ type: 'Svg' })
    const text = chart ? chart.props.alt : (await ui.find({ key: 'usage' }))?.text
    expect(text).toContain('paused · back')
    expect(text).toContain('quota hit')
    expect(text).not.toContain('58% left')
    expect(text).not.toContain('66% left')
    if (chart) expect(chart.props.source).toContain('#f48771')
    await ui.press({ key: 'tab:models' })
    expect((await ui.find({ key: 'pcol:usage:codex' }))?.text).toMatch(/^paused · back/)
    const model = state.routing.picks.find((p: any) => p.provider === 'opencode')
    const modelText = (await ui.findAll({ type: 'Text' })).find(t => t.text === model.model)
    expect(modelText).toBeDefined()
    expect(modelText?.props.weight).not.toBe('bold')
    await ui.unmount()
  })

  test(`List opens only through glyphs and preserves coloured model cells (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'agents', scenario: 'agents-list', list: true, busy: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props() })
    const opens = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('node:'))
    expect(opens).toHaveLength(5)
    expect(opens.every(b => b.text === '›')).toBe(true)
    const id = state.nodes.find((a: any) => a.provider === 'codex').id
    expect((await ui.find({ key: `cell:${id}:model` }))?.text).toContain('gpt-6.1-sol')
    expect((await ui.find({ key: `cell:${id}:time` }))?.text.trim()).toBe(surface === 'desktop' ? '' : '0:20')
    await ui.press({ key: `node:${id}` })
    expect(await ui.find({ key: 'detail:back' })).toBeDefined()
    await ui.unmount()
  })

  test(`saved Work stages remain guarded during preview and the bar stays available while busy (${surface})`, async ($, on) => {
    const state = fixture({ area: 'vibe', tab: 'settings', scenario: 'resume', stage: 'review' })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(49) })
    for (const [stage, launched, locked] of [
      ['plan', false, true],
      ['implement', false, false],
      ['implement', true, false],
      ['review', true, true],
      ['ship', true, false],
    ] as const) {
      state.stage.at = stage
      state.impl.launchedAt = launched ? NOW : undefined
      for (const call of [{ tool: 'Edit' }, { tool: 'Write' }, { tool: 'Bash', command: 'echo change > file.ts' }, { tool: 'Bash', command: 'git commit -m done' }]) {
        expect(!!stageDeny('work', state.stage, call)).toBe(locked)
      }
      if (stage === 'implement' && !launched) expect(workText('work', state.stage, { grill: true }, state.impl)).toContain('Wait.')
      await ui.press({ key: 'area:work' })
      expect((await ui.find({ key: 'area:confirmation' }))?.text).toContain('Work preview')
      expect((await ui.find({ key: 'area:confirmation' }))?.text).not.toContain('Work stage kept')
      expect(state.ui.area).toBe('vibe')
      expect((await ui.find({ key: 'area:cancel' }))?.props.plain).toBe(true)
      await ui.press({ key: 'area:cancel' })
    }
    await ui.press({ key: 'area:work' })
    state.main.working = true
    await ui.redraw()
    expect((await ui.find({ key: 'area:confirm' }))?.text.trim()).toBe('switch after this turn')
    expect((await ui.find({ key: 'area:current' }))?.text).toBe('● working')
    state.main.working = false
    await ui.redraw()
    expect((await ui.find({ key: 'area:current' }))?.text).toBe('idle')
    expect(await ui.find({ key: 'area:confirm' })).toBeDefined()
    await ui.unmount()
  })
}

test('Vibe groups pinned skills under their plugin and retains the pinned tool', () => {
  const s = fixture({ area: 'vibe', tab: 'powerups', scenario: 'crew-and-powers' })
  const groups = powerups(s.installed, [...s.pins, 'skill:ponytail:ponytail-audit'])
  expect(groups).toEqual(['feature:codex-images', 'plugin:ponytail', 'plugin:supermatt', 'tool:mcp__antigravity__gemini_visual_qa'])
})
