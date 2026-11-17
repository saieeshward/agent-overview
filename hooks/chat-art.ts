import type { Provider } from '../types'
import { C, SPR } from './office-rail'
import { DESKS } from './vibe/office'

// SVG sources for the approved chat look (chat-style-picks-r7), ported from its canvas and HTML helpers.
// Edge strips are long images their Box crops; `slice` keeps them 1:1 where the host would shrink them to fit.
export const svg = (w: number, height: number, inner: string, align = 'xMinYMin') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" preserveAspectRatio="${align} slice" shape-rendering="crispEdges">${inner}</svg>`
const rc = (x: number, y: number, w: number, height: number, c: string, kids = '') => `<rect x="${x}" y="${y}" width="${w}" height="${height}" fill="${c}">${kids}</rect>`
const anim = (attr: string, values: string, dur: string, more = '') => `<animate attributeName="${attr}" values="${values}" dur="${dur}" calcMode="discrete" repeatCount="indefinite"${more}/>`
const move = (values: string, dur: string) => `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}" calcMode="discrete" repeatCount="indefinite"/>`
const at = (x: number, y: number, inner: string, motion = '') => `<g transform="translate(${x} ${y})">${motion}${inner}</g>`
const steps = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join(';')
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
function spr(rows: string[], map: Record<string, string>, s: number, ox = 0, oy = 0) {
  let o = ''
  rows.forEach((r, j) => { for (let i = 0; i < r.length;) { let k = i; while (r[k] === r[i]) k++; if (map[r[i]!]) o += rc(ox + i * s, oy + j * s, (k - i) * s, s, map[r[i]!]!); i = k } })
  return o
}
// The page's 3x5 pixel font: capitals, digits and the middle dot.
const FONT5: Record<string, string> = { A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', I: '111010010010111', K: '101101110101101', N: '110101101101101', O: '010101101101010', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', X: '101101010101101', '·': '000000010000000',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '111001011001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111' }
function pixText(s: string, x: number, y: number, c: string) {
  let o = ''
  for (const ch of s) { if (ch !== ' ') [...FONT5[ch] ?? ''].forEach((b, i) => { if (b === '1') o += rc(x + i % 3 * 2, y + Math.floor(i / 3) * 2, 2, 2, c) }); x += ch === ' ' ? 4 : 8 }
  return o
}

// Vibe frame `tb-underline`: a 22 px title bar with ants on its underline, 2 px sides, 2x2 corner cut-outs.
export const VIBE = { bg: '#211d2a', line: '#8b5cf6', fill: '#302647', title: '#a99fc4', chat: '#262624' }
export const fill = (w: number, height: number, c: string, align?: string) => svg(w, height, rc(0, 0, w, height, c), align)
export const titleBar = (title: string) => svg(4000, 22, rc(0, 0, 4000, 2, VIBE.line) + rc(0, 2, 4000, 18, VIBE.fill)
  + `<line x1="0" y1="21" x2="4000" y2="21" stroke="${VIBE.line}" stroke-width="2" stroke-dasharray="4 4">${anim('stroke-dashoffset', '0;-2;-4;-6', '0.8s')}</line>` + pixText(title, 16, 6, VIBE.title))
// The left border under the tail opens into the title bar.
export const JOIN = svg(2, 22, rc(0, 6, 2, 10, VIBE.fill))
export const TAIL = svg(8, 22, spr(['....', '....', '...L', '..LT', '.LTT', 'LTTT', '.LTT', '..LT', '...L', '....', '....'], { L: VIBE.line, T: VIBE.fill }, 2))
// You: a grey Clawd that blinks every 4 s, a pixel lower so it centres on the 22 px bar.
export const AVATAR = svg(22, 22, at(0, 1, spr(SPR.claude.rows, { O: '#b9b2a8', k: '#23211f' }, 2)
  + [4, 12].map(x => `<rect x="${x}" y="8" width="2" height="4" fill="#b9b2a8" opacity="0">${anim('opacity', '0;1', '4s', ' keyTimes="0;0.9625"')}</rect>`).join('')))

// Work ticket: dashed 1 px edges and corners rounded over the chat background.
export const dashed = (vertical: boolean, c: string, align?: string) => vertical
  ? svg(1, 4000, `<line x1="0.5" y1="0" x2="0.5" y2="4000" stroke="${c}" stroke-dasharray="3 3"/>`, align)
  : svg(4000, 1, `<line x1="0" y1="0.5" x2="4000" y2="0.5" stroke="${c}" stroke-dasharray="3 3"/>`, align)
const TURN = { tl: '', tr: 'matrix(-1 0 0 1 4 0)', br: 'matrix(-1 0 0 -1 4 4)', bl: 'matrix(1 0 0 -1 0 4)' }
export const rounded = (k: keyof typeof TURN, c: string, bg: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><g transform="${TURN[k]}"><path d="M0 0H4V.5A3.5 3.5 0 0 0 .5 4H0Z" fill="${bg}"/><path d="M.5 4A3.5 3.5 0 0 1 4 .5" fill="none" stroke="${c}"/></g></svg>`

// Sprite chips: the provider bobbing, a blinking prompt or a file, then the word in mono.
export type Kind = 'mention' | 'command' | 'file'
export type Token = { kind: Kind; text: string; p?: Provider }
export const LIGHT: Record<Provider, string> = { claude: '#f0a58a', codex: '#5fd0ac', antigravity: '#9ac8f5', opencode: '#c4b0ff', commandcode: '#f2c46b', ollama: '#e9b8f0' }
export const TK = { command: { c: '#f2c46b', s: '#e0a030' }, file: { c: '#9ac8f5', s: '#4c8df6' } }
export const tint = (t: Token) => t.kind === 'mention' ? { c: LIGHT[t.p!], s: C[t.p!] } : TK[t.kind]
export const chipWidth = (text: string) => 26 + Math.ceil(text.length * 7.22)
export function spriteChip(t: Token) {
  const { c, s } = tint(t), w = chipWidth(t.text)
  const icon = t.kind === 'mention' ? `<g>${move('0,0;0,-1', '0.6s')}${spr(SPR[t.p!].rows.slice(t.p === 'claude' ? 2 : 1, t.p === 'claude' ? 10 : 9), SPR[t.p!].map, 2, 0, 2)}</g>`
    : t.kind === 'command' ? spr(['C...', '.C..', '..C.', '.C..', 'C...'], { C: c }, 2, 1, 5) + rc(10, 13, 6, 2, c, anim('opacity', '1;0', '1s'))
      : spr(['FFF.', 'FFFF', 'F..F', 'FFFF', 'F..F', 'FFFF'], { F: c }, 2, 2, 4)
  return svg(w, 20, rc(0, 1, w, 18, `${s}2a`) + icon + `<text x="22" y="14" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="${c}">${esc(t.text)}</text>`)
}

// Vibe dividers on a 160 x 20 grid (drawn at 2x). `live` animates; otherwise one still frame mid-run.
const W = 160
const GHOST = ['.ccccc.', 'ccccccc', 'cwwcwwc', 'cwkcwkc', 'ccccccc', 'ccccccc', 'c..c..c']
export function chase(ran: Provider[], live: boolean) {
  // Clawd's head walks -20..199 in 220 steps over 10 s, eating the pellets from 8 px ahead to 120 px behind it.
  const k0 = live ? 0 : 120
  let o = rc(0, 18, W, 1, '#2f3a8a')
  for (let x = 4; x < W; x += 8) {
    const a = (x + 12) / 220, b = (x + 141) / 220
    if (live) o += rc(x, 11, 2, 2, '#f0d9a8', anim('opacity', b < 1 ? '1;0;1' : '1;0', '10s', ` keyTimes="0;${+a.toFixed(4)}${b < 1 ? `;${+b.toFixed(4)}` : ''}"`))
    else if (k0 < x + 12 || k0 > x + 140) o += rc(x, 11, 2, 2, '#f0d9a8')
  }
  const clawd = at(0, 6, at(0, 0, spr(SPR.claude.rows.slice(3), SPR.claude.map, 1), live ? move('0,0;0,-1', '0.2s') : ''))
  const ghosts = ran.map((p, i) => at(-22 - i * 16, 6, at(0, live ? 0 : i % 2, spr(GHOST, { c: C[p], w: '#ffffff', k: '#1a1a1a' }, 1), live ? move(i % 2 ? '0,1;0,0' : '0,0;0,1', '0.333s') : ''))).join('')
  return svg(W, 20, o + at(k0 - 20, 0, clawd + ghosts, live ? move(steps(220, k => `${k - 20},0`), '10s') : ''))
}
export function boat(work: number, live: boolean) {
  // 9 px/s when the turn did nothing, up to 27 px/s for six or more runs and edits.
  const k0 = live ? 0 : 110, dur = `${+(230 / (9 + 3 * Math.min(work, 6))).toFixed(3)}s`
  let o = rc(0, 13, W, 7, '#1d2d4a')
  for (let j = 0; j < W / 5; j++) {
    const shown = [0, 1, 2, 3].map(m => (m + j) % 4 ? 0 : 1)
    if (live) o += rc(5 * j, 14 + 5 * j % 3, 3, 1, '#4f6fa8', anim('opacity', shown.join(';'), '1.333s'))
    else if (shown[0]) o += rc(5 * j, 14 + 5 * j % 3, 3, 1, '#4f6fa8')
  }
  const hull = rc(0, 11, 62, 3, '#7a5236') + rc(2, 14, 58, 1, '#5a3a26') + rc(-2, 10, 4, 3, '#7a5236') + rc(60, 10, 4, 3, '#7a5236')
  const crew = DESKS.map((p, i) => spr(SPR[p].rows.slice(p === 'claude' ? 3 : 0, p === 'claude' ? 9 : 6), SPR[p].map, 1, 3 + i * 12, 5)).join('')
  const oars = [8, 52].map(x => rc(x, 12, 1, 4, '#c9a26b', live ? anim('y', '12;13', '0.667s') : '')).join('')
  return svg(W, 20, o + at(k0 - 66, 0, hull + crew + oars, live ? move(steps(230, k => `${k - 66},0`), dur) : ''))
}
