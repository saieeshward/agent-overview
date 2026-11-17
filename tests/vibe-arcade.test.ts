import { expect, mock, test } from 'claude-code/testing'
import type { Provider, Ui } from '../types'
import { normalGuard } from '../hooks/state'
import { arcade, arcadePlan, bunkerRows, SHIPS, SHIP_TINT } from '../hooks/vibe/arcade'
import { C, CAST, FPS, PALETTE, SVG_MAX, TERMINAL_DEFAULT, toCells, toSvg } from '../hooks/vibe/engine'
import type { Canvas, VibeData } from '../hooks/vibe/engine'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { FIXTURES as LEGACY } from './arcade-fixtures'

const busy = FIXTURES.busy
const region = (c: Canvas, x: number, y: number, w: number, h: number) => Array.from({ length: h }, (_, row) => [...c.px.slice((y + row) * c.w + x, (y + row) * c.w + x + w)]).flat()
const hudText = (d: VibeData, w = 128) => { const h = arcade.hud!(d, w); return [...h.top, ...h.bottom].map(l => l.map(s => s.text).join('')).join('\n') }

for (const [name, d] of [...Object.entries(FIXTURES), ...Object.entries(LEGACY)]) for (const motion of ['full', 'calm', 'still'] as const) {
  test(`arcade ${name} ${motion} is deterministic, fleet-tinted, immutable and within the SVG budget`, () => {
    const before = JSON.stringify(d), frames = arcade.frames(d, { motion }), again = arcade.frames(d, { motion })
    expect(frames.length).toBeGreaterThanOrEqual(motion === 'still' ? 1 : 2)
    expect(frames.length).toBeLessThanOrEqual(motion === 'still' ? 1 : 12)
    frames.forEach((c, i) => {
      expect([c.w, c.h, c.px.length]).toEqual([128, 82, 10496])
      expect([...c.px]).toEqual([...again[i]!.px])
      expect(c.px.every(p => [C.PAPER, C.INK, C.darkGrey, C.lightGrey, C.red, ...Object.values(SHIP_TINT)].includes(p))).toBe(true)
      expect(c.px.includes(C.INK)).toBe(true)
    })
    expect(JSON.stringify(d)).toBe(before)
    const svg = toSvg(frames, { fps: FPS[motion], hotspots: arcade.hotspots?.(d) })
    expect(svg.length).toBeLessThanOrEqual(SVG_MAX)
    expect((svg.match(/<animate /g) || []).length).toBe(frames.length - 1)
    expect(svg).toContain('prefers-color-scheme:light')
    expect(svg).toContain('.ink{fill:#E6E6E6}.paper{fill:#0B0B0B}')
    expect(svg).toContain('.ink{fill:#111111}.paper{fill:#FAFAFA}')
    if (motion === 'still') expect([...frames[0]!.px]).toEqual([...arcade.frames(d, { motion: 'full' })[0]!.px])
    for (const columns of [64, 100, 128]) {
      const cells = toCells(frames[0]!, columns, arcade.focus?.(d)), bytes = Uint8Array.from(atob(cells.cells), ch => ch.charCodeAt(0)), view = new DataView(bytes.buffer)
      for (let n = 0; n < cells.columns * cells.rows; n++) {
        expect([0x20, 0x2580, 0x2584, 0x2588]).toContain(view.getUint32(n * 12, true))
        for (const at of [4, 8]) expect([TERMINAL_DEFAULT, PALETTE[C.darkGrey], PALETTE[C.lightGrey], PALETTE[C.red], ...Object.values(SHIP_TINT).map(i => PALETTE[i])]).toContain(view.getUint32(n * 12 + at, true))
      }
    }
  })
}

test('each provider keeps its exact distinct shape and Main uses an underline', () => {
  expect(new Set(Object.values(SHIPS).map(r => r.join('\n'))).size).toBe(5)
  for (const p of Object.keys(SHIPS) as Provider[]) {
    const a = busy.agents.find(a => a.provider === p)!
    const regular = arcadePlan({ ...busy, main: { ...busy.main, working: false }, agents: [a], usage: busy.usage.map(u => ({ ...u, on: u.provider === p, tag: 'normal' as const })) }).ships.find(s => s.provider === p)!
    const main = arcadePlan({ ...busy, main: { ...busy.main, working: false }, agents: [a], usage: busy.usage.map(u => ({ ...u, on: u.provider === p, tag: u.provider === p ? 'main' as const : 'normal' as const })) }).ships.find(s => s.provider === p)!
    expect(main.rows).toEqual(SHIPS[p]); expect(main.w).toBe(regular.w); expect(main.flagship).toBe(true)
  }
})

test('formation has up to three six-invader rows; idle and Saver ships stay docked', () => {
  expect(arcadePlan(busy).rows).toHaveLength(3)
  expect(arcadePlan({ ...busy, agents: busy.agents.slice(0, 1) }).rows).toHaveLength(1)
  const saver = { ...busy, agents: [], usage: busy.usage.map(u => ({ ...u, tag: 'saver' as const })) }
  expect(arcadePlan(saver).ships).toHaveLength(5)
  expect(arcadePlan(saver).ships.every(s => !s.working && s.parked)).toBe(true)
  const called = { ...saver, agents: [busy.agents[0]!] }
  expect(arcadePlan(called).ships.some(s => s.provider === 'codex')).toBe(true)
  const idle = arcadePlan(FIXTURES.idle)
  expect(idle.attract).toBe(true); expect(idle.ships).toHaveLength(5); expect(idle.rows).toHaveLength(3)
  expect(idle.ships.every(s => !s.working)).toBe(true)
})

test('bunkers erode monotonically from whole at zero context to mostly gone at ninety percent', () => {
  const counts = [0, 30, 60, 90].map(ctx => {
    const c = arcade.frames({ ...busy, ctx, edit: null }, { motion: 'still' })[0]!
    return region(c, 0, 58, 128, 7).filter(p => p === C.INK).length
  })
  for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThan(counts[i - 1]!)
  expect(counts[3]!).toBeLessThan(counts[0]! / 3)
})

test('review boss and bounded HP bar appear only while findings are open', () => {
  const noBoss = arcade.frames({ ...busy, findings: 0 }, { motion: 'still' })[0]!, boss = arcade.frames(FIXTURES.review, { motion: 'still' })[0]!
  expect(region(noBoss, 0, 0, 128, 14).every(p => p === C.PAPER)).toBe(true)
  expect(region(boss, 56, 3, 17, 7)).toContain(C.INK)
  expect(region(boss, 56, 12, 17, 1).filter(p => p === C.INK)).toHaveLength(7)
  expect(arcade.hotspots!(FIXTURES.review).some(h => h.title === '7 review findings')).toBe(true)
})

test('edit shots and bursts are one effect; failures keep a red target visible in every frame', () => {
  const frames = arcade.frames(busy, { motion: 'full' }), clear = arcade.frames({ ...busy, edit: null }, { motion: 'full' })
  expect([...frames[0]!.px]).not.toEqual([...clear[0]!.px])
  expect([...frames[8]!.px]).not.toEqual([...clear[8]!.px])
  const failed = arcade.frames(FIXTURES.failing, { motion: 'full' }), target = arcadePlan(FIXTURES.failing).target!
  expect(target.provider).toBe('codex')
  for (let f = 0; f < failed.length; f++) expect(region(failed[f]!, target.x, target.y, target.w, target.h).includes(C.red)).toBe(true)
})

test('HUD carries score, one bold event, named quota lives and speed with only provider names coloured', () => {
  expect(hudText(busy)).toContain('1UP 00128   HI 00164   CREDIT $2.35   LV 2')
  expect(hudText(busy)).toContain('STAGE CLEAR  +128')
  expect(hudText(busy)).toContain('CODEX ▮▮▯▯')
  expect(hudText(busy)).toContain('85 t/s · ctx 46%')
  expect(hudText(FIXTURES.failing)).toContain('COMBO BREAKER')
  expect(hudText(FIXTURES.quota)).toContain('PLAYER 2 HAS ENTERED')
  expect(hudText({ ...FIXTURES.quota, agents: busy.agents.map(a => ({ ...a, startedAt: busy.now - 20000 })) })).toContain('CONTINUE? 9')
  expect(hudText(FIXTURES.review)).toContain('SAVE STATE')
  expect(hudText(FIXTURES.idle)).toContain('PRESS START')
  expect(hudText({ ...busy, tests: null, agents: busy.agents.map(a => ({ ...a, startedAt: busy.now - 20000 })) })).toContain('COMBO ×14')
  expect(hudText({ ...busy, tests: null, agents: [{ ...busy.agents[0]!, startedAt: busy.now - 1000 }] })).toContain('LAUNCH  Codex · gpt-6.1-sol')
  for (const w of [64, 100, 128]) {
    const hud = arcade.hud!(busy, w)
    expect(hud.bottom[0]![0]!.bold).toBe(true)
    expect(hud.bottom.filter(row => row.some(s => s.bold))).toHaveLength(1)
    for (const row of [...hud.top, ...hud.bottom]) {
      for (const segment of row.filter(s => s.color)) {
        const p = (Object.keys(CAST) as Provider[]).find(p => segment.text === ({ claude: 'CLAUDE', codex: 'CODEX', antigravity: 'ANTIGRAVITY', opencode: 'OPENCODE', commandcode: 'COMMAND CODE' })[p])!
        expect(p).toBeDefined(); expect(segment.color).toBe(`#${PALETTE[CAST[p]]!.toString(16)}`)
      }
      expect(row.map(s => s.text).join('').length).toBeLessThanOrEqual(w)
    }
  }
})

test('labels, dollars and stats affect HUD text without drawing scene lettering', () => {
  const renamed = { ...busy, cost: 99, lines: 999, best: 9999, tps: 3, combo: 99, main: { ...busy.main, model: 'Different' }, agents: busy.agents.map(a => ({ ...a, label: 'Changed title', model: 'other' })), edit: { ...busy.edit!, file: 'other.rs', added: 1234, removed: 84 } }
  expect(arcade.frames(renamed, { motion: 'full' }).map(c => [...c.px])).toEqual(arcade.frames(busy, { motion: 'full' }).map(c => [...c.px]))
  expect(hudText(renamed)).not.toBe(hudText(busy))
})

test('provider fleet, formations and hotspots stay bounded and separated', () => {
  const d = { ...busy, agents: Array.from({ length: 8 }, (_, i) => ({ ...busy.agents[i % 5]!, id: `a${i}` })) }, p = arcadePlan(d)
  expect(p.ships).toHaveLength(5); expect(p.hidden).toBe(0)
  p.ships.forEach((s, i) => {
    expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x + s.w).toBeLessThanOrEqual(128)
    if (i) expect(s.x).toBeGreaterThanOrEqual(p.ships[i - 1]!.x + p.ships[i - 1]!.w)
  })
  for (const h of arcade.hotspots!(d)) {
    expect(h.x).toBeGreaterThanOrEqual(0); expect(h.y).toBeGreaterThanOrEqual(0)
    expect(h.x + h.w).toBeLessThanOrEqual(128); expect(h.y + h.h).toBeLessThanOrEqual(82)
  }
})

test('repeated runs share their provider ship and leave every idle provider present', () => {
  const d = { ...busy, agents: Array.from({ length: 8 }, (_, i) => ({ ...busy.agents[0]!, id: `codex-${i}` })) }
  const ships = arcadePlan(d).ships
  expect(ships.length + arcadePlan(d).hidden).toBe(5)
  expect(ships.some(s => s.provider === 'claude')).toBe(true)
  ships.forEach((s, i) => {
    expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x + s.w).toBeLessThanOrEqual(128)
    if (i) expect(s.x).toBeGreaterThanOrEqual(ships[i - 1]!.x + ships[i - 1]!.w)
  })
})

for (const surface of ['terminal', 'desktop'] as const) test(`arcade native HUD and art render on ${surface}`, async ($, on) => {
  mock.clock(on); mock.store(on)
  const state: Ui = { tab: 'dashboard', pick: 'claude', area: 'vibe', vibeTab: 'live', vibeStyle: 'arcade' }
  on('state.get', { plugin: 'agent-overview', key: 'ui' }, () => ({ value: { value: state, version: 0 } }))
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: normalGuard({ vibe: { styles: ['arcade'], motion: 'full' } }), version: 0 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
    title: 'Overview', isFocused: true, bodyColumns: 128, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {},
  } })
  expect(await ui.find({ type: 'Text', text: /0 t\/s/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /context/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Agent Arcade/ })).toBeDefined()
  if (surface === 'terminal') expect(await ui.find({ type: 'Raster' })).toBeDefined()
  else expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('prefers-color-scheme')
  expect(await ui.find({ key: 'vibe:pop' })).toBeUndefined()
  await ui.unmount()
})

for (const provider of Object.keys(SHIPS) as Provider[]) test(`${provider} ship uses its exact tint and the rest of the scene stays monochrome`, () => {
  const a = busy.agents.find(a => a.provider === provider)!
  const d = { ...busy, main: { ...busy.main, working: false }, agents: [a], edit: null, usage: busy.usage.map(u => ({ ...u, on: u.provider === provider, tag: 'normal' as const })) }
  const ship = arcadePlan(d).ships.find(s => s.provider === provider)!, c = arcade.frames(d, { motion: 'still' })[0]!
  const tints = { claude: 0xD97757, codex: 0x10A37F, antigravity: 0x4C8DF6, opencode: 0x8B5CF6, commandcode: 0xE0A030 }
  expect(PALETTE[CAST[provider]]).toBe(tints[provider])
  ship.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '#') expect(c.px[(ship.y + y) * c.w + ship.x + x]).toBe(SHIP_TINT[provider])
  }))
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (x >= ship.x && x < ship.x + ship.w && (y >= ship.y && y < ship.y + ship.h || y === 79 && ship.flagship)) continue
    expect([C.INK, C.PAPER, SHIP_TINT.claude]).toContain(c.px[y * c.w + x])
  }
})

test('100-column arcade crop contains every fleet ship and both formation edges in every pose', () => {
  const crowded = { ...busy, agents: Array.from({ length: 8 }, (_, i) => ({ ...busy.agents[i % 5]!, id: `a${i}` })) }
  for (const d of [busy, crowded]) for (const c of arcade.frames({ ...d, edit: null }, { motion: 'full', width: 100 })) {
    const focus = arcade.focus!(d, { width: 100 }), left = focus.x + focus.w / 2 - 50, right = left + 100
    for (const ship of arcadePlan(d, 100).ships) { expect(ship.x).toBeGreaterThanOrEqual(left); expect(ship.x + ship.w).toBeLessThanOrEqual(right) }
    for (let y = 19; y < 47; y++) for (const x of [left - 1, right]) expect(c.px[y * c.w + x]).toBe(C.PAPER)
    expect(toCells(c, 100, focus).columns).toBe(100)
    const score = arcade.hud!(d, 100).top.map(row => row.map(s => s.text).join('')).join(' ')
    expect(score).toContain('1UP 00128'); expect(score).toContain('HI 00164')
  }
})

test('bunkers have a flat canopy, a bottom notch and deterministic scattered top-down erosion', () => {
  for (const seed of [10, 40, 70, 100]) {
    const whole = bunkerRows(0, seed), half = bunkerRows(50, seed), later = bunkerRows(90, seed)
    expect(whole[0]).toBe('..############..')
    expect(whole[2]).toBe('################')
    expect(whole[6]).toBe('#####......#####')
    expect(half).toEqual(bunkerRows(50, seed))
    const count = (rows: string[]) => rows.join('').split('#').length - 1
    expect(count(half)).toBeGreaterThan(count(whole) * .55)
    expect(count(half)).toBeLessThan(count(whole))
    expect(count(later)).toBeLessThan(count(whole) / 3)
    expect(half[2]!.includes('#')).toBe(true)
    expect(half[6]!.slice(5, 11)).toBe('......')
    expect(half.slice(0, 3).join('').split('.').length).toBeGreaterThan(whole.slice(0, 3).join('').split('.').length)
    whole.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '.') expect(half[y]![x]).toBe('.') }))
  }
})

test('64, 100 and 140 column fleets keep the whole enabled crew intact', () => {
  for (const width of [64, 100, 140]) {
    const plan = arcadePlan(busy, width), focus = arcade.focus!(busy, { width })
    expect(plan.ships.length + plan.hidden).toBe(5)
    for (const [i, s] of plan.ships.entries()) {
      expect(s.x).toBeGreaterThanOrEqual(focus.x)
      expect(s.x + s.w).toBeLessThanOrEqual(focus.x + focus.w)
      expect(s.rows).toEqual(SHIPS[s.provider]); expect(s.y).toBeGreaterThan(64)
      if (i) expect(s.x - (plan.ships[i - 1]!.x + plan.ships[i - 1]!.w)).toBeGreaterThanOrEqual(0)
    }
    expect(plan.hidden).toBe(0)
  }
})
