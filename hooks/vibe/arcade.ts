import { C, CAST, CLAWD, PALETTE, PROVIDER_NAMES, canvas, highDecision, quotaHud, text, line, pixel, rect, sprite } from './engine'
import type { Canvas, HudLine, Scene, VibeData } from './engine'
import { activeEvents, eventLabel } from './events'
import type { Provider } from '../../types'
import { shortModel } from '../ui'
import { DESKS, officeStatus } from './office'

const { INK, PAPER } = C
export const SHIP_TINT: Record<Provider, number> = { claude: 67, codex: 68, antigravity: 69, opencode: 70, commandcode: 71, ollama: C.lavender }
const recent = (d: VibeData, at: number | undefined, ms = 30000) => at !== undefined && at <= d.now && d.now - at < ms
export const SHIPS: Record<Provider, string[]> = {
  claude: CLAWD.map((row, y) => y === 4 || y === 5 ? `O${row}O` : `.${row}.`).map(row => row.replace(/O/g, '#').replace(/k/g, '.')),
  codex: ['..#.....#..', '..#.....#..', '..#..#..#..', '..#######..', '.#########.', '###..#..###', '.#########.', '..#######..'],
  antigravity: ['.....#.....', '....###....', '.....#.....', '...#####...', '.#########.', '###########', '..#..#..#..'],
  opencode: ['.....#.....', '....###....', '...#####...', '..###.###..', '.#####.###.', '#######.###', '###..#.####', '#.......###'],
  commandcode: ['.....####..', '.....####..', '.....#.....', '..#######..', '.#########.', '###########', '#.#.#.#.#.#', '###########'],
  // Not in the fleet (Ollama has no desk); kept so every provider has a ship.
  ollama: ['..#.....#..', '..##...##..', '...#####...', '..#######..', '.#########.', '###.###.###', '.#########.', '..#.....#..'],
}
// The three original invader silhouettes, with two alternating leg poses.
const INVADERS = [
  [['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'],
   ['...##...', '..####..', '.######.', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.']],
  [['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
   ['..#.....#..', '#..#...#..#', '#.#######.#', '###.###.###', '###########', '.#########.', '..#.....#..', '.#.......#.']],
  [['...######...', '.##########.', '############', '###..##..###', '############', '..###..###..', '.##..##..##.', '##........##'],
   ['...######...', '.##########.', '############', '###..##..###', '############', '...##..##...', '..##.##.##..', '...##..##...']],
]
const UFO = ['.....#######.....', '...###########...', '..#############..', '.##..##.##..##..#.', '#################', '..###..###..###..', '...#....#....#...']
const BUNKER = ['..############..', '.##############.', '################', '################', '######....######', '#####......#####', '#####......#####']
export function bunkerRows(ctx: number, seed = 0): string[] {
  const erosion = Math.max(0, Math.min(1, ctx / 100)) ** 1.6
  return BUNKER.map((row, y) => [...row].map((ch, x) => {
    const scatter = ((x * 37 + y * 61 + seed * 29 + x * y * 17) % 101) / 101
    return ch === '#' && erosion > (y / 7 * .4 + scatter * .6) ? '.' : ch
  }).join(''))
}
const BURST = ['#...#...#', '.#..#..#.', '..#...#..', '...#.#...', '##.....##', '...#.#...', '..#...#..', '.#..#..#.', '#...#...#']
const art = (c: Canvas, rows: string[], x: number, y: number, tint: number = INK) => sprite(c, { rows, map: { '#': tint } }, x, y)

export function arcadePlan(d: VibeData, width = 128) {
  const running = d.agents.filter(a => a.state === 'running' && !d.usage.some(u => u.provider === a.provider && (u.out || !u.on)))
  const attract = !running.length && !d.main.working && !activeEvents(d.events ?? [], d.now).length
  const main = d.usage.find(u => u.on && u.tag === 'main')?.provider ?? 'claude'
  const fleet = DESKS.filter(p => !officeStatus(d, p).empty).map(provider => {
    const a = d.agents.find(a => a.provider === provider && a.state === 'running') ?? d.agents.find(a => a.provider === provider)
    const s = officeStatus(d, provider)
    return { id: provider, provider, model: a?.model ?? (provider === 'claude' ? d.main.model : ''), label: a?.label ?? 'Idle', effort: a?.effort,
      rows: SHIPS[provider], flagship: provider === main, working: s.typing, failed: s.failed,
      parked: s.asleep || d.usage.some(u => u.provider === provider && u.tag === 'saver') }
  })
  const span = Math.min(116, Math.max(64, width)), left = (128 - span) / 2
  const total = fleet.reduce((sum, s) => sum + s.rows[0]!.length, 0)
  const gap = fleet.length > 1 ? Math.min(9, Math.floor((span - total) / (fleet.length - 1))) : 0
  let x = Math.floor(left + (span - total - gap * Math.max(0, fleet.length - 1)) / 2)
  const ships = fleet.map(s => { const ship = { ...s, x, y: 77 - s.rows.length, w: s.rows[0]!.length, h: s.rows.length }; x += ship.w + gap; return ship })
  const hidden = 0
  const tasks = running.length || (d.main.working ? 1 : 0)
  const rows = Array.from({ length: attract ? 3 : Math.min(3, tasks) }, (_, i) => ({ x: 15, y: 19 + i * 10, kind: i }))
  const failed = [...d.acts].reverse().find(a => a.state === 'failed' && recent(d, a.at))
  const hit = d.tests === 'fail' || !!failed
  const hitProvider = d.agents.find(a => a.state === 'failed' && recent(d, a.endedAt))?.provider ?? d.edit?.provider ?? main
  const target = ships.find(s => s.provider === hitProvider) ?? ships[0]
  const field = Math.min(128, width), leftEdge = Math.ceil((128 - field) / 2)
  const fail = hit ? { x: Math.max(leftEdge, Math.min(leftEdge + field - 22, Math.round((target?.x ?? 53) + (target?.w ?? 22) / 2 - 11))), y: 48, w: 22, h: 9 } : null
  const docking = activeEvents(d.events ?? [], d.now).filter(e => ['provider-on', 'provider-off', 'handoff'].includes(e.kind)).map(event => {
    const ship = ships.find(s => s.provider === (event.provider ?? 'claude')), rows = ship?.rows ?? SHIPS[event.provider ?? 'claude']
    const span = Math.min(92, Math.max(40, width - 8)), left = (128 - span) / 2
    const dock = left + span - rows[0]!.length, home = ship?.x ?? left
    return { event, rows, home, dock, x: Math.min(home, dock), w: Math.abs(home - dock) + rows[0]!.length }
  })
  const occupied = [...(fail ? [{ x: fail.x, w: fail.w }] : []), ...docking]
  const markers = activeEvents(d.events ?? [], d.now).filter(e => ['powerup', 'decision', 'priority'].includes(e.kind) || e.kind === 'tag' && e.tag === 'main').map(event => {
    const right = leftEdge + field - 10
    const positions = Array.from({ length: Math.max(1, right - leftEdge + 1) }, (_, i) => right - i)
    const x = positions.find(x => occupied.every(r => x + 10 <= r.x || x >= r.x + r.w + 1))
    if (x === undefined) return null
    occupied.push({ x, w: 9 })
    return { event, x, y: 48, w: 9, h: 9 }
  }).filter(m => m !== null)
  return { attract, ships, rows, hit, target, fail, markers, docking, hidden, boss: d.findings > 0, erosion: Math.max(0, Math.min(1, d.ctx / 100)) }
}
function frame(d: VibeData, f: number, width = 128, maxRows = 41): Canvas {
  const c = canvas(128, 82, PAPER), p = arcadePlan(d, width)
  if (maxRows < 34) p.rows = p.rows.slice(0, maxRows < 30 ? 1 : 2)
  const shift = [0, 0, 0, 1, 1, 1, 0, 0, 0, -1, -1, -1][f]!, pose = f < 6 ? 0 : 1
  if (p.boss) {
    art(c, UFO, 56, 3)
    rect(c, 56, 12, 17, 1, INK); rect(c, 56 + Math.min(17, d.findings), 12, 17 - Math.min(17, d.findings), 1, PAPER)
  }
  const edit = !p.hit && d.edit && p.ships.find(s => s.provider === d.edit!.provider && s.working)
  for (const row of p.rows) for (let col = 0; col < 6; col++) {
    if (edit && row.kind === 2 % p.rows.length && col === 3 && f >= 8 && f < 10) art(c, BURST, 66 + shift, row.y, SHIP_TINT[edit.provider])
    else art(c, INVADERS[row.kind]![pose]!, row.x + col * 17 + shift, row.y)
  }
  if (!p.attract) {
    for (const bx of [10, 40, 70, 100]) {
      art(c, bunkerRows(d.ctx, bx), bx, 58)
    }
  }
  line(c, 3, 78, 124, 78, INK)
  for (const ship of p.ships) {
    art(c, ship.rows, ship.x, ship.y, ship.failed ? C.red : ship.parked ? C.lightGrey : SHIP_TINT[ship.provider])
    if (!ship.working && f >= 6) pixel(c, ship.x + ship.rows[3]!.indexOf('#', Math.floor(ship.w / 2)), ship.y + 3, PAPER)
    if (ship.flagship) line(c, ship.x, 79, ship.x + ship.w - 1, 79, SHIP_TINT[ship.provider])
  }
  if (!p.attract) {
    if (edit && f < 8 && p.rows.length) {
      const row = p.rows[2 % p.rows.length]!, targetX = row.x + 3 * 17 + shift + 4
      const t = f / 8, x = Math.round((edit.x + edit.w / 2) * (1 - t) + targetX * t), y = Math.round(70 * (1 - t) + (row.y + 8) * t)
      line(c, x, y, x, y - 2, SHIP_TINT[edit.provider])
    }
  }
  for (const e of activeEvents(d.events ?? [], d.now)) {
    const provider = e.provider ?? 'claude', ship = p.ships.find(s => s.provider === provider), t = (f + 3) / 14
    if (e.kind === 'provider-on' || e.kind === 'provider-off' || e.kind === 'handoff') {
      if (ship) rect(c, ship.x, ship.y, ship.w, ship.h, PAPER)
      const { rows, dock, home } = p.docking.find(dock => dock.event === e)!, entering = e.kind !== 'provider-off'
      const progress = entering ? 1 - t : t
      const x = Math.round(home * (1 - progress) + dock * progress)
      const y = Math.round((77 - rows.length) * (1 - Math.min(1, progress * 5)) + 48 * Math.min(1, progress * 5))
      art(c, rows, x, y, SHIP_TINT[provider])
      if (e.kind === 'handoff') {
        const carrier = p.ships.find(s => s.provider === 'claude')
        if (carrier) {
          rect(c, carrier.x, carrier.y, carrier.w, carrier.h, PAPER)
          art(c, carrier.rows, carrier.x, carrier.y, C.lightGrey)
        }
      }
    } else if (e.kind === 'powerup' || e.kind === 'decision') {
      const marker = p.markers.find(m => m.event === e)
      if (marker) { rect(c, marker.x, marker.y, 9, 9, INK); text(c, e.kind === 'decision' ? 'D' : '+', marker.x + 3, marker.y + 2, PAPER) }
    } else if (e.kind === 'tag' && e.tag !== 'main') {
      if (ship) rect(c, ship.x, ship.y, ship.w, ship.h, PAPER)
      const rows = ship?.rows ?? SHIPS[provider]
      art(c, rows, ship?.x ?? 40, 77 - rows.length, e.tag === 'saver' ? C.lightGrey : SHIP_TINT[provider])
      if (e.tag === 'saver') for (let dx = 0; dx < rows[0]!.length; dx += 3) { pixel(c, (ship?.x ?? 40) + dx, 75 - rows.length, C.lightGrey); pixel(c, (ship?.x ?? 40) + dx, 77, C.lightGrey) }
    } else if (e.kind === 'priority' || e.kind === 'tag' && e.tag === 'main') {
      const marker = p.markers.find(m => m.event === e)
      if (marker) art(c, BURST, marker.x, marker.y, SHIP_TINT[provider])
    }
  }
  if (p.hit) {
    if (p.target) art(c, p.target.rows, p.target.x, p.target.y, C.red)
    rect(c, p.fail!.x, p.fail!.y, 22, 9, C.red); text(c, 'FAIL', p.fail!.x + 3, p.fail!.y + 2, PAPER)
  }
  return c
}
export function arcadeEvent(d: VibeData): string {
  const p = arcadePlan(d)
  const owner = activeEvents(d.events ?? [], d.now)
  if (owner.length) return owner.map(eventLabel).join(' · ')
  if (p.hit) return 'COMBO BREAKER'
  const launch = d.agents.find(a => a.state === 'running' && recent(d, a.startedAt, 5000) && !d.usage.some(u => u.provider === a.provider && (u.out || !u.on)))
  const out = d.usage.some(u => u.on && u.out)
  if (out && launch) return 'PLAYER 2 HAS ENTERED'
  if (out) return 'CONTINUE? 9'
  if (p.attract) return 'PRESS START'
  const save = [...d.acts].reverse().find(a => a.state === 'done' && /\bgit\b[^;&|]*\b(commit|push)\b/.test(a.title) && recent(d, a.at))
  if (save) return 'SAVE STATE'
  if (d.tests === 'pass') return `STAGE CLEAR  +${d.lines}`
  if (launch) return `LAUNCH  ${PROVIDER_NAMES[launch.provider]} · ${shortModel(launch.model)}`
  if (d.combo >= 3) return `COMBO ×${d.combo}`
  return ''
}
function hud(d: VibeData, w: number): { top: HudLine[]; bottom: HudLine[] } {
  const bottom: HudLine[] = [], current = arcadeEvent(d)
  const high = highDecision(d)
  if (high) bottom.push([{ text: `decision: ${high.decision}`.slice(0, w), bold: true }])
  if (current) bottom.push([{ text: current.slice(0, w), bold: !high }])
  bottom.push(...quotaHud(d, w, CAST, true))
  bottom.push([{ text: `${d.tps} t/s · ctx ${Math.round(d.ctx)}%`, dim: true }])
  const score = `1UP ${String(Math.floor(d.lines)).padStart(5, '0')}   HI ${String(Math.floor(d.best)).padStart(5, '0')}   CREDIT $${d.cost.toFixed(2)}   LV ${d.commits}`
  const top: HudLine[] = [[{ text: `${shortModel(d.main.model) || 'Claude'} · ${d.main.effort || 'default'}`.slice(0, w), bold: true }]]
  for (const part of score.split('   ')) {
    const last = top[top.length - 1]
    if (last && last[0]!.text.length + part.length + 3 <= w) last[0]!.text += `   ${part}`
    else top.push([{ text: part, bold: true }])
  }
  return { top, bottom }
}
export const arcade: Scene = {
  id: 'arcade', name: 'Agent Arcade', hud,
  key: d => {
    const p = arcadePlan(d)
    return { ships: p.ships.map(s => [s.id, s.provider, s.x, s.y, s.w, s.h, s.flagship, s.working, s.failed, s.parked]), hidden: p.hidden, rows: p.rows, hit: p.hit, target: p.target?.id, boss: p.boss ? Math.min(17, d.findings) : 0,
      bunkers: p.attract ? [] : [10, 40, 70, 100].map(seed => bunkerRows(d.ctx, seed)),
      edit: !p.hit && d.edit && p.ships.some(s => s.provider === d.edit!.provider) ? d.edit.provider : null }
  },
  frames: (d, opt) => {
    const frames = Array.from({ length: opt.motion === 'still' ? 1 : 12 }, (_, f) => frame(d, f, opt.width, opt.maxRows))
    if (opt.maxRows === undefined) return frames
    // Remove only rows empty in every pose, keeping ships and reaction lettering intact.
    const empty = Array.from({ length: 82 }, (_, y) => frames.every(c => c.px.subarray(y * c.w, (y + 1) * c.w).every(p => p === PAPER)))
    const remove = new Set<number>(), target = Math.max(1, opt.maxRows * 2)
    for (let y = 0; y < 82 && 82 - remove.size > target; y++) if (empty[y] && (y === 0 || y === 81 || empty[y - 1])) remove.add(y)
    const rows = Array.from({ length: 82 }, (_, y) => y).filter(y => !remove.has(y))
    return frames.map(c => { const out = canvas(c.w, rows.length, PAPER); rows.forEach((y, i) => out.px.set(c.px.subarray(y * c.w, (y + 1) * c.w), i * c.w)); return out })
  },
  focus: (_d, opt) => { const w = Math.min(128, opt?.width ?? 128); return { x: (128 - w) / 2, y: 0, w, h: 80 } },
  hotspots: d => {
    const p = arcadePlan(d)
    return [...p.ships.map(s => ({ x: s.x, y: s.y, w: s.w, h: s.h, title: `${PROVIDER_NAMES[s.provider]} · ${s.model} · ${s.effort || 'default'}\n${s.label}` })),
      ...(p.boss ? [{ x: 56, y: 3, w: 17, h: 10, title: `${d.findings} review findings` }] : [])]
  },
}
