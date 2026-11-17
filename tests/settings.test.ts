import { expect, mock, test } from 'claude-code/testing'

import { blank, defaultRouting, handoffList, normalGuard, planDeny, routingText, withPicks } from '../hooks/state'
import type { Act, Guard } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }

test('guard defaults fill old saves and saved values win, including false and zero', async () => {
  const defaults = {
    chat: normalGuard({}).chat,
    mediaWidget: true, mediaBalances: true, creditPrice: {},
    caps: {}, ccBase: undefined, chatLook: true, usageTail: true, autoPause: true,
    planSubagents: 'block', routingGuard: 'warn', babysitterModel: 'claude-sonnet-5-5', codexImages: 'on', ctxWarn: 80, ticker: true, qaLog: true, follow: true, review: false,
    work: { ponytail: true, grill: true }, vibe: { styles: ['office', 'arcade'], motion: 'full' },
  }
  expect(normalGuard(undefined)).toEqual(defaults)
  expect(normalGuard(null)).toEqual(defaults)
  expect(normalGuard({ review: true })).toEqual({ ...defaults, review: true })
  const saved: Guard = {
    chat: normalGuard({}).chat,
    mediaWidget: false, mediaBalances: false, creditPrice: { kling: 0.01 },
    caps: { codex: 5 }, ccBase: { day: 'Mon', value: 12 }, chatLook: false, usageTail: false,
    autoPause: false, planSubagents: 'handoff', routingGuard: 'enforce', babysitterModel: 'claude-haiku-4-5', codexImages: 'force', ctxWarn: 0, ticker: false, qaLog: false, follow: false, review: true,
    work: { ponytail: false, grill: false }, vibe: { styles: ['arcade'], motion: 'still' },
  }
  expect(normalGuard(saved)).toEqual(saved)
  expect(normalGuard({ ctxWarn: 90 }).ctxWarn).toBe(90)
})

test('Settings draws every card and chips persist changes and invalidate cached descriptions', async ($, on) => {
  mock.clock(on)
  let saved = normalGuard(undefined)
  on('store.set', { key: 'guard' }, (_$, e, next) => { saved = e.value as Guard; return next(e) })
  mock.store(on)
  const invalidated: string[] = []
  on('ui.invalidate', (_$, e) => { invalidated.push(e.event); return { value: undefined } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'tab:settings' })
  for (const title of ['CHAT', 'ROUTING', 'LIVE AND REVIEW', 'PANEL']) expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'click a tab · click a setting to change it' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'no caps' })).toBeUndefined()
  for (const key of ['usageTail', 'autoPause', 'ticker', 'qaLog', 'follow', 'mediaWidget', 'mediaBalances']) {
    await ui.press({ key: `setting:${key}:false` })
    expect(saved[key as keyof Guard]).toBe(false)
    expect((await ui.find({ key: `setting:${key}:false` }))?.children[0]).toMatchObject({ props: { inverse: true } })
  }
  await ui.press({ key: 'setting:review:true' })
  await ui.press({ key: 'setting:planSubagents:handoff' })
  await ui.press({ key: 'setting:ctxWarn:0' })
  expect(saved).toMatchObject({ review: true, planSubagents: 'handoff', ctxWarn: 0 })
  expect(invalidated.includes('tool.describe')).toBe(true)
  expect(invalidated.includes('ui.render')).toBe(true)
  expect(invalidated.includes('prompt.section')).toBe(true)
  await ui.press({ key: 'tab:plugins' })
  expect(await ui.find({ key: 'card:chatlook' })).toBeUndefined()
  await ui.unmount()
})

test('Plans-only refusal and handoff use the same numbered mix and routing follows the setting', async () => {
  const r = withPicks({ ...defaultRouting(), role: 'plan' }, [{ provider: 'codex', model: 'builder', note: 'build' }])
  expect(planDeny(r)).toBe(`The owner set Claude to plans only: no Claude subagents or workflows. Hand the task to a side model yourself with Bash (run_in_background for long runs), from the owner's list: ${handoffList(r)}. Then check what comes back.`)
  expect(routingText(r)).toContain('Do not use the Agent or Workflow tool: Claude subagents are refused. Run the side providers yourself with Bash (in the background for long runs) and check what comes back.')
  expect(routingText(r, {}, [], { planSubagents: 'handoff' })).toContain('each Claude subagent is told to pass its task to a side provider')
})

test('Plans only blocks fresh, resumed and forked Claude agents and Workflow before creating nodes', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let calls = 0
  on('agent.spawn', () => { calls++; return { model: 'claude', agentId: 'blocked' } })
  on('tool.call', () => { calls++; return { result: 'ok' } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'tab:models' })
  await ui.press({ key: 'seg:CLAUDE:plan' })
  for (const extra of [{}, { fork: true }, { resume: { agentId: 'existing' } }]) {
    const ran = await ($.agent as any).spawn({ tool_use_id: 'blocked', prompt: 'Build', description: 'Build', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude', background: false, fork: false, ...extra })
    expect(ran.deny).toContain('no Claude subagents or workflows')
  }
  expect((await ($.tool as any).call({ tool: 'Workflow', tool_use_id: 'workflow', script: '' })).deny).toContain('no Claude subagents or workflows')
  expect(calls).toBe(0)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'gopen:blocked' })).toBeUndefined()
  await ui.unmount()
})

test('QA logging off changes its description and live follow off defaults to main until picked', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('tool.describe', (_$, e) => ({ description: e.description }))
  const acts: Record<string, Act> = {
    main: { key: 'main', tool: 'Bash', title: 'main work', state: 'done', at: 1 },
    scout: { key: 'scout', tool: 'Bash', title: 'newest work', state: 'running', at: 2 },
  }
  on('state.get', { plugin: 'agent-overview', key: 'acts' }, () => ({ value: { value: acts, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'tab:settings' })
  await ui.press({ key: 'setting:qaLog:false' })
  const described = await ($.tool as any).describe({ tool: 'mcp__agent-overview__qa_log', description: 'Log everything', provider: { plugin: 'agent-overview', tier: 'user' } })
  expect(described.description).toContain('only while grilling the owner')
  await ui.press({ key: 'setting:follow:false' })
  await ui.press({ key: 'tab:dashboard' })
  expect(await ui.find({ type: 'Text', text: '$ main work' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$ newest work' })).toBeUndefined()
  await ui.press({ key: 'watch:follow' })
  expect(await ui.find({ type: 'Text', text: '$ newest work' })).toBeDefined()
  await ui.unmount()
})

test('context thresholds control the dashboard and band; Settings lists caps', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let g = normalGuard({ caps: { codex: 5 }, ctxWarn: 90 })
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: g, version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'guard' }, (_$, e) => { g = e.value; return { value: { isSet: true, version: 2 } } })
  const all = { claude: { ...blank(), meters: [{ label: 'Context', percent: 85 }] }, codex: blank(), opencode: blank(), commandcode: blank(), antigravity: blank() }
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: all, version: 1 } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: [] } as any))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  const band = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110, scroll: { offset: 0, bodyRows: 4 }, view: {} } })
  expect(await ui.find({ key: 'ctxwarn' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /context 85%/ })).toBeUndefined()
  await ui.press({ key: 'tab:settings' })
  expect(await ui.find({ type: 'Text', text: 'Codex  $5 a day' })).toBeDefined()
  await ui.press({ key: 'setting:ctxWarn:80' })
  await ui.press({ key: 'tab:dashboard' })
  expect(await ui.find({ key: 'ctxwarn' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /context 85%/ })).toBeDefined()
  await ui.press({ key: 'tab:settings' })
  await ui.press({ key: 'setting:ctxWarn:0' })
  await ui.press({ key: 'tab:dashboard' })
  expect(await ui.find({ key: 'ctxwarn' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /context 85%/ })).toBeUndefined()
  await band.unmount()
  await ui.unmount()
})
