import { CLAWD, OFFICE_ACCENTS as A, OFFICE_CAST, PALETTE, PROVIDER_NAMES, ROOM as R, canvas, clone, highDecision, quotaHud, text, line, pixel, rect, remap, sprite } from './engine'
import type { Canvas, HudLine, Scene, VibeAgent, VibeData } from './engine'
import { activeEvents } from './events'
import type { Provider } from '../../types'
import { fit, fitStart, shortModel } from '../ui'

export const DESKS: Provider[] = ['claude', 'codex', 'antigravity', 'opencode', 'commandcode']
export const OFFICE_W = 160, OFFICE_H = 80
export const DESK_X: Record<Provider, number> = { claude: 3, codex: 39, antigravity: 69, opencode: 99, commandcode: 129 }
const deskWidth = (p: Provider) => p === 'claude' ? 33 : p === 'opencode' ? 26 : 28
const recent = (d: VibeData, at: number | undefined, ms = 30000) => at !== undefined && at <= d.now && d.now - at < ms
const agent = (d: VibeData, p: Provider) => d.agents.find(a => a.provider === p && a.state === 'running') ?? d.agents.filter(a => a.provider === p).sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0))[0]
export function officeStatus(d: VibeData, p: Provider) {
  const a = agent(d, p), u = d.usage.find(u => u.provider === p)
  const running = a?.state === 'running' || (p === 'claude' && d.main.working && !d.main.waiting)
  const on = p === 'claude' || !!u?.on
  const failed = a?.state === 'failed' && recent(d, a.endedAt)
  return { asleep: !!u?.out, empty: !on, failed, saver: u?.tag === 'saver',
    typing: on && !u?.out && u?.tag !== 'saver' && running }
}
const delegating = (d: VibeData) => d.main.lastTool === 'Agent' && d.agents.find(a => a.provider !== 'claude' && a.state === 'running' && recent(d, a.startedAt, 8000))

// Each mascot has a different contour, with at most three tones and an outline.
export const MASCOTS: Record<Provider, string[]> = {
  claude: CLAWD,
  codex: [
    '.......l......', '.......#......', '....######....', '..##aaaaaa##..', '.#aaaaaaaaaa#.',
    '#aa########aa#', '#a##########a#', '#a##l#######a#', '#a###l######a#', '#a##l#######a#',
    '.#a########a#.', '..##aaaaaa##..', '....#aaaa#....', '..##aaaaaa##..', '..#aal##laa#..',
    '...#aaaaaa#...', '...##a##a##...', '...###..###...',
  ],
  antigravity: [
    '....######.....', '..##llllll##...', '.#llllllllll#..', '#ll########ll#.', '#l#aaaaaaaa#l#.',
    '#l#aaaaaaaa#l#.', '#ll########ll#.', '.#llllllllll#..', '..###llll###...', '...#aaaala#....',
    '..#aaaallla#...', '.#laaaaalaal#..', '.#l#aaaaaa#l#..', '..##aaaaaa##...', '...#aa##aa#....',
    '...#aa##aa#....', '...###..###....',
  ],
  opencode: [
    '......##.......', '.....#aa#......', '....#aaaa#.....', '...#aaaaaa#....', '..#aaaaaaaa#...',
    '.#aaa####aaa#..', '#aa########aa#.', '#aa#l####l#aa#.', '#aa########aa#.', '.#aa######aa#..',
    '..#aaaaaaaa#...', '..#aaaaaaaa#...', '.#aaaaaaaaaa#..', '#aaaaaaaaaaaa#.', '.############..',
    '...#aa##aa#....', '...###..###....',
  ],
  commandcode: [
    '....######.....', '...#aaalaa#....', '..#aaalaaaa#...', '..#aaalaaaa#...', '.############..',
    '...#llllll#....', '...#l#ll#l#....', '...#llllll#....', '....######.....', '..##aaaaaa##...',
    '.#aaaaaaaaaa#..', '#aa#aaaaaa#aa#.', '#aa#aaaaaa#aa#.', '.#llllllllll#..', '..#aa#ll#aa#...',
    '..#aa####aa#...', '..####..####...',
  ],
}
export function officeActor(c: Canvas, d: VibeData, p: Provider, f: number) {
  const s = officeStatus(d, p), x = DESK_X[p] + (p === 'claude' ? 3 : 1)
  const hop = p === 'claude' && s.typing && delegating(d) && f >= 2 && f <= 4 ? 2 : 0
  const breath = !s.typing && f >= 6 ? 1 : 0
  const y = breath + (p === 'claude' ? 48 - hop : p === 'opencode' ? 44 + (s.typing && f >= 6 ? 1 : 0) : p === 'antigravity' ? 41 - (s.typing && f >= 6 ? 1 : 0) : 42)
  if (s.empty) return
  let rows = MASCOTS[p]
  if (p === 'claude' && s.typing) rows = rows.map((row, i) => i === 2 || i === 3 ? f === 10 ? row.replace(/k/g, 'O') : row : i >= 8 && f >= 6 ? '....O.O..O.O....' : row)
  const saver = s.saver
  sprite(c, { rows, map: { '#': R.outline, a: saver ? R.edge : OFFICE_CAST[p], l: saver ? R.edge : R.light, O: saver ? R.edge : OFFICE_CAST.claude, k: A.eye } }, x, y)
  if (s.failed) rect(c, x + 4, y + 6, 7, 1, R.red)
  if (p === 'codex' && s.typing && f >= 6) {
    rect(c, x + 4, y + 7, 3, 3, R.outline); rect(c, x + 4, y + 9, 3, 1, R.light)
  }
  // Headphone ear cups, prompt screen, chest sparkle and tool belt remain visible above the desk.
  if (p === 'opencode') { rect(c, x, y + 6, 2, 4, R.light); rect(c, x + 12, y + 6, 2, 4, R.light) }
  if (p === 'commandcode') {
    pixel(c, x + 6, y + 13, R.gold)
    const hy = s.typing && f >= 6 ? 55 : 58
    line(c, x + 13, 58, x + 16, hy - 1, R.gold); rect(c, x + 14, hy - 2, 4, 2, R.light)
  }
  if (s.asleep) sprite(c, { rows: ['###', '..#', '.#.', '#..', '###'], map: { '#': R.light } }, x + 6, 34)
  if (p === 'claude' && d.main.waiting) sprite(c, { rows: ['##.', '..#', '.#.', '...', '.#.'], map: { '#': R.light } }, x + 6, 39)
}
function monitor(c: Canvas, x: number, y: number, w: number, h: number) {
  rect(c, x, y, w, h, R.outline); rect(c, x + 1, y + 1, w - 2, h - 3, R.edge)
  line(c, x + Math.floor(w / 2), y + h, x + Math.floor(w / 2), y + h + 1, R.outline)
}
function background(d: VibeData): Canvas {
  const c = canvas(OFFICE_W, OFFICE_H, R.wall)
  rect(c, 0, 36, OFFICE_W, 29, R.lower)
  rect(c, 0, 65, OFFICE_W, 15, R.floor); line(c, 0, 65, 159, 65, R.edge)
  rect(c, 7, 68, 146, 9, R.lower); line(c, 10, 76, 149, 76, R.edge)
  rect(c, 5, 8, 28, 25, R.edge)
  const sky = d.hour >= 6 && d.hour <= 16 ? R.day : d.hour >= 17 && d.hour <= 19 ? R.sunset : R.night
  rect(c, 7, 10, 24, 20, sky)
  if (sky === R.night) for (const [x, y] of [[10, 14], [25, 17], [19, 25]]) pixel(c, x!, y!, R.light)
  line(c, 19, 10, 19, 30, R.edge); line(c, 7, 22, 30, 22, R.edge); rect(c, 4, 31, 30, 2, R.top)
  // Plant by the window, board, one small bookshelf and coffee by the door.
  rect(c, 29, 34, 5, 5, R.desk); line(c, 31, 34, 31, 24, R.green)
  sprite(c, { rows: ['gg..g', '.ggg.', '..g..', 'gggg.', '..g..'], map: { g: R.green } }, 28, 25)
  rect(c, 66, 10, 30, 16, R.desk); rect(c, 67, 11, 28, 14, R.top)
  d.decisions.slice(-3).forEach((note, i) => rect(c, 70 + i * 8, 14 + i % 2, 5, 6, note.impact === 'high' ? R.red : note.impact === 'medium' ? R.gold : R.edge))
  rect(c, 107, 11, 17, 22, R.desk); rect(c, 109, 12, 13, 19, R.outline)
  for (let row = 0; row < 2; row++) {
    rect(c, 109, 20 + row * 10, 13, 1, R.top)
    for (let i = 0; i < 4; i++) rect(c, 110 + i * 3, 14 + row * 9 + i % 2, 2, 6 - i % 2, i % 2 ? R.edge : R.top)
  }
  rect(c, 145, 9, 13, 28, R.edge); rect(c, 147, 11, 9, 25, R.outline); pixel(c, 154, 25, R.gold)
  rect(c, 130, 35, 12, 2, R.top); rect(c, 132, 27, 8, 8, R.outline); rect(c, 133, 28, 6, 3, R.edge)
  pixel(c, 137, 29, R.green); rect(c, 134, 33, 3, 2, R.light); pixel(c, 137, 33, R.light)
  for (const p of DESKS) {
    const x = DESK_X[p], width = deskWidth(p), top = p === 'opencode' ? 64 : 61
    if (p === 'claude') { rect(c, x + 4, 58, 14, 2, R.top); rect(c, x + 6, 60, 2, 5, R.desk); rect(c, x + 14, 60, 2, 5, R.desk) }
    else { rect(c, x + 3, 56, 10, 7, R.outline); rect(c, x + 4, 57, 8, 5, R.edge); line(c, x + 8, 63, x + 8, 68, R.outline) }
    if (p === 'antigravity') {
      rect(c, x + 14, top - 2, width - 14, 2, R.edge); rect(c, x + 2, top, width - 4, 1, R.light); rect(c, x + 1, top + 1, width - 2, 1, R.edge)
      rect(c, x + 3, top + 2, width - 6, 3, R.desk)
    } else {
      rect(c, x, top, width, 2, p === 'opencode' ? R.edge : R.top)
      rect(c, x + 1, top + 2, width - 2, p === 'commandcode' ? 5 : 3, p === 'codex' ? R.edge : R.desk)
    }
    rect(c, x + 2, top + 4, 2, 5, R.desk); rect(c, x + width - 4, top + 4, 2, 5, R.desk)
    if (d.usage.some(u => u.provider === p && u.tag === 'main')) rect(c, x + 7, top + 3, 8, 1, R.gold)
    if (p === 'claude') {
      monitor(c, x + 20, 47, 10, 10)
      line(c, x + 2, 46, x + 2, 40, R.edge); rect(c, x, 39, 7, 2, R.gold); rect(c, x + 1, 46, 4, 1, R.edge)
      rect(c, x + 24, 59, 7, 2, R.light); line(c, x + 25, 60, x + 29, 60, R.edge)
    } else if (p === 'codex') {
      monitor(c, x + 15, 48, 6, 8); monitor(c, x + 22, 48, 5, 8)
      sprite(c, { rows: ['...gg.', '..gggr', '...gg.', '.gggg.', '..gg..'], map: { g: R.gold, r: R.red } }, x + 16, 56)
    } else if (p === 'antigravity') monitor(c, x + 17, 51, 9, 6)
    else if (p === 'opencode') {
      monitor(c, x + 15, 54, 9, 7); rect(c, x + 14, 62, 11, 1, R.light)
      pixel(c, x + 16, 55, R.gold); pixel(c, x + 21, 58, R.green); pixel(c, x + 18, 59, R.red)
      rect(c, x + 11, 61, 2, 3, R.light); pixel(c, x + 11, 61, R.red)
      rect(c, x + 3, 69, width - 6, 1, A.glow)
    } else {
      monitor(c, x + 19, 47, 8, 8)
      rect(c, x + 18, 58, 9, 3, R.edge); rect(c, x + 17, 57, 2, 4, R.light); pixel(c, x + 21, 59, R.day)
      rect(c, x + 3, 64, 7, 4, R.red); rect(c, x + 5, 63, 3, 1, R.outline); pixel(c, x + 6, 65, R.gold)
    }
  }
  return c
}
function frame(base: Canvas, d: VibeData, f: number): Canvas {
  const c = clone(base)
  for (const p of DESKS) {
    officeActor(c, d, p, f)
    const x = DESK_X[p], s = officeStatus(d, p)
    if (s.typing) {
      const mx = x + (p === 'claude' ? 21 : p === 'codex' ? 16 : p === 'antigravity' ? 18 : p === 'opencode' ? 16 : 20)
      const my = p === 'claude' || p === 'commandcode' ? 49 : p === 'codex' ? 50 : p === 'antigravity' ? 53 : 56
      for (let row = 0; row < 2; row++) {
        const editing = d.edit?.provider === p
        const tint = editing && row === 1 && d.edit!.removed > 0 ? R.red : editing && d.edit!.added > 0 || p === 'codex' ? R.green : R.light
        rect(c, mx, my + row * 2, 2 + (row + (f >= 6 ? 1 : 0)) % 2, 1, tint)
        if (p === 'codex') rect(c, x + 23, my + row * 2, 2, 1, R.green)
      }
    }
    if (p === 'antigravity') {
      const y = 42 - (s.typing && f >= 6 ? 1 : 0)
      sprite(c, { rows: ['....bbb....', '...bbbbb...', '..bbbbbbb..', 'gggggbggggg', '..bbbbbbb..', '...bbbbb...', '....bbb....'], map: { b: OFFICE_CAST.antigravity, g: R.gold } }, x + 17, y)
    }
  }
  const lamp = d.tests === 'fail' ? f < 6 ? R.red : R.outline : d.tests === 'pass' ? R.green : R.edge
  rect(c, 150, 5, 4, 2, lamp)
  const shipping = [...d.acts].reverse().find(a => a.state === 'done' && /\bgit\b[^;&|]*\b(commit|push)\b/.test(a.title) && recent(d, a.at))
  const delegated = delegating(d)
  if (d.tests !== 'fail' && shipping) {
    const x = 139 + f
    rect(c, x, 72, 5, 4, R.top); line(c, x + 2, 72, x + 2, 75, R.gold)
  } else if (d.tests !== 'fail' && delegated) {
    const x = 24 + Math.floor((DESK_X[delegated.provider] + 5 - 24) * f / 11)
    rect(c, x, 37, 5, 4, R.gold); rect(c, x, 36, 2, 1, R.gold)
  }
  if (d.idle >= 120 && !d.main.working && !d.agents.some(a => a.state === 'running')) {
    sprite(c, { rows: ['..g..g......', '..gggg..ggg.', '.ggggggggg..', 'gggggggggg..', '.gggggggg...'], map: { g: R.gold } }, 72, 71)
    pixel(c, 75, 73, R.outline); pixel(c, 77, 73, R.outline)
  }
  if (d.idle >= 120) remap(c, 0, 0, OFFICE_W, OFFICE_H, { [R.wall]: R.outline, [R.lower]: R.wall, [R.floor]: R.lower, [R.top]: R.desk, [R.desk]: R.floor, [R.light]: R.edge, [R.day]: R.night, [R.sunset]: R.night })
  return c
}
export function agentHud(d: VibeData, w: number): HudLine[] {
  const entries = d.usage.filter(u => u.on).flatMap<VibeAgent>(u => {
    const agents = d.agents.filter(a => a.provider === u.provider).sort((a, b) => Number(b.state === 'failed') - Number(a.state === 'failed') || Number(b.state === 'running') - Number(a.state === 'running') || (b.state === 'running' ? b.startedAt ?? 0 : b.endedAt ?? 0) - (a.state === 'running' ? a.startedAt ?? 0 : a.endedAt ?? 0))
    return agents.length ? agents : u.provider === 'claude' || u.out ? [{ id: 'main', steps: 0, provider: u.provider, model: u.provider === 'claude' ? d.main.model : '', label: 'Main session', state: u.provider === 'claude' && d.main.working && !d.main.waiting ? 'running' : 'done' }] : []
  })
  return entries.slice(0, 5).map((a, i) => {
    const p = a.provider, u = d.usage.find(u => u.provider === p)
    const state = a.state === 'failed' ? `failed · ${a.label}` : u?.out ? 'asleep' : u?.tag === 'saver' ? 'saver' : a.id === 'main' && (!d.main.working || d.main.waiting) ? 'idle' : a.state === 'running' ? a.label : a.state === 'done' ? 'done' : 'idle'
    const model = w < 60 ? '' : fit(shortModel(a.model), Math.min(24, Math.max(8, w - PROVIDER_NAMES[p].length - 20))), edit = d.edit?.provider === p ? d.edit : null
    const prefix = ` ${PROVIDER_NAMES[p]}${model ? ` ${model}` : ''} · `, stats = edit ? ` +${edit.added} −${edit.removed}` : ''
    const filename = edit ? edit.file.split('/').pop()! : ''
    const more = i === 4 && entries.length > 5 ? ` · +${entries.length - 5} more` : ''
    const file = (edit ? w < 60 ? stats : ` · ${fitStart(filename, Math.max(4, Math.min(20, w - prefix.length - stats.length - more.length - 14)))}${stats}` : '') + more
    const label = fit(state, Math.max(0, w - prefix.length - file.length - 1))
    return [{ text: '●', color: `#${PALETTE[OFFICE_CAST[p]]!.toString(16)}` }, { text: prefix }, { text: label, color: a.state === 'failed' ? 'error' : undefined }, { text: file }]
  })
}
function hud(d: VibeData, w: number): { top: HudLine[]; bottom: HudLine[] } {
  const title = `Agent HQ · ${shortModel(d.main.model) || 'Claude'} · ${d.main.effort || 'default'}`
  const info = `${d.tps} t/s · $${d.cost.toFixed(2)} · ctx ${Math.round(d.ctx)}%${d.combo >= 5 ? ` · COMBO ×${d.combo}` : ''}`
  const top: HudLine[] = title.length + info.length + 2 <= w
    ? [[{ text: title, bold: true }, { text: info.padStart(w - title.length), dim: true }]]
    : [[{ text: title, bold: true }], [{ text: info.padStart(w), dim: true }]]
  top.push(...quotaHud(d, w, OFFICE_CAST))
  const bottom = agentHud(d, w)
  const act = [...d.acts].reverse().find(a => recent(d, a.at)), decision = [...d.decisions].reverse().find(a => recent(d, a.at))
  let event = ''
  if (act && (!decision || act.at >= decision.at)) {
    event = act.tests ? `tests ${act.tests === 'fail' ? 'failed' : 'passed'}` : /\bgit\b[^;&|]*\bpush\b/.test(act.title) ? 'pushed changes' : /\bgit\b[^;&|]*\bcommit\b/.test(act.title) ? 'committed changes' : act.title
  } else if (decision) event = `decision: ${decision.decision}`
  const high = highDecision(d)
  if (high) bottom.push([{ text: `decision: ${high.decision}`.slice(0, w), bold: true }])
  if (event && event !== `decision: ${high?.decision}`) bottom.push([{ text: event.slice(0, w), bold: !high }])
  else {
    const idle = [d.main.waiting ? 'waiting on owner' : '', d.idle >= 120 ? `idle ${Math.floor(d.idle / 60)}m` : ''].filter(Boolean).join(' · ')
    if (idle) bottom.push([{ text: idle, dim: true }])
  }
  return { top, bottom }
}
export function officeLayout(d: VibeData, width = OFFICE_W) {
  width = Math.max(20, Math.min(OFFICE_W, Math.floor(width)))
  const desks = DESKS
  const shown = desks.length ? desks : ['claude' as Provider]
  const columns = Math.min(shown.length, Math.max(1, Math.floor(width / 20))), rows = Math.ceil(shown.length / columns)
  return { width, height: rows * 32, desks: shown.map((provider, i) => { const count = Math.min(columns, shown.length - Math.floor(i / columns) * columns); return { provider, x: Math.floor(i % columns * width / count), y: Math.floor(i / columns) * 32 - 40, w: Math.floor((i % columns + 1) * width / count) - Math.floor(i % columns * width / count) } }) }
}
function fitRoom(c: Canvas, d: VibeData, width: number | undefined, f: number): Canvas {
  if (width === undefined || width >= OFFICE_W) return c
  const layout = officeLayout(d, width), out = canvas(layout.width, layout.height, R.wall)
  rect(out, 0, 36, out.w, out.h - 36, R.lower)
  // Wall decor gives way first; each desk keeps its whole silhouette in its own bay.
  for (const desk of layout.desks) {
    const p = desk.provider, x = desk.x, top = 61 + desk.y, s = officeStatus(d, p)
    monitor(out, x + desk.w - 8, top - 10, 6, 8)
    if (s.typing) rect(out, x + desk.w - 6, top - 8, 2, 1, d.edit?.provider === p && d.edit.removed > 0 ? R.red : R.green)
    // One grounded signature per desk: lamp, plant, inspection tray, mixer or toolbox.
    const px = x + desk.w - 7
    if (p === 'claude') { rect(out, px, top - 5, 1, 5, R.edge); rect(out, px - 2, top - 6, 5, 2, R.gold) }
    if (p === 'codex') { rect(out, px, top - 3, 4, 3, R.desk); sprite(out, { rows: ['.g.', 'ggg', '.g.'], map: { g: R.green } }, px, top - 6) }
    if (p === 'antigravity') { rect(out, px - 3, top - 2, 7, 2, R.light); pixel(out, px, top - 3, R.gold) }
    if (p === 'opencode') { rect(out, px - 2, top - 3, 6, 3, R.outline); pixel(out, px, top - 2, R.red); pixel(out, px + 2, top - 2, R.green) }
    if (p === 'commandcode') { rect(out, px - 2, top - 4, 6, 4, R.red); rect(out, px, top - 5, 2, 1, R.gold) }
    const actor = canvas(OFFICE_W, OFFICE_H, R.wall)
    officeActor(actor, d, p, f)
    const actorX = DESK_X[p] + (p === 'claude' ? 3 : 1), grounded = p === 'claude' || p === 'antigravity' ? 3 : p === 'codex' ? 1 : p === 'commandcode' ? 2 : 0
    for (let y = 34; y < 62; y++) for (let xx = 0; xx < 18; xx++) {
      const color = actor.px[y * actor.w + actorX + xx]!
      if (color !== R.wall) pixel(out, x + 1 + xx, y + desk.y + grounded, color)
    }
    rect(out, x, top, desk.w - 1, 2, p === 'opencode' ? R.edge : R.top)
    rect(out, x + 1, top + 2, desk.w - 3, 3, R.desk)
    rect(out, x + 2, top + 5, 2, 5, R.desk); rect(out, x + desk.w - 5, top + 5, 2, 5, R.desk)
    if (d.usage.some(u => u.provider === p && u.tag === 'main')) rect(out, x + 5, top + 3, 7, 1, R.gold)
    line(out, x, top + 10, x + desk.w - 2, top + 10, R.edge)
  }
  rect(out, out.w - 7, 2, 4, 2, c.px[5 * c.w + 150]!)
  if (d.idle >= 120) remap(out, 0, 0, out.w, out.h, { [R.wall]: R.outline, [R.lower]: R.wall, [R.top]: R.desk, [R.desk]: R.floor, [R.light]: R.edge })
  return out
}
function officeReaction(c: Canvas, d: VibeData, f: number) {
  const events = activeEvents(d.events ?? [], d.now), narrow = c.w < OFFICE_W, layout = officeLayout(d, c.w)
  const desk = (p: Provider) => {
    const bay = narrow ? layout.desks.find(b => b.provider === p) : undefined
    const y = bay?.y ?? 0, x = bay?.x ?? DESK_X[p], w = bay?.w ?? deskWidth(p)
    return { x, y, w, crownX: narrow ? x + w - 7 : x + 6, crownY: narrow ? 48 + y : y + (p === 'claude' ? 45 : p === 'antigravity' ? 38 : p === 'opencode' ? 41 : 39) }
  }
  for (const u of d.usage) {
    if (narrow && !layout.desks.some(b => b.provider === u.provider)) continue
    const b = desk(u.provider)
    if (u.tag === 'main' && u.on && !events.some(e => e.kind === 'handoff')) {
      const x = b.crownX, y = b.crownY
      sprite(c, { rows: ['#.#.#', '#####', '.###.'], map: { '#': R.gold } }, x, y)
    }
  }
  const t = (f + 3) / 14
  for (const e of events) {
    const p = e.provider ?? 'claude', b = desk(p)
    if (e.kind === 'provider-off' || e.kind === 'provider-on') {
      const label = e.kind === 'provider-on' ? 'ON' : 'OFF', y = 64 + b.y
      rect(c, b.x + 1, y, Math.min(b.w - 2, 13), 5, R.outline)
      text(c, label, b.x + 1, y, R.light)
    } else if (e.kind === 'handoff') {
      const cl = desk('claude'), x = Math.round(cl.crownX * (1 - t) + b.crownX * t)
      const y = Math.round(cl.crownY * (1 - t) + b.crownY * t - Math.sin(t * Math.PI) * (narrow ? 2 : 5))
      sprite(c, { rows: ['#.#.#', '#####', '.###.'], map: { '#': R.gold } }, x, y)
    } else if (e.kind === 'powerup') {
      const cl = desk('claude'), x = Math.round((c.w - 15) * (1 - t) + (cl.x + 18) * t), y = 34 + cl.y
      rect(c, x, y, 5, 7, R.gold); pixel(c, x + 1, y + 2, R.outline)
      line(c, x, y + 7, x - f % 2, y + 9, R.light); line(c, x + 4, y + 7, x + 5, y + 9, R.light)
      rect(c, cl.x + 21, 58 + cl.y, 5, 3, A.glow)
    } else if (e.kind === 'decision') {
      const cl = desk('claude'), x = Math.round((cl.x + 8) * (1 - t) + Math.min(c.w - 7, 76) * t)
      const y = Math.round((45 + cl.y) * (1 - t) + (narrow ? 5 : 15) * t)
      rect(c, x, y, 6, 7, R.gold); line(c, x + 1, y + 2, x + 4, y + 2, R.outline)
    }
    if (e.kind === 'tag' && e.tag === 'normal') {
      line(c, b.x + 4, 36 + b.y, b.x + 7, 39 + b.y, R.green); line(c, b.x + 7, 39 + b.y, b.x + 13, 34 + b.y, R.green)
    }
    if (e.kind === 'tag' && e.tag === 'main' || e.kind === 'handoff' || e.kind === 'priority') {
      for (let i = 0; i < 9; i++) pixel(c, b.x + (i * 7 + f * 2) % Math.max(1, b.w), 34 + b.y + (i * 3 + f) % 19, i % 2 ? R.gold : R.green)
    }
  }
  if (d.tests === 'fail') {
    const p = d.agents.find(a => a.state === 'failed')?.provider ?? d.edit?.provider ?? 'claude', b = desk(p)
    remap(c, b.x, (narrow ? 40 : 34) + b.y, b.w - 1, narrow ? 32 : 39, { [R.wall]: R.red, [R.lower]: R.red, [R.top]: R.red })
  }
  for (const u of d.usage.filter(u => u.on && (u.tag === 'saver' || events.some(e => e.kind === 'tag' && e.tag === 'saver' && e.provider === u.provider)))) {
    if (narrow && !layout.desks.some(b => b.provider === u.provider)) continue
    const b = desk(u.provider)
    const y = (narrow ? 64 : u.provider === 'opencode' ? 67 : 64) + b.y
    rect(c, b.x + 1, y, Math.min(b.w - 2, 21), 5, R.outline)
    text(c, 'SAVER', b.x + 1, y, R.light)
  }
  return c
}
export const office: Scene = {
  id: 'office', name: 'Agent HQ', hud,
  key: d => ({
    hour: d.hour >= 6 && d.hour <= 16 ? 'day' : d.hour >= 17 && d.hour <= 19 ? 'sunset' : 'night',
    desks: DESKS.map(p => [officeStatus(d, p), d.usage.some(u => u.provider === p && u.tag === 'main')]),
    waiting: d.main.waiting, tests: d.tests, notes: d.decisions.slice(-3).map(a => a.impact),
    edit: d.edit ? [d.edit.provider, d.edit.added > 0, d.edit.removed > 0] : null,
    shipping: d.tests !== 'fail' && d.acts.some(a => a.state === 'done' && /\bgit\b[^;&|]*\b(commit|push)\b/.test(a.title) && recent(d, a.at)),
    delegated: (delegating(d) || undefined)?.provider, idle: d.idle >= 120,
    sleeping: d.idle >= 120 && !d.main.working && !d.agents.some(a => a.state === 'running'),
    active: DESKS.filter(p => p === 'claude' && (d.main.working || d.main.waiting) || d.agents.some(a => a.provider === p && a.state === 'running')),
  }),
  frames: (d, opt) => {
    const base = background(d)
    return Array.from({ length: opt.motion === 'still' ? 1 : 12 }, (_, f) => {
      const c = officeReaction(fitRoom(frame(base, d, f), d, opt.width, f), d, f)
      if (c.w >= OFFICE_W || opt.maxRows === undefined || c.h <= opt.maxRows * 2) return c
      // One empty ceiling row and the floor rule give way before any mascot or desk leg.
      const rows = Array.from({ length: c.h }, (_, y) => y).filter(y => y % 32 !== 0 && y % 32 !== 31)
      const out = canvas(c.w, rows.length, R.wall)
      rows.forEach((y, i) => out.px.set(c.px.subarray(y * c.w, (y + 1) * c.w), i * c.w))
      return out
    })
  },
  focus: (d, opt) => {
    if (opt?.width !== undefined && opt.width < OFFICE_W) {
      const l = officeLayout(d, opt.width)
      return { x: 0, y: 0, w: l.width, h: l.height }
    }
    return { x: 0, y: 34, w: OFFICE_W, h: 44 }
  },
  hotspots: (d, opt) => d.agents.map(a => {
    const bay = opt?.width === undefined ? undefined : officeLayout(d, opt.width).desks.find(x => x.provider === a.provider)
    const peers = d.agents.filter(b => b.provider === a.provider), i = peers.indexOf(a)
    const x = bay?.x ?? DESK_X[a.provider], w = bay?.w ?? deskWidth(a.provider)
    return { x: x + Math.floor(i * w / peers.length), y: 34 + (bay?.y ?? 0), w: Math.floor((i + 1) * w / peers.length) - Math.floor(i * w / peers.length), h: 37,
      title: `${PROVIDER_NAMES[a.provider]} · ${a.model}${a.effort ? ` · ${a.effort}` : ''}\n${a.label} · ${a.state}` }
  }),
}
