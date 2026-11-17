import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On, PluginState } from 'claude-code'
import type { Area, Routing, Stage, Ui, VibeEvent } from '../types'
import { blank, defaultRouting, normalRouting, tagOf, withPicks } from '../hooks/state'
import { restoreMode } from '../hooks/modes'
import { cyclePowerup, toggleMode } from '../hooks/toggles'
import { powerLabel } from '../hooks/vibe/powerups'
import { handoff } from '../hooks/vibe/crew'
import { activeEvents, eventLabel, REACTION_MS } from '../hooks/vibe/events'
import { sceneKey, vibeData } from '../hooks/vibe/data'
import { arcade, arcadePlan } from '../hooks/vibe/arcade'
import { C, ROOM } from '../hooks/vibe/engine'
import { SCENES } from '../hooks/vibe/scenes'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { fixture } from '../tools/pane-fixtures'
import { agentHud, office, officeActor, officeLayout, DESK_X } from '../hooks/vibe/office'
import { canvas } from '../hooks/vibe/engine'
import { advance, freshStage, REVIEW_LOCK, stageDeny, workText } from '../hooks/work/stage'

type State = Partial<PluginState['agent-overview']>
function setup(on: On, initial: State = {}, session = () => 'mode-test') {
  const clock = mock.clock(on, { now: 100000 })
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.delete', (_$, e) => { delete store[e.key]; return { value: undefined } })
  const state: State = { ui: { tab: 'dashboard', pick: 'claude', area: 'vibe', vibeTab: 'crew' },
    routing: normalRouting(withPicks(defaultRouting(), [{ provider: 'claude', model: 'opus' }, { provider: 'codex', model: 'gpt' }, { provider: 'opencode', model: 'deepseek' }])),
    providers: { claude: { ...blank(), status: 'ok', meters: [{ label: 'Session', percent: 87 }] }, codex: { ...blank(), status: 'ok', models: [{ id: 'gpt' }, { id: 'backup' }] }, opencode: { ...blank(), status: 'ok' }, antigravity: blank(), commandcode: blank(), ollama: blank() },
    toggles: {}, pins: [], installed: { plugins: [{ name: 'ponytail', enabled: true, where: 'claude', skills: ['ponytail'] }], mcpServers: [], skills: 1 },
    vibe: { acts: [], combo: 0, commits: 0, pushes: 0, best: 0, phase: '' }, ...initial }
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) Object.assign(state, { [e.key]: e.value }); return r })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.id', () => ({ value: session() }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  return { state, clock, store }
}
const props = { title: 'Agent panel', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} }

test('saved Claude off state recovers while side provider switches stay off', () => {
  const r = normalRouting({ ...defaultRouting(), on: { claude: false, codex: false }, tags: { claude: 'saver' } })
  expect(r.on.claude).toBe(true); expect(r.on.codex).toBe(false); expect(tagOf(r, 'claude')).toBe('saver')
})

for (const surface of ['desktop', 'terminal'] as const) for (const style of ['office', 'arcade'] as const) test(`failure survives simultaneous reactions and Still on ${surface} ${style}`, async ($, on) => {
  const f = fixture({ area: 'vibe', tab: 'live', style, busy: true, motion: 'still', scenario: `${style}-collide-still` })
  const { state, clock } = setup(on, f)
  await clock.advance((f.now ?? FIXTURES.busy.now) - 100000)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: { ...props, scroll: { offset: 0, bodyRows: 90 } } })
  expect((await ui.find({ type: 'Text', text: 'Tests failing' }))?.props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: 'New decision' })).toBeDefined()
  const rows = (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t.startsWith('● ') && t.includes(' · '))
  expect(rows).toHaveLength(5)
  expect(rows[0]).toContain('Claude'); expect(rows[0]).toContain('saver')
  expect(rows[1]).toContain('Codex'); expect(rows[2]).toContain('OpenCode')
  expect(rows.some(t => t.includes('Check the parser'))).toBe(true)
  expect(rows.some(t => t.includes('typing'))).toBe(false)
  state.vibe!.events = []; await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Tests failing' })).toBeDefined()
  await ui.unmount()
})

test('agent rows follow quota order while retaining task labels and edit totals', () => {
  const d = { ...FIXTURES.busy, usage: [...FIXTURES.busy.usage].reverse() }
  const rows = agentHud(d, 100).map(r => r.map(s => s.text).join(''))
  for (const [i, u] of d.usage.entries()) expect(rows[i]).toContain(d.agents.find(a => a.provider === u.provider)!.label)
  expect(rows.find(r => r.includes('Codex'))).toContain('view.tsx +24 −7')
})


test('terminal saver keeps the mascot silhouette in grey and failures tint a whole bay', () => {
  const d = { ...FIXTURES.busy, usage: FIXTURES.busy.usage.map(u => ({ ...u, tag: u.provider === 'claude' ? 'saver' as const : u.tag })) }
  const c = canvas(160, 80, 255); officeActor(c, d, 'claude', 0)
  const lit = canvas(160, 80, 255); officeActor(lit, FIXTURES.busy, 'claude', 0)
  expect([...c.px].map(p => p !== 255)).toEqual([...lit.px].map(p => p !== 255))
  expect(c.px.includes(ROOM.edge)).toBe(true)
  const fail = office.frames(FIXTURES.failing, { motion: 'still' })[0]!
  expect(fail.px[36 * fail.w + DESK_X.codex + 1]).toBe(ROOM.red)
  const bay = officeLayout(FIXTURES.failing, 64).desks.find(b => b.provider === 'codex')!
  expect(bay).toBeDefined()
  const narrow = office.frames(FIXTURES.failing, { motion: 'still', width: 64 })[0]!
  expect(narrow.px[(41 + bay.y) * narrow.w + bay.x + 1]).toBe(ROOM.red)
  expect(narrow.px[(68 + bay.y) * narrow.w + bay.x + 2]).toBe(ROOM.desk)
})

for (const surface of ['desktop', 'terminal'] as const) test(`Power-ups group skills and distinguish inherited Force from explicit On (${surface})`, async ($, on) => {
  const f = fixture({ area: 'vibe', tab: 'powerups', scenario: 'crew-and-powers' })
  f.pins.push('skill:ponytail:pinned-check')
  const { state } = setup(on, f)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  expect(await ui.find({ key: 'power:skill:ponytail:ponytail-audit' })).toBeUndefined()
  expect(await ui.find({ key: 'skill:skill:ponytail:ponytail-audit' })).toBeUndefined()
  await ui.press({ key: 'power:fold:plugin:ponytail' })
  expect(await ui.find({ key: 'skill:skill:ponytail:ponytail' })).toBeDefined()
  expect(await ui.find({ key: 'skill:skill:ponytail:ponytail-audit' })).toBeDefined()
  expect(await ui.find({ key: 'skill:skill:ponytail:pinned-check' })).toBeDefined()
  expect(await ui.find({ key: 'power:tool:mcp__antigravity__gemini_visual_qa' })).toBeDefined()
  expect((await ui.find({ key: 'mode:skill:ponytail:ponytail-audit:force' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ key: 'mode:skill:ponytail:ponytail-audit:force' }))?.props.variant).not.toBe('primary')
  expect((await ui.find({ key: 'mode:skill:ponytail:ponytail-audit:force' }))?.text).toContain('↳Force')
  expect((await ui.find({ key: 'skill:skill:ponytail:ponytail-audit' }))?.text).toContain('same as plugin')
  await ui.press({ key: 'mode:skill:ponytail:ponytail-audit:on' })
  expect(state.toggles!['skill:ponytail:ponytail-audit']).toBe('on')
  expect((await ui.find({ key: 'mode:skill:ponytail:ponytail-audit:force' }))?.text).not.toContain('○')
  expect((await ui.find({ key: 'skill:skill:ponytail:ponytail-audit' }))?.text).not.toContain('same as plugin')
  expect(state.toggles!['plugin:ponytail']).toBe('force')
  expect(state.vibe!.events?.slice(-1)[0]).toMatchObject({ kind: 'powerup', key: 'skill:ponytail:ponytail-audit', mode: 'on' })
  await ui.unmount()
})

test('empty decisions omit filters and a high decision toast uses the high impact glyph', async ($, on) => {
  const { state } = setup(on, { decisions: [] })
  state.ui!.vibeTab = 'decisions'
  let toast = ''
  on('ui.toast', (_$, e) => { toast = e.text; return { value: undefined } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props })
  expect(await ui.find({ key: 'vfilter:all' })).toBeUndefined()
  await ($.tool as any).call({ tool: 'mcp__agent-overview__decision_log', tool_use_id: 'high', decision: 'Keep the build red', why: 'Tests fail', impact: 'high' })
  expect(toast).toBe('▲ Keep the build red')
  await ui.redraw()
  expect((await ui.find({ key: 'vdec:open:100000:0' }))?.text).toBe('▸')
  await ui.unmount()
})

test('each mode and every Work stage has the owner contract and Default has no mode text', () => {
  expect(workText('overview', advance(freshStage(), 'review'), { grill: true })).toBe('')
  const plan = workText('work', freshStage(), { grill: true })
  for (const text of ['Work mode — stage: Plan', 'No code changes', 'do not write files in Plan', 'qa_log', 'decision_log', 'Never advance', 'supermatt:grilling']) expect(plan).toContain(text)
  const pending = workText('work', advance(freshStage(), 'implement'), { grill: true })
  expect(pending).toContain('Wait. The owner picks agents and presses Launch; do not start building.')
  const implement = workText('work', advance(freshStage(), 'implement'), { grill: true }, { launchedAt: 1 })
  expect(implement).toContain('Implementation launched; finish it, say "ready for review".')
  for (const text of ['Q&A', 'priority order', 'codex exec', 'Implement the plan']) {
    expect(pending).not.toContain(text); expect(implement).not.toContain(text)
  }
  const review = workText('work', advance(freshStage(), 'review'), { grill: true })
  for (const text of ['Work mode — stage: Review', 'Read-only', 'only when the owner launches', 'review_log', 'Fix selected']) expect(review).toContain(text)
  const ship = workText('work', advance(freshStage(), 'ship'), { grill: true })
  for (const text of ['Work mode — stage: Ship', 'owner presses', 'before push', 'before opening a PR', 'yes first']) expect(ship).toContain(text)
  const vibe = workText('vibe', advance(freshStage(), 'review'), { grill: true })
  for (const text of ['Vibe mode', 'Long-running autonomous', 'routine choices yourself', 'decision_log', 'each turn', 'QA logging is suppressed', 'No stages, no grilling']) expect(vibe).toContain(text)
  expect(vibe).not.toContain('Work mode')
})

test('Review guard refuses all plan writers but permits reads; Default and Vibe have no stage guard', async ($, on) => {
  const { state, store } = setup(on, { stage: advance(freshStage(), 'review') })
  on('tool.call', () => ({ result: 'ok' }))
  let n = 0
  for (const area of ['work', 'overview', 'vibe'] as Area[]) {
    state.ui!.area = area
    for (const input of [{ tool: 'Edit' }, { tool: 'Write' }, { tool: 'MultiEdit' }, { tool: 'NotebookEdit' }, { tool: 'Bash', command: 'echo x > src/a.ts' }, { tool: 'Bash', command: 'git commit -am fix' }]) {
      expect((await ($.tool as any).call({ ...input, tool_use_id: `guard:${n++}` })).deny).toBe(area === 'work' ? REVIEW_LOCK : undefined)
    }
    for (const input of [{ tool: 'Read' }, { tool: 'Grep' }, { tool: 'Bash', command: 'git diff' }]) expect(stageDeny(area, state.stage!, input)).toBeUndefined()
  }
})

test('composition replaces stale mode sections, retains owner settings and Vibe suppresses both QA tools', async ($, on) => {
  const { state } = setup(on, { stage: advance(freshStage(), 'review'), grill: [] })
  on('prompt.compose', () => ({ sections: [{ id: 'agent-overview:work', text: 'stale Plan', scope: 'session' }, { id: 'owner', text: 'keep me', scope: 'session' }] }))
  on('tool.describe', () => ({ description: 'QA' }))
  const compose = () => $.prompt.compose({ model: 'claude', promptModel: 'claude', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  for (const area of ['work', 'vibe', 'overview'] as Area[]) {
    state.ui!.area = area
    const sections = (await compose()).sections
    expect(sections.filter(s => /^agent-overview:(work|vibe|mode)$/.test(s.id)).length).toBe(area === 'overview' ? 0 : 1)
    expect(sections.some(s => s.text.includes('stale Plan'))).toBe(false)
    expect(sections.find(s => s.id === 'owner')?.text).toBe('keep me')
    expect(sections.find(s => s.id === 'agent-overview:routing')).toBeDefined()
  }
  state.ui!.area = 'vibe'
  for (const tool of ['qa_log', 'grill_log']) {
    const name = `mcp__agent-overview__${tool}`
    expect((await ($.tool as any).describe({ tool: name, description: 'QA', provider: { plugin: 'agent-overview', tier: 'user' } })).description).toContain('suppressed')
    await ($.tool as any).call({ tool: name, tool_use_id: name, question: 'Routine?', answer: 'Decide' })
  }
  expect(state.grill).toEqual([])
  await ($.tool as any).call({ tool: 'mcp__agent-overview__decision_log', tool_use_id: 'choice', decision: 'Reuse routing', why: 'One source', impact: 'medium' })
  expect(state.vibe!.events?.slice(-1)[0]!.kind).toBe('decision')
})

for (const surface of ['desktop', 'terminal'] as const) test(`Crew hand-off, undo, expiry, provider, tag and priority edits share routing and emit events (${surface})`, async ($, on) => {
  const { state, clock, store } = setup(on, { main: { model: 'claude-opus-5-5' } })
  state.providers!.claude.models = [{ id: 'opus' }]
  const before = state.routing!
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  expect((await ui.find({ key: 'crew:claude' }))?.text).toContain('◆ Chat opus-5-5')
  expect(await ui.find({ type: 'Text', text: 'Subagents' })).toBeDefined()
  expect(await ui.find({ key: 'crew:model:claude/opus' })).toBeDefined()
  expect((await ui.find({ key: 'crew:codex' }))?.text).toContain(`#${before.order.indexOf('codex') + 1} in order`)
  expect(await ui.find({ key: 'crew:handoff' }), JSON.stringify(await ui.drawn())).toBeDefined()
  await ui.press({ key: 'crew:handoff' })
  expect(tagOf(state.routing!, 'claude')).toBe('saver'); expect(tagOf(state.routing!, 'codex')).toBe('main')
  expect(state.vibe!.events?.slice(-1)[0]).toMatchObject({ kind: 'handoff', provider: 'codex' })
  expect(store['routing:mode-test']).toEqual(state.routing)
  const undo = state.ui!.vibeUndo
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'crew:handoff' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Codex is main/ })).toBeDefined()
  expect(state.ui!.vibeUndo).toEqual(undo)
  await ui.press({ key: 'crew:undo' }); expect(state.routing).toEqual(before)
  await ui.press({ key: 'crew:handoff' }); await clock.advance(30000); await ui.redraw()
  expect(await ui.find({ key: 'crew:undo' })).toBeUndefined(); expect(tagOf(state.routing!, 'codex')).toBe('main')
  expect(await ui.find({ key: 'crew:on:claude' })).toBeUndefined()
  for (const p of ['codex']) { await ui.press({ key: `crew:on:${p}` }); expect(state.routing!.on[p as 'claude' | 'codex']).toBe(false); await ui.press({ key: `crew:on:${p}` }) }
  await ui.select({ key: 'crew:tag:codex', value: 'saver' })
  await ui.press({ key: 'crew:up:codex' })
  await ui.select({ key: 'crew:model:codex/gpt', value: 'backup' })
  expect(state.routing!.picks.filter(p => p.provider === 'codex').map(p => p.model)).toEqual(['backup'])
  for (const kind of ['provider-off', 'provider-on', 'tag', 'priority']) expect(state.vibe!.events?.some(e => e.kind === kind)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^panel error:/ })).toBeUndefined()
  await ui.unmount()
})

test('hand-off skips unavailable, off, exhausted, paused, visual-only and over-cap providers', () => {
  const ps = { claude: blank(), codex: { ...blank(), status: 'ok' as const }, opencode: { ...blank(), status: 'ok' as const }, commandcode: blank(), antigravity: { ...blank(), status: 'ok' as const }, ollama: blank() }
  const r = normalRouting(withPicks(defaultRouting(), [{ provider: 'antigravity', model: 'gemini' }, { provider: 'codex', model: 'gpt' }, { provider: 'opencode', model: 'deepseek' }]))
  expect(handoff(r, ps)?.provider).toBe('codex')
  expect(handoff(r, ps, ['codex'])?.provider).toBe('opencode')
  expect(handoff({ ...r, on: { ...r.on, codex: false } }, ps)?.provider).toBe('opencode')
  expect(handoff({ ...r, paused: { codex: { at: 0, until: 1000000, why: 'quota' } } }, ps)?.provider).toBe('opencode')
  expect(handoff(r, { ...ps, codex: { ...ps.codex, meters: [{ label: 'Week', percent: 100 }] } })?.provider).toBe('opencode')
  expect(handoff(r, { ...ps, codex: { ...ps.codex, status: 'missing' } }, ['opencode'])).toBeUndefined()
})

for (const surface of ['desktop', 'terminal'] as const) test(`Power-ups explicitly set inherited toggles, invalidate prompts and log owner actions (${surface})`, async ($, on) => {
  const { state } = setup(on, { pins: ['plugin:ponytail'] })
  state.ui!.vibeTab = 'powerups'
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  expect(await ui.find({ key: 'mode:plugin:ponytail:off' })).toBeDefined()
  const key = 'plugin:ponytail'
  for (const mode of ['force', 'off', 'on']) {
    await ui.press({ key: `mode:${key}:${mode}` })
    expect(state.toggles![key]).toBe(mode)
    expect(toggleMode(state.toggles!, 'skill:ponytail:ponytail')).toBe(mode)
    expect(state.vibe!.events?.slice(-1)[0]).toMatchObject({ kind: 'powerup', key, mode })
  }
  await ui.press({ key: 'power:force:feature:codex-images' })
  expect(state.vibe!.events?.slice(-1)[0]).toMatchObject({ kind: 'powerup', key: 'feature:codex-images', mode: 'force' })
  expect(cyclePowerup('on')).toBe('force'); expect(cyclePowerup('force')).toBe('off'); expect(cyclePowerup('off')).toBe('on')
  await ui.unmount()
})

test('every owner event changes both scene keys and pixels only during the reaction window', () => {
  const events: Omit<VibeEvent, 'at'>[] = [{ kind: 'provider-off', provider: 'codex' }, { kind: 'provider-on', provider: 'codex' }, { kind: 'tag', provider: 'codex', tag: 'main' }, { kind: 'tag', provider: 'claude', tag: 'saver' }, { kind: 'priority' }, { kind: 'handoff', provider: 'codex' }, { kind: 'powerup', key: 'plugin:ponytail' }, { kind: 'decision' }]
  for (const scene of Object.values(SCENES)) for (const event of events) {
    const base = { ...FIXTURES.busy, events: [] }, d = { ...base, events: [{ ...event, at: base.now }] }
    expect(sceneKey(d, scene)).not.toBe(sceneKey(base, scene))
    const first = scene.frames(d, { motion: 'full' }), plain = scene.frames(base, { motion: 'full' })
    expect(first.some((f, i) => f.px.some((p, n) => p !== plain[i]!.px[n]))).toBe(true)
    expect(sceneKey({ ...d, now: base.now + REACTION_MS }, scene)).toBe(sceneKey({ ...base, now: base.now + REACTION_MS }, scene))
  }
  expect(activeEvents([{ kind: 'decision', at: 101 }], 100)).toEqual([])
})

test('stage resumes across mode switches and per-chat saves survive reload without leaking into another chat', async ($, on) => {
  let id = 'first'
  const { state, store } = setup(on, { stage: advance(freshStage(), 'review') }, () => id)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props })
  await ui.press({ key: 'area:work' }); await ui.press({ key: 'area:confirm' })
  expect(state.stage!.at).toBe('review')
  await ui.press({ key: 'area:overview' }); await ui.press({ key: 'area:confirm' })
  expect(state.stage!.at).toBe('review')
  expect(store['mode:first']).toMatchObject({ area: 'overview', stage: { at: 'review' } })
  id = 'second'
  store['mode:second'] = { area: 'vibe', stage: freshStage() }
  const api = { session: { id: async () => id }, store: { get: async (key: string) => store[key], set: async (key: string, value: unknown) => { store[key] = value } }, state: { get: async (ref: { key: keyof State }) => ({ value: state[ref.key], version: 0 }), set: async (ref: { key: keyof State }, value: unknown) => { Object.assign(state, { [ref.key]: value }); return { isSet: true, version: 1 } } } } as unknown as EngineInterface
  await restoreMode(api); expect(state.ui!.area).toBe('vibe'); expect(state.stage!.at).toBe('plan')
  id = 'first'; await restoreMode(api); expect(state.ui!.area).toBe('overview'); expect(state.stage!.at).toBe('review')
  id = 'third'; await restoreMode(api); expect(state.ui!.area).toBe('overview'); expect(state.stage).toBe(null)
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const) test(`decision notes with matching timestamps remain distinct and expand their reasons (${surface})`, async ($, on) => {
  const { state } = setup(on, { decisions: [{ at: 100000, decision: 'First choice', why: 'First reason', impact: 'high' }, { at: 100000, decision: 'Second choice', why: 'Second reason', impact: 'low' }] })
  state.ui!.vibeTab = 'decisions'
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
  expect((await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('vdec:'))).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: 'First reason' })).toBeUndefined()
  await ui.press({ key: 'vdec:open:100000:0' })
  expect(await ui.find({ type: 'Text', text: 'First reason' })).toBeDefined()
  await ui.press({ key: 'vfilter:high' })
  expect(await ui.find({ type: 'Text', text: 'First reason' })).toBeDefined()
  await ui.unmount()
})

test('arcade hand-off keeps one dim Claude carrier in the fleet', () => {
  const d = { ...FIXTURES.busy, usage: FIXTURES.busy.usage.map(u => ({ ...u, tag: u.provider === 'claude' ? 'saver' as const : u.tag })), events: [{ kind: 'handoff' as const, provider: 'codex' as const, at: FIXTURES.busy.now }] }
  const carrier = arcadePlan(d).ships.find(s => s.provider === 'claude')!
  const frame = arcade.frames(d, { motion: 'still' })[0]!
  expect(frame.px.includes(C.lightGrey)).toBe(true)
  expect([...frame.px].filter(c => c === C.lightGrey).length).toBe(carrier.rows.join('').split('#').length - 1)
  expect(carrier.y + carrier.h).toBeLessThan(78)
})

test('Crew quota arrows preserve interleaved model ranks and disable both ends', async ($, on) => {
  const { state } = setup(on)
  state.routing!.order = ['codex', 'opencode', 'antigravity', 'commandcode']
  state.routing!.picks = [{ provider: 'claude', model: 'opus' }, { provider: 'codex', model: 'gpt' }, { provider: 'claude', model: 'haiku' }]
  const ranked = JSON.stringify(state.routing!.picks)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props })
  expect(await ui.find({ type: 'Button', key: 'crew:up:codex' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'crew:down:commandcode' })).toBeUndefined()
  await ui.press({ key: 'crew:down:codex' })
  expect(state.routing!.order).toEqual(['opencode', 'codex', 'antigravity', 'commandcode', 'ollama'])
  expect(JSON.stringify(state.routing!.picks)).toBe(ranked)
  await ui.unmount()
})

test('hand-off preserves planning and prefers Normal over Saver, with Saver as the last fallback', () => {
  const ps = { claude: blank(), codex: { ...blank(), status: 'ok' as const }, opencode: { ...blank(), status: 'ok' as const }, antigravity: blank(), commandcode: blank(), ollama: blank() }
  const r = normalRouting({ ...defaultRouting(), role: 'plan', picks: [{ provider: 'codex', model: 'gpt' }, { provider: 'opencode', model: 'deepseek' }], tags: { codex: 'saver' } })
  expect(handoff(r, ps)?.provider).toBe('opencode')
  expect(handoff(r, ps)?.routing.role).toBe('plan')
  expect(handoff(r, ps, ['opencode'])?.provider).toBe('codex')
})

test('reaction captions name the provider and distinguish all tag changes', () => {
  expect(eventLabel({ kind: 'tag', provider: 'codex', tag: 'main', at: 0 })).toBe('Codex is main')
  expect(eventLabel({ kind: 'tag', provider: 'claude', tag: 'saver', at: 0 })).toBe('Claude on saver')
  expect(eventLabel({ kind: 'tag', provider: 'codex', tag: 'normal', at: 0 })).toBe('Codex back to normal')
  expect(eventLabel({ kind: 'provider-off', provider: 'codex', at: 0 })).toBe('Codex off')
  expect(eventLabel({ kind: 'powerup', key: 'plugin:ponytail', mode: 'force', at: 0 })).toBe('Ponytail forced')
  expect(powerLabel('skill:ponytail:ponytail-audit')).toBe('Ponytail-audit')
  expect(powerLabel('tool:mcp__antigravity__gemini_visual_qa')).toBe('Antigravity · Visual QA')
})

test('terminal hand-off shows one travelling crown before it reaches the new main', () => {
  const d = { ...FIXTURES.busy, usage: FIXTURES.busy.usage.map(u => ({ ...u, tag: u.provider === 'claude' ? 'saver' as const : u.tag })), events: [{ kind: 'handoff' as const, provider: 'codex' as const, at: FIXTURES.busy.now }] }
  const c = SCENES.office.frames(d, { motion: 'still', width: 100 })[0]!
  const crownAt = (x: number, y: number) => Array.from({ length: 5 }, (_, dx) => c.px[(y + 1) * c.w + x + dx]).every(color => color === ROOM.gold)
  expect(crownAt(33, 8)).toBe(false)
  expect(crownAt(17, 7)).toBe(true)
})
