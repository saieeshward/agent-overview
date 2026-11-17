import type { DecisionItem, Motion, Provider, StageId, VibeEvent, RoutingTag, VibeStyle } from '../../types'

export const W = 128, H = 72
export const FPS: Record<Motion, number> = { full: 12, calm: 4, still: 0 }
export const SVG_MAX = 131072
export const PALETTE: readonly number[] = [
  0x000000, 0x1D2B53, 0x7E2553, 0x008751, 0xAB5236, 0x5F574F, 0xC2C3C7, 0xFFF1E8,
  0xFF004D, 0xFFA300, 0xFFEC27, 0x00E436, 0x29ADFF, 0x83769C, 0xFF77A8, 0xFFCCAA,
  0xD97757, 0x10A37F, 0x4C8DF6, 0x8B5CF6, 0xE0A030, 0x0B0E1A, 0x2B2F4A, 0x87CEEB,
  0xF4A261, 0x3A2E26, 0x6B4F3A, 0x9C7A54, 0x22252E, 0x30343F, 0x111318, 0xE6E6E6,
  0xD8B995, 0xEAD5B5, 0xB95740, 0x08745F, 0x2853A4, 0x553499, 0xA66A12, 0xE7BD58,
  0xFFF0B7, 0x486540, 0x799452, 0x9C8068,
  0xE6E6E6, 0x0B0B0B, // Theme-aware INK and PAPER.
  0x2B2A33, 0x34333D, 0x3D3A40, 0x4A4650, 0x6B5B4E, 0x7D6B5C, 0x1E1E24,
  0xC9D2E0, 0xD0B48C, 0xBE8077, 0x94AF98, 0x8FB3C9, 0xD9A07E, 0x1F2A44,
  0xD97757, 0x10A37F, 0x4C8DF6, 0x8B5CF6, 0xE0A030, 0x1A1A1A, 0x554667,
  0xE2C5BC, 0xA6D2C7, 0xB8CBEB, 0xCBBCEA, 0xE4D1B0, // 30 percent brand tint in warm white.
]
export const C = {
  black: 0, navy: 1, plum: 2, green: 3, brown: 4, darkGrey: 5, lightGrey: 6, white: 7,
  red: 8, orange: 9, yellow: 10, lime: 11, blue: 12, lavender: 13, pink: 14, peach: 15,
  claude: 16, codex: 17, antigravity: 18, opencode: 19, commandcode: 20, nightSky: 21,
  duskSky: 22, daySky: 23, sunset: 24, woodDark: 25, wood: 26, woodLight: 27, wall: 28,
  wallLight: 29, shadow: 30, paper: 31,
  INK: 44, PAPER: 45,
  wallpaper: 32, wallpaperLight: 33, claudeDark: 34, codexDark: 35, agyDark: 36,
  opencodeDark: 37, cmdDark: 38, gold: 39, cream: 40, leafDark: 41, leaf: 42, wallpaperDark: 43,
} as const
// Fourteen room colours, shared by furniture, faces, code and time-of-day skies.
export const ROOM = { wall: 46, lower: 47, floor: 48, edge: 49, desk: 50, top: 51, outline: 52,
  light: 53, gold: 54, red: 55, green: 56, day: 57, sunset: 58, night: 59 } as const
// Ollama has no desk or brand slot of its own in the scenes: it borrows the base palette's lavender.
export const OFFICE_CAST: Record<Provider, number> = { claude: 60, codex: 61, antigravity: 62, opencode: 63, commandcode: 64, ollama: C.lavender }
export const OFFICE_ACCENTS = { eye: 65, glow: 66 } as const
// Claude Code's banner, with each quadrant row doubled vertically.
export const CLAWD = [
  '..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..', '..OOkOOOOOOkOO..', '..OOkOOOOOOkOO..',
  'OOOOOOOOOOOOOOOO', 'OOOOOOOOOOOOOOOO', '..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..',
  '...O.O....O.O...', '...O.O....O.O...',
]
export const PROVIDER_NAMES: Record<Provider, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', opencode: 'OpenCode', commandcode: 'Command Code', ollama: 'Ollama' }
export const TERMINAL_DEFAULT = 0x01000000
export type HudSegment = { text: string; color?: string; bold?: boolean; dim?: boolean }
export type HudLine = HudSegment[]
export const DIM: Record<number, number> = Object.fromEntries(PALETTE.map((_, i) => [i, ({
  [C.white]: C.lightGrey, [C.paper]: C.lavender, [C.wallpaperLight]: C.wallpaperDark,
  [C.wallpaper]: C.wallpaperDark, [C.wallpaperDark]: C.wood, [C.cream]: C.woodLight,
  [C.claude]: C.claudeDark, [C.codex]: C.codexDark, [C.antigravity]: C.agyDark,
  [C.opencode]: C.opencodeDark, [C.commandcode]: C.cmdDark, [C.gold]: C.cmdDark,
  [C.woodLight]: C.wood, [C.wood]: C.woodDark, [C.woodDark]: C.shadow,
  [C.yellow]: C.gold, [C.lime]: C.green, [C.blue]: C.navy, [C.leaf]: C.leafDark,
} as Record<number, number>)[i] ?? i]))
export const CAST: Record<Provider, number> = { claude: C.claude, codex: C.codex, antigravity: C.antigravity, opencode: C.opencode, commandcode: C.commandcode, ollama: C.lavender }
// A frame: PALETTE indices, row-major.
export type Canvas = { w: number; h: number; px: Uint8Array }
// String-art rows; each char maps to a PALETTE index, ' ' and '.' are transparent.
export type Sprite = { rows: string[]; map: Record<string, number> }
// A hover tooltip on the desktop SVG, in canvas pixels.
export type Focus = { x: number; y: number; w: number; h: number }
export type Hotspot = Focus & { title: string }
export type SceneOpt = { motion: Motion; width?: number; maxRows?: number }
// frames() returns one animation loop, played at FPS[opt.motion]; still plays frames[0] only.
export type Scene = { id: VibeStyle; name: string; key?(d: VibeData): unknown; frames(d: VibeData, opt: SceneOpt): Canvas[]; hud?(d: VibeData, w: number): { top: HudLine[]; bottom: HudLine[] }; hotspots?(d: VibeData, opt?: Pick<SceneOpt, 'width'>): Hotspot[]; focus?(d: VibeData, opt?: Pick<SceneOpt, 'width'>): Focus }
export type VibeAgent = { id: string; label: string; provider: Provider; model: string; effort?: string; state: 'running' | 'done' | 'failed'; startedAt?: number; endedAt?: number; steps: number; lastTool?: string; tokens?: number }
export type VibeAct = { tool: string; title: string; state: 'running' | 'done' | 'failed'; at: number; kind: 'bash' | 'test' | 'edit' | 'other'; tests?: 'pass' | 'fail' }
// percent is quota used, 0-100; out means it ran out.
export type VibeUsage = { provider: Provider; on: boolean; percent: number; out: boolean; tag: RoutingTag; known?: boolean; age?: string; estimate?: boolean }
export type VibeData = {
  events?: VibeEvent[]
  stage?: StageId | null
  sessionStartedAt?: number
  lastFailAt?: number
  lastTest?: 'pass' | 'fail'
  pendingCommits?: number
  finishedTasks?: number
  visualChecks?: number
  lastPushAt?: number
  now: number // ms epoch
  hour: number // local hour 0-23: day, sunset or night
  main: { model: string; effort?: string; working: boolean; lastTool?: string; waiting: boolean } // waiting: Claude waits on the owner
  agents: VibeAgent[]
  edit: { file: string; added: number; removed: number; provider: Provider } | null // the live edit
  acts: VibeAct[] // recent tool calls, newest last, at most 12
  tests: 'pass' | 'fail' | null // the latest test run's outcome
  decisions: DecisionItem[] // newest last
  usage: VibeUsage[]
  cost: number // session dollars
  ctx: number // context window used, percent
  commits: number // this session
  pushes: number // this session
  combo: number // consecutive successful tool calls
  idle: number // seconds since anything happened
  tps: number // tokens per second now
  lines: number // lines changed this session, added + removed
  findings: number // open review findings
  best: number // best `lines` seen: the HI-SCORE
}

export const highDecision = (d: VibeData) => [...d.decisions].reverse().find(a => a.impact === 'high' && a.at <= d.now && d.now - a.at < 60000)
export function quotaHud(d: VibeData, w: number, colors = CAST, upper = false): HudLine[] {
  const rows: HudLine[] = []
  let row: HudLine = [], length = 0
  for (const u of d.usage.filter(u => u.on)) {
    const left = Math.max(0, Math.min(100, 100 - u.percent))
    const n = u.out ? 0 : Math.round(left / 25)
    const name = upper ? PROVIDER_NAMES[u.provider].toUpperCase() : PROVIDER_NAMES[u.provider]
    const text = ` ${'▮'.repeat(n)}${'▯'.repeat(4 - n)} ${u.estimate ? '≈' : ''}${Math.round(left)}%${u.age ? ` · ${u.age}` : ''}`
    if (length && length + name.length + text.length + 2 > w) { rows.push(row); row = []; length = 0 }
    if (length) { row.push({ text: '  ' }); length += 2 }
    row.push({ text: name, color: `#${PALETTE[colors[u.provider]]!.toString(16).padStart(6, '0')}` }, { text })
    length += name.length + text.length
  }
  if (row.length) rows.push(row)
  return rows
}

export function canvas(w = W, h = H, fill: number = C.black): Canvas {
  w = Math.max(1, Math.floor(w))
  h = Math.max(1, Math.floor(h))
  return { w, h, px: new Uint8Array(w * h).fill(fill) }
}
export function clone(c: Canvas): Canvas { return { w: c.w, h: c.h, px: c.px.slice() } }
export function remap(c: Canvas, x: number, y: number, w: number, h: number, table: Record<number, number>): void {
  x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h)
  for (let yy = Math.max(0, y); yy < Math.min(c.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(c.w, x + w); xx++) {
    const at = yy * c.w + xx, i = c.px[at]!
    c.px[at] = table[i] ?? i
  }
}
export function pixel(c: Canvas, x: number, y: number, i: number): void {
  x = Math.floor(x); y = Math.floor(y)
  if (x >= 0 && x < c.w && y >= 0 && y < c.h) c.px[y * c.w + x] = i
}
export function rect(c: Canvas, x: number, y: number, w: number, h: number, i: number): void {
  x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h)
  const left = Math.max(0, x), right = Math.min(c.w, x + w)
  if (right <= left) return
  for (let row = Math.max(0, y); row < Math.min(c.h, y + h); row++) c.px.fill(i, row * c.w + left, row * c.w + right)
}
export function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, i: number): void {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1)
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  while (true) {
    pixel(c, x0, y0, i)
    if (x0 === x1 && y0 === y1) break
    const twice = 2 * err
    if (twice >= dy) { err += dy; x0 += sx }
    if (twice <= dx) { err += dx; y0 += sy }
  }
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
// 4x4 Bayer ordered dither: `level` (0-1) is the share of b over a.
export function dither(c: Canvas, x: number, y: number, w: number, h: number, a: number, b: number, level = 0.5): void {
  x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h)
  for (let yy = Math.max(0, y); yy < Math.min(c.h, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(c.w, x + w); xx++) pixel(c, xx, yy, BAYER[(yy % 4) * 4 + xx % 4]! < level * 16 ? b : a)
  }
}
export function sprite(c: Canvas, s: Sprite, x: number, y: number, flipX = false): void {
  const width = Math.max(0, ...s.rows.map(row => row.length))
  s.rows.forEach((row, yy) => {
    for (let xx = 0; xx < row.length; xx++) {
      const ch = row[xx]!, i = s.map[ch]
      if (ch !== ' ' && ch !== '.' && i !== undefined) pixel(c, x + (flipX ? width - 1 - xx : xx), y + yy, i)
    }
  })
}

export const FONT: Record<string, string[]> = Object.fromEntries(Object.entries({
  A: '.#./#.#/###/#.#/#.#', B: '##./#.#/##./#.#/##.', C: '.##/#../#../#../.##', D: '##./#.#/#.#/#.#/##.',
  E: '###/#../##./#../###', F: '###/#../##./#../#..', G: '.##/#../#.#/#.#/.##', H: '#.#/#.#/###/#.#/#.#',
  I: '###/.#./.#./.#./###', J: '..#/..#/..#/#.#/.#.', K: '#.#/#.#/##./#.#/#.#', L: '#../#../#../#../###',
  M: '###/###/#.#/#.#/#.#', N: '##./#.#/#.#/#.#/#.#', O: '.#./#.#/#.#/#.#/.#.', P: '##./#.#/##./#../#..',
  Q: '.#./#.#/#.#/##./.##', R: '##./#.#/##./#.#/#.#', S: '.##/#../.#./..#/##.', T: '###/.#./.#./.#./.#.',
  U: '#.#/#.#/#.#/#.#/###', V: '#.#/#.#/#.#/#.#/.#.', W: '#.#/#.#/#.#/###/###', X: '#.#/#.#/.#./#.#/#.#',
  Y: '#.#/#.#/.#./.#./.#.', Z: '###/..#/.#./#../###',
  '0': '###/#.#/#.#/#.#/###', '1': '.#./##./.#./.#./###', '2': '##./..#/.#./#../###', '3': '##./..#/.#./..#/##.',
  '4': '#.#/#.#/###/..#/..#', '5': '###/#../##./..#/##.', '6': '.##/#../###/#.#/###', '7': '###/..#/.#./.#./.#.',
  '8': '###/#.#/###/#.#/###', '9': '###/#.#/###/..#/##.',
  '.': '.../.../.../.../.#.', ',': '.../.../.../.#./#..', ':': '.../.#./.../.#./...', ';': '.../.#./.../.#./#..',
  '!': '.#./.#./.#./.../.#.', '?': '##./..#/.#./.../.#.', '-': '.../.../###/.../...', '+': '.../.#./###/.#./...',
  '/': '..#/..#/.#./#../#..', '(': '..#/.#./.#./.#./..#', ')': '#../.#./.#./.#./#..', "'": '.#./.#./.../.../...',
  '"': '#.#/#.#/.../.../...', '%': '#.#/..#/.#./#../#.#', '$': '.#./###/##./.##/.#.', '#': '#.#/###/#.#/###/#.#',
  '*': '.../#.#/.#./#.#/...', '=': '.../###/.../###/...', '<': '..#/.#./#../.#./..#', '>': '#../.#./..#/.#./#..',
  '_': '.../.../.../.../###', ' ': '.../.../.../.../...',
}).map(([ch, rows]) => [ch, rows.split('/')]))
export function textWidth(s: string): number { return Math.max(0, s.length * 4 - 1) }
export function text(c: Canvas, s: string, x: number, y: number, i: number): number {
  s.split('').forEach((ch, n) => sprite(c, { rows: FONT[ch.toUpperCase()] ?? FONT['?']!, map: { '#': i } }, x + n * 4, y))
  return textWidth(s)
}
// Terminal width for a scene: an integer multiple of its width when it fits, else the pane width.
export function fitColumns(w: number, cw = W): number { return w >= cw ? Math.floor(w / cw) * cw : w }
// Terminal Raster cells: integer scaling only; narrow or short panes crop around the scene's focus.
export function toCells(c: Canvas, columns = c.w, focus: Focus = { x: 0, y: 0, w: c.w, h: c.h }, maxRows = 256): { cells: string; columns: number; rows: number } {
  columns = Math.max(1, Math.min(512, Math.floor(columns)))
  maxRows = Math.max(1, Math.min(256, Math.floor(maxRows)))
  const scale = Math.max(1, Math.min(Math.floor(columns / c.w), Math.floor(maxRows * 2 / c.h)))
  columns = Math.min(columns, c.w * scale)
  const height = Math.min(c.h * scale, maxRows * 2), rows = Math.ceil(height / 2)
  const left = Math.max(0, Math.min(c.w - Math.ceil(columns / scale), Math.floor(focus.x + focus.w / 2 - columns / scale / 2)))
  const top = Math.max(0, Math.min(c.h - Math.ceil(height / scale), Math.floor(focus.y + focus.h / 2 - height / scale / 2)))
  const bytes = new Uint8Array(columns * rows * 12), view = new DataView(bytes.buffer)
  const index = (x: number, y: number) => c.px[(top + Math.floor(y / scale)) * c.w + left + Math.floor(x / scale)]!
  const special = (i: number) => i === C.INK || i === C.PAPER
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const at = (y * columns + x) * 12
    const upper = index(x, y * 2), lower = y * 2 + 1 < height ? index(x, y * 2 + 1) : C.PAPER
    if (special(upper) && special(lower)) {
      const glyph = upper === C.INK ? lower === C.INK ? 0x2588 : 0x2580 : lower === C.INK ? 0x2584 : 0x20
      view.setUint32(at, glyph, true)
      view.setUint32(at + 4, TERMINAL_DEFAULT, true)
      view.setUint32(at + 8, TERMINAL_DEFAULT, true)
    } else {
      // Keep theme defaults beside tinted pixels too, including a ship's transparent edge.
      const flipped = upper === C.PAPER || lower === C.INK
      const foreground = flipped ? lower : upper, background = flipped ? upper : lower
      view.setUint32(at, flipped ? 0x2584 : 0x2580, true)
      view.setUint32(at + 4, foreground === C.INK ? TERMINAL_DEFAULT : PALETTE[foreground] ?? 0, true)
      view.setUint32(at + 8, background === C.PAPER ? TERMINAL_DEFAULT : PALETTE[background] ?? 0, true)
    }
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { cells: btoa(binary), columns, rows }
}
export function toRGBA(c: Canvas, scale = 1, theme: 'dark' | 'light' = 'dark'): Uint8Array {
  scale = Math.max(1, Math.floor(scale))
  const width = c.w * scale, height = c.h * scale, bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = c.px[Math.floor(y / scale) * c.w + Math.floor(x / scale)]!
    const rgb = i === C.INK ? theme === 'light' ? 0x111111 : 0xE6E6E6 : i === C.PAPER ? theme === 'light' ? 0xFAFAFA : 0x0B0B0B : PALETTE[i] ?? 0, at = (y * width + x) * 4
    bytes[at] = (rgb >> 16) & 255; bytes[at + 1] = (rgb >> 8) & 255; bytes[at + 2] = rgb & 255; bytes[at + 3] = 255
  }
  return bytes
}

function paths(c: Canvas, base?: Canvas): string {
  type Block = { x: number; y: number; w: number; h: number; i: number }
  const blocks: Block[] = []
  let previous = new Map<string, Block>()
  for (let y = 0; y < c.h; y++) {
    const current = new Map<string, Block>()
    for (let x = 0; x < c.w;) {
      const at = y * c.w + x, i = c.px[at]!
      if (base && i === base.px[at]) { x++; continue }
      const start = x++
      while (x < c.w && c.px[y * c.w + x] === i && (!base || i !== base.px[y * c.w + x])) x++
      const w = x - start, key = `${i}:${start}:${w}`, above = previous.get(key)
      const block = above ?? { x: start, y, w, h: 0, i }
      block.h++
      if (!above) blocks.push(block)
      current.set(key, block)
    }
    previous = current
  }
  const byColor = new Map<number, string[]>()
  for (const b of blocks) {
    const runs = byColor.get(b.i) ?? []
    runs.push(`M${b.x} ${b.y}h${b.w}v${b.h}h-${b.w}z`)
    byColor.set(b.i, runs)
  }
  return [...byColor].map(([i, runs]) => `<path ${i === C.INK || i === C.PAPER ? `class="${i === C.INK ? 'ink' : 'paper'}"` : `fill="#${(PALETTE[i] ?? 0).toString(16).padStart(6, '0')}"`} d="${runs.join('')}"/>`).join('')
}
const escapeXml = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!)
// Desktop Svg source: frame 0 in full, later frames as diffs toggled by SMIL; drops frames to stay under `max`.
export function toSvg(frames: Canvas[], opt: { fps: number; scale?: number; hotspots?: Hotspot[]; max?: number }): string {
  const first = frames[0]
  if (!first) throw new RangeError('A scene needs at least one frame')
  if (frames.some(c => c.w !== first.w || c.h !== first.h)) throw new RangeError('Scene frames must have matching dimensions')
  const scale = opt.scale ?? 6, duration = opt.fps > 0 ? frames.length / opt.fps : 0
  let selected = opt.fps > 0 ? frames : [first]
  const theme = frames.some(c => c.px.includes(C.INK) || c.px.includes(C.PAPER))
    ? '<style>.ink{fill:#E6E6E6}.paper{fill:#0B0B0B}@media(prefers-color-scheme:light){.ink{fill:#111111}.paper{fill:#FAFAFA}}</style>' : ''
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${first.w} ${first.h}" width="${first.w * scale}" height="${first.h * scale}" shape-rendering="crispEdges">${theme}${paths(first)}`
  const framePaths = new Map<Canvas, string>()
  const framePath = (c: Canvas) => {
    if (!framePaths.has(c)) framePaths.set(c, paths(c, first))
    return framePaths.get(c)!
  }
  const hotspots = (opt.hotspots ?? []).map(h => `<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" fill="transparent"><title>${escapeXml(h.title)}</title></rect>`).join('')
  while (true) {
    const n = selected.length
    const times = Array.from({ length: n + 1 }, (_, i) => i / n).join(';')
    const groups = selected.slice(1).map((c, f) => {
      const values = Array.from({ length: n + 1 }, (_, i) => i === f + 1 ? 'visible' : 'hidden').join(';')
      return `<g visibility="hidden">${framePath(c)}<animate attributeName="visibility" values="${values}" keyTimes="${times}" calcMode="discrete" dur="${duration}s" repeatCount="indefinite"/></g>`
    }).join('')
    const svg = `${head}${groups}${hotspots}</svg>`
    if (svg.length <= (opt.max ?? SVG_MAX)) return svg
    if (n === 1) throw new RangeError('Static scene exceeds the SVG source limit')
    selected = selected.filter((_, i) => i % 2 === 0)
  }
}
