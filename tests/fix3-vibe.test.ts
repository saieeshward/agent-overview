import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { fixture, NOW } from '../tools/pane-fixtures'
import { agentHud, office, officeLayout } from '../hooks/vibe/office'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { arcade, arcadePlan, arcadeEvent } from '../hooks/vibe/arcade'
import { C, ROOM } from '../hooks/vibe/engine'
import { powerups } from '../hooks/vibe/powerups'
import { vibeData } from '../hooks/vibe/data'

function setup(on: On, state: Record<string, any>) {
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('fs.read', () => ({ value: 'full' }))
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}
const props = (bodyColumns: number) => ({ title: 'Agent panel', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} })

for (const style of ['office', 'arcade'] as const) for (const width of [64, 100, 140]) {
  test(`${style} at ${width} columns keeps five task rows, decisions, usage age and powers within sixty rows`, async ($, on) => {
    const state = fixture({ area: 'vibe', tab: 'live', scenario: `${style}-busy-stale`, busy: true, style })
    state.decisions = state.decisions.map((d: any) => ({ ...d, decision: d.decision.repeat(8) }))
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: props(width) })
    for (const fail of [false, true]) {
      if (fail) {
        state.vibe.lastTest = 'fail'; state.vibe.acts = FIXTURES.failing.acts
        state.vibe.events = [{ kind: 'tag', provider: 'claude', tag: 'saver', at: NOW }, { kind: 'priority', at: NOW }, { kind: 'decision', at: NOW }]
        await ui.redraw()
      }
      const taskRows = (await ui.findAll({ type: 'Text' })).filter(x => /^● (Claude|Codex|OpenCode|Antigravity|Command Code).* · /.test(x.text ?? ''))
      expect(taskRows).toHaveLength(5)
      expect(await ui.find({ key: 'vibe:ticker' })).toBeDefined()
      expect((await ui.find({ key: 'vibe:ticker' }))!.text!.length).toBeLessThanOrEqual(width)
      expect(await ui.find({ type: 'Text', text: /usage .*old/ })).toBeDefined()
      if (width >= 100) expect(await ui.find({ type: 'Text', text: /Codex image generation/ })).toBeDefined()
      expect(Number((await ui.find({ key: 'vibe:scene' }))?.props.rows)).toBeLessThanOrEqual(35)
    }
    await ui.unmount()
  })
}

test('narrow tasks own the line and failed state is an error segment at every width', () => {
  const d = { ...FIXTURES.busy, agents: FIXTURES.busy.agents.map(a => a.provider === 'codex' ? { ...a, state: 'failed' as const, endedAt: NOW - 120000 } : a) }
  for (const w of [49, 64, 100, 140]) {
    const rows = agentHud(d, w), codex = rows.find(row => row.map(s => s.text).join('').includes('Codex'))!
    const failure = codex.find(s => s.text.startsWith('failed'))!
    expect(failure.color).toBe('error')
    expect(failure.text).toContain('Build the pane')
    expect(rows.every(row => row.reduce((n, s) => n + s.text.length, 0) <= w)).toBe(true)
  }
  const narrow = agentHud(FIXTURES.busy, 49).map(row => row.map(s => s.text).join('')).join('\n')
  expect(narrow).toContain('Codex · Build the pane +24 −7')
  expect(narrow).toContain('Antigravity · Inspect the scene')
  expect(narrow).not.toContain('gpt-6.1-sol'); expect(narrow).not.toContain('view.tsx')
  const wide = agentHud(FIXTURES.busy, 100).flat().map(s => s.text).join('')
  expect(wide).toContain('gpt-6.1-sol'); expect(wide).toContain('view.tsx')
  const crowded = { ...FIXTURES.busy, agents: [...FIXTURES.busy.agents, ...FIXTURES.busy.agents.slice(0, 3)] }
  const limited = agentHud(crowded, 49)
  expect(limited).toHaveLength(5)
  expect(limited[4]!.map(s => s.text).join('')).toContain('+3 more')
})

test('failed delegation remains in snapshots until its provider starts another agent', async () => {
  const state = fixture({ area: 'vibe', tab: 'live', scenario: 'office-failure-aged', style: 'office', busy: true })
  const defaults = { live: null, sideLive: null, prices: { catalog: {}, overrides: {} }, turnCosts: [] }
  const api = { clock: { now: async () => NOW }, state: { get: async ({ key }: { key: string }) => ({ value: { ...defaults, ...state }[key], version: 0 }) } } as unknown as EngineInterface
  const failed = state.nodes[0], first = await vibeData(api)
  expect(first.agents.find(a => a.id === failed.id)?.state).toBe('failed')
  state.nodes = [failed, { ...failed, id: 'parallel', state: 'running', startedAt: failed.startedAt + 1, endedAt: undefined }]
  const parallel = await vibeData(api)
  expect(parallel.agents.find(a => a.id === failed.id)?.state).toBe('failed')
  expect(agentHud(parallel, 100).some(row => row.some(s => s.text.startsWith('failed · ') && s.color === 'error'))).toBe(true)
  state.nodes = [failed, ...Array.from({ length: 10 }, (_, i) => ({ ...failed, id: `other-${i}`, provider: 'opencode', state: 'done', startedAt: NOW - 10000, endedAt: NOW - 1000 }))]
  expect((await vibeData(api)).agents.find(a => a.id === failed.id)?.state).toBe('failed')
  for (const nextState of ['running', 'done'] as const) {
    state.nodes = [failed, { ...failed, id: 'retry', state: nextState, startedAt: NOW - 90000, endedAt: NOW - 80000 }]
    const d = await vibeData(api)
    expect(d.agents.some(a => a.id === failed.id)).toBe(false)
  }
})

test('arcade simultaneous markers occupy separate in-field slots and all captions remain visible', () => {
  const events = [{ kind: 'tag' as const, provider: 'claude' as const, tag: 'saver' as const, at: NOW }, { kind: 'priority' as const, at: NOW }, { kind: 'decision' as const, at: NOW }, { kind: 'powerup' as const, at: NOW }]
  const d = { ...FIXTURES.failing, events }
  expect(arcadeEvent(d)).toBe('Claude on saver · Order changed · New decision · Power-up on')
  for (const width of [64, 100, 140]) {
    const p = arcadePlan(d, width), markers = [p.fail!, ...p.markers]
    expect(p.markers).toHaveLength(3)
    for (const [i, a] of markers.entries()) for (const b of markers.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true)
    const frame = arcade.frames(d, { motion: 'still', width })[0]!
    expect(frame.px[p.fail!.y * frame.w + p.fail!.x]).toBe(C.red)
    expect(p.fail!.x <= p.target!.x + p.target!.w / 2 && p.fail!.x + 22 > p.target!.x + p.target!.w / 2).toBe(true)
    for (const maxRows of [30, 32, 35]) {
      const compact = arcade.frames(d, { motion: 'full', width, maxRows })
      expect(new Set(compact.map(c => c.h)).size).toBe(1)
      for (const c of compact) expect(c.h).toBeLessThanOrEqual(maxRows * 2)
    }
  }
})

test('terminal off and on leave every other bay unchanged in every pose', () => {
  for (const kind of ['provider-off', 'provider-on'] as const) for (const width of [64, 100, 140]) {
    const d = { ...FIXTURES.busy, usage: FIXTURES.busy.usage.map(u => u.provider === 'codex' ? { ...u, on: kind === 'provider-on' } : u) }
    const base = office.frames(d, { motion: 'full', width })
    const frames = office.frames({ ...d, events: [{ kind, provider: 'codex', at: NOW }] }, { motion: 'full', width })
    const bay = officeLayout(d, width).desks.find(b => b.provider === 'codex')!
    for (const [i, c] of frames.entries()) expect(c.px.every((color, at) => {
      const x = at % c.w, y = Math.floor(at / c.w)
      return x >= bay.x && x < bay.x + bay.w && y >= bay.y + 34 && y < bay.y + 72 || color === base[i]!.px[at]
    })).toBe(true)
    expect(frames[0]!.px[(64 + bay.y) * width + bay.x + 2]).toBe(ROOM.light)
  }
})

test('a short office keeps all five mascots and both complete rows of desk legs', () => {
  const c = office.frames(FIXTURES.busy, { motion: 'still', width: 64, maxRows: 30 })[0]!
  expect(c.h).toBe(60)
  for (const [i, bay] of officeLayout(FIXTURES.busy, 64).desks.entries()) {
    const bottom = i < 3 ? 29 : 59
    expect(c.px[bottom * c.w + bay.x + 2]).toBe(ROOM.desk)
  }
})

test('Powers uses pins, ignores disabled plugins and hides unnamed connector IDs', () => {
  const s = fixture({ area: 'vibe', tab: 'powerups', scenario: 'real-inventory' })
  const keys = powerups(s.installed, [...s.pins, 'server:1a59c906-04da-521d-baad-123456789abc'])
  expect(keys).toEqual(['feature:codex-images', 'plugin:ponytail', 'tool:mcp__antigravity__gemini_visual_qa', 'plugin:supermatt'])
  expect(powerups(s.installed, [])).toEqual(['feature:codex-images'])
})

for (const surface of ['desktop', 'terminal'] as const) test(`Powers folds real inventories and servers expose counts only (${surface})`, async ($, on) => {
  const s = fixture({ area: 'vibe', tab: 'powerups', scenario: 'real-inventory' })
  s.pins.push('server:claude_browser')
  setup(on, s)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(84) })
  expect(await ui.find({ key: 'power:fold:plugin:supermatt' })).toBeDefined()
  expect((await ui.find({ key: 'power:fold:plugin:supermatt' }))?.text).toContain('13 skills')
  expect(await ui.find({ key: 'skill:skill:supermatt:grilling' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '19 tools' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Tool 1' })).toBeUndefined()
  expect(await ui.find({ key: 'power:plugin:disabled-plugin' })).toBeUndefined()
  await ui.press({ key: 'power:fold:plugin:supermatt' })
  expect(await ui.find({ key: 'skill:skill:supermatt:grilling' })).toBeDefined()
  await ui.press({ key: 'power:fold:plugin:supermatt' })
  expect(await ui.find({ key: 'skill:skill:supermatt:grilling' })).toBeUndefined()
  await ui.unmount()
})

for (const area of ['overview', 'vibe'] as const) for (const surface of ['desktop', 'terminal'] as const) test(`skill overrides return to inheritance in ${area} (${surface})`, async ($, on) => {
  const s = fixture({ area, tab: area === 'vibe' ? 'powerups' : 'plugins', scenario: 'skill-override', expanded: true })
  const key = 'skill:ponytail:ponytail-audit'
  s.ui.folded = { ...s.ui.folded, 'pl:ponytail': false }
  setup(on, s)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(84) })
  expect(s.toggles[key]).toBe('on')
  expect((await ui.find({ key: `mode:${key}:on` }))?.props.dimColor).toBe(false)
  await ui.press({ key: `mode:${key}:force` })
  expect(Object.hasOwn(s.toggles, key)).toBe(false)
  expect((await ui.find({ key: `mode:${key}:force` }))?.props.dimColor).toBe(true)
  expect((await ui.find({ key: `mode:${key}:force` }))?.text).not.toContain('○')
  // Following remains live when the plugin changes later.
  await ui.press({ key: 'mode:plugin:ponytail:off' })
  expect((await ui.find({ key: `mode:${key}:off` }))?.props.dimColor).toBe(true)
  expect(s.toggles['plugin:ponytail']).toBe('off')
  await ui.unmount()
})

