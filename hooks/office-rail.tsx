import { atom, read } from 'claude-code'
import type { AgentNode, ChatSettings, EditItem, MainInfo, Provider, Routing, Ui } from '../types'
import { displayAgents } from './babysitter'
import { stateOf } from './graph'
import { defaultRouting, normalGuard, providerOf } from './state'
import { DESKS } from './vibe/office'
import { OFFICE_ACCENTS, OFFICE_CAST, PALETTE, ROOM } from './vibe/engine'
import type { $, E } from './ui'

const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const color = (index: number) => `#${PALETTE[index]!.toString(16).padStart(6, '0')}`
export const C = Object.fromEntries(DESKS.map(p => [p, color(OFFICE_CAST[p])])) as Record<Provider, string>
const wall = color(ROOM.wall), desk = color(ROOM.desk), outline = color(ROOM.outline)

// Approved 9x10 reductions of the office MASCOTS, from chat-style-picks-r6 section 1.
export const SPR: Record<Provider, { rows: string[]; map: Record<string, string> }> = {
  claude: { rows: ['.........', '.........', '.........', '.OOOOOOO.', '.OkOOOkO.', '.OkOOOkO.', 'OOOOOOOOO', '.OOOOOOO.', '.O.O.O.O.', '.O.O.O.O.'], map: { O: C.claude, k: color(OFFICE_ACCENTS.eye) } },
  codex: { rows: ['....a....', '..TTTTT..', '.TdddddT.', 'hTdcdddTh', 'hTddcddTh', '.TdcdddT.', '..TTTTT..', '...TTT...', '..TTTTT..', '..T...T..'], map: { T: C.codex, d: '#11231d', c: '#9be8c9', h: '#7d8590', a: '#c9d1d9' } },
  antigravity: { rows: ['..WWWWW..', '.WWWWWWW.', '.WVVVVVW.', '.WVvVVVW.', '.WWWWWWW.', '..BBBBB..', '.BBBwBBB.', '.BBBBBBB.', '..BB.BB..', '..W...W..'], map: { W: '#e8edf5', V: '#2f5fb3', v: '#8fb4f5', B: '#5b8ff0', w: '#ffffff' } },
  opencode: { rows: ['....P....', '...PPP...', '..PPPPP..', '.hPdddPh.', '.hPedePh.', '..PPPPP..', '.PPPPPPP.', '.PPPPPPP.', '..PP.PP..', '..d...d..'], map: { P: C.opencode, d: '#1c1530', e: '#d7caff', h: '#9ca3af' } },
  commandcode: { rows: ['...YYY...', '..YYYYY..', '.YYYYYYY.', '..sssss..', '..sksks..', '..sssss..', '.OOOOOOO.', 'OOtttttOO', '.OOO.OOO.', '.O.....O.'], map: { Y: '#f2b632', s: '#e8e6e3', k: color(OFFICE_ACCENTS.eye), O: '#d89a2e', t: '#6b4a2b' } },
}
const rect = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
const sprite = (p: Provider) => SPR[p].rows.map((row, y) => [...row].map((c, x) => SPR[p].map[c] ? rect(x, y, 1, 1, SPR[p].map[c]!) : '').join('')).join('')
const monitor = (x: number, y: number, on: boolean, p: Provider) => rect(x, y, 6, 5, outline) + rect(x + 1, y + 1, 4, 3, on ? C[p] : '#283039') + rect(x + 2, y + 5, 2, 1, '#3a3835')
const loungeKit = (fy: number) => rect(3, fy - 11, 5, 11, outline) + rect(4, fy - 10, 3, 2, '#e06c5f')
  + rect(12, fy - 5, 20, 5, '#5a4b5e') + rect(12, fy - 8, 3, 8, '#5a4b5e') + rect(29, fy - 8, 3, 8, '#5a4b5e')
  + rect(35, fy - 7, 3, 7, '#5a7a4a') + rect(34, fy - 10, 5, 4, '#6f9a5a')

export function officeStates(r: Routing, m: MainInfo, raw: AgentNode[], changed: EditItem[] = []) {
  const list = displayAgents(raw, changed)
  return DESKS.map(p => !r.on[p] || r.paused?.[p] ? 'off' : (p === 'claude' ? m.working
    : list.some(n => n.kind !== 'workflow' && (n.provider ?? providerOf(n.model)) === p && stateOf(n, list) === 'running')) ? 'working' : 'idle')
}
type OfficeStates = ReturnType<typeof officeStates>
// The approved rail: a 192 x 20 (Slim) or 192 x 30 (Glass) pixel scene the host scales to the band's width.
const W = 192, CELL = 30, LOUNGE = 150
const round = (n: number) => +n.toFixed(3)
const STEPS = 120, PERIOD = 2 / .17
const times = Array.from({ length: STEPS + 1 }, (_, f) => round(f / STEPS)).join(';')
const move = (values: string[], dur: number, keyTimes: string) =>
  `<animateTransform attributeName="transform" type="translate" values="${values.join(';')}" keyTimes="${keyTimes}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"/>`

function actor(p: Provider, i: number, working: boolean, glass: boolean) {
  const home = i * CELL + 10, seat = glass ? 12 : 4
  if (working) {
    const a = `${home} ${seat - i % 2}`, b = `${home} ${seat - (1 - i % 2)}`
    return `<g transform="translate(${a})">${move([a, b, a], .4, '0;0.5;1')}${sprite(p)}</g>`
  }
  // place(): walk to a lounge spot of its own, linger, walk back.
  const frames = Array.from({ length: STEPS + 1 }, (_, f) => {
    const t = f === STEPS ? 0 : f / STEPS * PERIOD, tt = (t * .17 + i * .29) % 2
    const k = Math.min(1, (tt < 1 ? tt : 2 - tt) * 1.7)
    return `${Math.round(home + (LOUNGE + 2 + i * 8 - home) * k)} ${k >= 1 ? (glass ? 14 : 8) : seat - (k > 0 ? Math.floor(t * 6) % 2 : 0)}`
  })
  return `<g transform="translate(${frames[0]})">${move(frames, PERIOD, times)}${sprite(p)}</g>`
}

// Section 0 of chat-style-picks-r8: two CSS pixels per art pixel, without stretching the mascots.
const HEIGHTS = { heads: 20, dock: 24, peek: 16, line: 24, ticker: 20 } as const
type AgentsStyle = keyof typeof HEIGHTS
const grey = (c: string) => {
  const n = parseInt(c.slice(1), 16), v = Math.round(((n >> 16 & 255) * .3 + (n >> 8 & 255) * .59 + (n & 255) * .11) * .55 + 30)
  return `rgb(${v},${v},${v + 4})`
}
const rowsOf = (p: Provider) => p === 'claude' ? SPR[p].rows.slice(3) : SPR[p].rows
const mapOf = (p: Provider, dim: boolean) => dim ? Object.fromEntries(Object.entries(SPR[p].map).map(([k, c]) => [k, grey(c)])) : SPR[p].map
const agentSprite = (p: Provider, dim: boolean, heads = false) => {
  const map = mapOf(p, dim), rows = heads ? rowsOf(p).slice(0, 7) : rowsOf(p)
  return rows.map((row, y) => [...row].map((c, x) => map[c] ? rect(x, y, 1, 1, map[c]!) : '').join('')).join('')
}
const sampled = (steps: number, at: (f: number) => string) => Array.from({ length: steps + 1 }, (_, f) => at(f === steps ? 0 : f / steps))
const keyTimes = (steps: number) => Array.from({ length: steps + 1 }, (_, f) => round(f / steps)).join(';')
const translate = (x: number, y: number, art: string, motion = '') => `<g transform="translate(${x} ${y})">${motion}${art}</g>`

function agentsSvg(style: AgentsStyle, states: OfficeStates, pixelWidth: number) {
  const h = HEIGHTS[style] / 2, full = style === 'line' || style === 'ticker'
  const width = Math.max(60, Math.round(pixelWidth / 2)), live = DESKS.filter((_, i) => states[i] !== 'off')
  const on = (p: Provider) => states[DESKS.indexOf(p)] === 'working'
  const tag = (p: Provider, art: string) => `<g data-provider="${p}" data-state="${on(p) ? 'working' : 'idle'}">${art}</g>`
  let art = ''
  if (style === 'heads') {
    art = rect(0, h - 1, 500, 1, '#3a3835') + live.map((p, i) => {
      const x = 6 + i * 14, y = 1 - (on(p) ? i % 2 : 0)
      return tag(p, translate(x, y, agentSprite(p, !on(p), true), on(p) ? move([`${x} ${y}`, `${x} ${1 - y}`, `${x} ${y}`], .5, '0;0.5;1') : '')
        + (on(p) ? rect(x + 1, h - 1, 7, 1, C[p]) : ''))
    }).join('')
  } else if (style === 'dock') {
    const w = live.length * 14 + 6, x0 = Math.round((500 - w) / 2)
    art = rect(x0, h - 3, w, 2, '#2c2a33') + rect(x0, h - 3, w, 1, '#3d3a46') + live.map((p, i) => {
      const x = x0 + 5 + i * 14, y = h - 3 - rowsOf(p).length
      const hop = (t: number) => (t * .5 + i * .37) % 3 < .25 ? 2 : 0
      const frames = sampled(120, f => `${x} ${y - hop(f * 6)}`)
      return tag(p, translate(x, y - (on(p) ? hop(0) : 0), agentSprite(p, !on(p)), on(p) ? move(frames, 6, keyTimes(120)) : '')
        + (on(p) ? rect(x + 4, h - 1, 1, 1, C[p]) : ''))
    }).join('')
  } else if (style === 'peek') {
    art = `<svg width="500" height="${h - 1}" overflow="hidden">` + live.map((p, i) => {
      const x = 10 + i * 13, y = h - (on(p) ? 7 - i % 2 : 4)
      const blink = on(p) ? `<rect x="1" y="${p === 'claude' ? 1 : 3}" width="7" height="1" fill="${Object.values(SPR[p].map)[0]}"><animate attributeName="opacity" values="1;0;1" keyTimes="0;0.166667;1" dur="${6 / 1.3}s" begin="${-i / 1.3}s" calcMode="discrete" repeatCount="indefinite"/></rect>` : ''
      return tag(p, translate(x, y, agentSprite(p, !on(p)) + blink, on(p) ? move([`${x} ${y}`, `${x} ${3 - y}`, `${x} ${y}`], 2 / 3, '0;0.5;1') : ''))
    }).join('') + '</svg>' + rect(0, h - 1, 500, 1, '#45423e')
  } else if (style === 'line') {
    art = `<rect y="${h - 1}" width="100%" height="1" fill="#3a3835"/>` + live.map((p, i) => {
      const y = h - 1 - rowsOf(p).length, first = on(p) ? i % 2 : 0
      const bob = move([`0 ${y - first}`, `0 ${y - (1 - first)}`, `0 ${y - first}`], on(p) ? .4 : .5, '0;0.5;1')
      const stroll = (f: number) => Math.round(Math.sin(f * Math.PI * 2 + i) * Math.min(18, width / live.length / 3))
      const frames = sampled(240, f => `${-4 + stroll(f)} 0`)
      const body = translate(0, y - first, agentSprite(p, !on(p)), bob)
        + (on(p) ? rect(10, h - 4, 5, 3, '#1e1e24') + rect(11, h - 4, 3, 2, C[p]) : '')
      return tag(p, `<svg x="${(i + .5) * 100 / live.length}%" width="1" height="${h}" overflow="visible">`
        + translate(-4 + (on(p) ? 0 : stroll(0)), 0, body, on(p) ? '' : move(frames, Math.PI * 2 / .6, keyTimes(240))) + '</svg>')
    }).join('')
  } else {
    const busy = live.filter(on), gap = Math.max(60, Math.round(width / Math.max(1, busy.length))), span = width + 30
    art = busy.length ? busy.map((p, i) => {
      const steps = Math.min(span, 600), positions = sampled(steps, f => `${round(Math.round(width - (f * span + i * gap) % span) / width * 100)}%`)
      const trail = [1, 2, 3].map(k => rect(9 + k * 3, h - 4, 2, 1, C[p] + ['', 'cc', '88', '44'][k])).join('')
      const y = h - rowsOf(p).length, first = i % 2
      return tag(p, `<svg x="${positions[0]}" width="1" height="${h}" overflow="visible"><animate attributeName="x" values="${positions.join(';')}" keyTimes="${keyTimes(steps)}" dur="${span / 14}s" calcMode="discrete" repeatCount="indefinite"/>`
        + trail + translate(0, y - first, agentSprite(p, false), move([`0 ${y - first}`, `0 ${y - (1 - first)}`, `0 ${y - first}`], 1 / 3, '0;0.5;1')) + '</svg>')
    }).join('') : live.includes('claude') ? tag('claude', translate(6, h - 7, agentSprite('claude', true))) : ''
  }
  const viewport = full ? '' : ` viewBox="0 0 1000 ${h * 2}" preserveAspectRatio="${style === 'dock' ? 'xMidYMin' : 'xMinYMin'} slice"`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${h * 2}"${viewport} shape-rendering="crispEdges"><g transform="scale(2)">${full ? `<svg width="50%" height="${h}" overflow="hidden">${art}</svg>` : art}</g></svg>`
}

export function officeSvg(style: Exclude<ChatSettings['office'], 'off'>, states: OfficeStates, pixelWidth = 1000) {
  if (style !== 'slim' && style !== 'glass') return agentsSvg(style, states, pixelWidth)
  const glass = style === 'glass', h = glass ? 30 : 20, fy = glass ? 26 : 18, on = (i: number) => states[i] === 'working'
  const back = rect(0, 0, W, h, glass ? '#1d1c24' : wall) + (glass ? rect(0, fy, W, 4, '#2c2a33') : rect(0, 0, W, 1, '#5a4535'))
    + `<g transform="translate(${LOUNGE} 0)">${loungeKit(fy)}</g>`
  const desks = DESKS.map((p, i) => `<g data-provider="${p}" data-state="${states[i]}">` + (glass
    ? rect(i * CELL + 3, fy - 5, CELL - 5, 2, desk) + monitor(i * CELL + 19, fy - 12, on(i), p)
    : monitor(i * CELL + 20, 6, on(i), p) + rect(i * CELL + 9, 1, 12, 1, on(i) ? C[p] : '#3a3743')) + '</g>').join('')
  const actors = DESKS.map((p, i) => states[i] === 'off' ? '' : actor(p, i, on(i), glass)).join('')
  const front = glass
    ? DESKS.map((p, i) => rect(i * CELL + 1, 3, CELL - 1, fy - 3, on(i) ? `${C[p]}30` : '#ffffff08')
      + (i ? rect(i * CELL, 3, 1, fy - 3, '#8a857d') : '') + rect(i * CELL + 3, 4, 1, 7, '#ffffff1e')).join('')
      + rect(LOUNGE, 3, 1, fy - 3, '#8a857d') + rect(0, 0, W, 3, '#9a9590') + rect(0, 3, W, 1, '#00000040')
    : rect(0, 12, LOUNGE, 8, desk) + rect(0, 12, LOUNGE, 1, '#8a7563') + DESKS.map((_, i) => rect(i * CELL, 13, 1, 7, '#584a3f')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 10}" height="${h * 10}" viewBox="0 0 ${W} ${h}" shape-rendering="crispEdges">${back}${desks}${actors}${front}</svg>`
}

export async function officeRail($: $, E: E) {
  const chat = normalGuard(await read($, guard)).chat, style = chat.office
  if (style === 'off') return null
  const preset = chat.railPreset ? (await read($, ui)).preset?.name ?? 'Custom' : undefined
  const states = officeStates(await read($, routing), await read($, main), await read($, nodes), await read($, edits))
  // Slim/Glass keep their original sizing; the agents-only rails use fixed CSS-pixel heights.
  return <E.Box key="chat:office" position="relative" flexDirection="column" justifyContent="flex-start" alignItems="stretch" width="100%">
    {style === 'slim' || style === 'glass'
      ? <E.Svg source={officeSvg(style, states)} alt={`${style === 'glass' ? 'Glass wall' : 'Slim rail'} provider office`}/>
      : <E.Svg source={officeSvg(style, states, E.pixelWidth)} width={2000} height={HEIGHTS[style]} alt={`${style[0]!.toUpperCase() + style.slice(1)} provider office`}/>}
    {preset ? <E.Box key="chat:office:preset" position="absolute" top={0} right={1}><E.Text size="caption" mono color="#a19c94">{preset}</E.Text></E.Box> : null}
  </E.Box>
}
