import { atom, read, update } from 'claude-code'
import type { Installed, Mode, Ui } from '../../types'
import type { $, E } from '../ui'
import { fit, graphicWidth, money, colorOf, nameOf, pips, IMPACT } from '../ui'
import { normalGuard } from '../state'
import { powerups, powerLabel } from './powerups'
import { toggleMode } from '../toggles'
import { FPS, fitColumns, toSvg } from './engine'
import type { Canvas } from './engine'
import { SCENES } from './scenes'
import { sceneKey, vibeData } from './data'
import { frameCells, play, stopPlayback, watchVibe } from './loop'
import { activeEvents, eventLabel } from './events'
export { eventLabel as reactionCaption } from './events'
import { arcadeEvent } from './arcade'
import { agentHud } from './office'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const installed = atom({ plugin: 'agent-overview', key: 'installed' } as const, { plugins: [], mcpServers: [], skills: 0 } as Installed)
const toggles = atom({ plugin: 'agent-overview', key: 'toggles' } as const, {} as Record<string, Mode>)
const pins = atom({ plugin: 'agent-overview', key: 'pins' } as const, [] as string[])
const pictures = new Map<string, { frames: Canvas[]; svg?: string; svgKey?: string }>()

export function wrappedRows(lengths: number[], width: number, gap = 2) {
  let rows = 0, used = 0
  for (const length of lengths) {
    if (!rows || used + gap + length > width) { rows++; used = Math.min(width, length) }
    else used += gap + length
  }
  return rows
}

export async function liveTab($: $, E: E, w: number, rows: number) {
  const [u, held] = await Promise.all([read($, ui), read($, guard)])
  const g = normalGuard(held), d = await vibeData($)
  const style = u.vibeStyle && g.vibe.styles.includes(u.vibeStyle) ? u.vibeStyle : g.vibe.styles[0]!
  const scene = SCENES[style], motion = g.vibe.motion
  const [inst, t, pinned] = await Promise.all([read($, installed), read($, toggles), read($, pins)])
  const powers = powerups(inst, pinned).filter(k => (k === 'feature:codex-images' ? g.codexImages : toggleMode(t, k)) !== 'off')
  const latest = d.decisions[d.decisions.length - 1]
  const hud = agentHud(d, w), events = activeEvents(d.events ?? [], d.now)
  const caption = style === 'arcade' ? arcadeEvent(d) : events.map(eventLabel).join(' · ')
  const ages = [...new Set(d.usage.filter(u => u.on && u.age).map(u => u.age))]
  const usage = d.usage.filter(u => u.on)
  const legendRows = wrappedRows(usage.map(u => `● ${nameOf(u.provider)}${u.tag === 'main' ? ' Main' : ''} ${u.out ? 'empty' : u.known === false ? '—' : `${pips(100 - u.percent, 3)} ${Math.round(Math.max(0, 100 - u.percent))}% left`}`.length), w)
  const showPowers = !!powers.length && (E.desk || w >= 100)
  const dense = !E.desk && !!u.pendingArea
  // Frame + tabs + both headings, then each visible block and its gap.
  const reserved = 11 + 2 * Number(d.tests === 'fail') + 2 * Number(!!caption) + hud.length + Number(!!hud.length)
    + legendRows + 2 * Number(!!latest) + 2 * Number(!!ages.length) + 2 * Number(showPowers)
    - (dense ? 3 + Number(d.tests === 'fail') + Number(!!caption) + Number(!!hud.length) + Number(!!latest) + Number(!!ages.length) + Number(showPowers) : 0)
  const budget = Math.max(1, rows - reserved)
  // Desktop gaps are eight pixels; terminal gaps consume a full twenty-pixel row.
  const desktopHeight = Math.max(20, (rows - reserved + 4 - Number(w < 60)) * 20 - (w < 60 ? 4 : 0))
  const key = `${style}:${motion}:${sceneKey(d, scene)}:${E.desk ? 'desktop' : `${w}:${budget}`}`
  let picture = pictures.get(key)
  if (!picture) {
    picture = { frames: scene.frames(d, { motion, width: E.desk ? undefined : w, maxRows: E.desk ? undefined : budget }) }; pictures.set(key, picture)
    if (pictures.size > 6) pictures.delete(pictures.keys().next().value!)
  }
  watchVibe($, u)
  const frames = picture.frames
  const count = d.agents.filter(a => a.state === 'running').length
  const alt = `${scene.name}: ${count} agents working, ${d.tests ? d.tests === 'pass' ? 'tests passing' : 'tests failing' : 'no recent tests'}, ${money(d.cost)} spent`
  let drawing
  if (E.desk) {
    stopPlayback()
    const hotspots = scene.hotspots?.(d), svgKey = JSON.stringify(hotspots)
    if (picture.svgKey !== svgKey) { picture.svg = toSvg(frames, { fps: FPS[motion] || 1, hotspots }); picture.svgKey = svgKey }
    const width = graphicWidth(E), height = Math.min(width * frames[0]!.h / frames[0]!.w, desktopHeight)
    drawing = <E.Svg key="vibe:scene" source={picture.svg} width={width} height={height} alt={alt} isInteractive />
  } else {
    const columns = fitColumns(w, frames[0]!.w), focus = scene.focus?.(d, { width: w })
    const maxRows = budget
    const props = frameCells(frames, 0, columns, focus, maxRows)
    const i = play(frames, props.columns, props.rows, key, FPS[motion], focus, maxRows)
    drawing = <E.Raster key="vibe:scene" {...frameCells(frames, i, columns, focus, maxRows)} />
  }
  return <E.Box flexDirection="column" gap={dense ? 0 : 1}>
    <E.Box flexDirection="row" gap={1} alignItems="center"><E.Text dimColor>{scene.name}</E.Text>{g.vibe.styles.length > 1 ? <E.Button key="vibe:style" plain onPress={() => update($, ui, u => ({ ...u, vibeStyle: g.vibe.styles[(g.vibe.styles.indexOf(style) + 1) % g.vibe.styles.length] }))}>{style === 'office' ? 'Arcade ▸' : 'HQ ▸'}</E.Button> : null}</E.Box>
    <E.Text dimColor wrap="truncate-end">{money(d.cost)} · context {Math.round(d.ctx)}%{d.tps > 0 ? ` · ${d.tps} t/s` : ''}{d.combo >= 5 ? ` · combo ${d.combo}` : ''}{d.idle >= 120 ? ` · idle ${Math.floor(d.idle / 60)}m` : ''}</E.Text>
    {drawing}
    {d.tests === 'fail' ? <E.Text key="vibe:failure" color="error" weight="bold">Tests failing</E.Text> : null}
    {caption ? <E.Text key="vibe:reaction" color="warning" wrap="truncate-end">{caption}</E.Text> : null}
    {hud.length ? <E.Box flexDirection="column">{hud.map((line, i) => <E.Text key={`vibe:hud:${i}`} wrap="truncate-end">{line.map((s, j) => <E.Text key={`seg:${j}`} color={s.color} weight={s.bold ? 'bold' : undefined} dimColor={s.dim}>{s.text}</E.Text>)}</E.Text>)}</E.Box> : null}
    <E.Box key="vibe:strip" flexDirection="column" gap={dense ? 0 : 1}>
      <E.Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {d.usage.filter(u => u.on).map(u => <E.Text key={`vibe:mini:${u.provider}`}><E.Text color={colorOf(u.provider)}>● </E.Text>{nameOf(u.provider)}{u.tag === 'main' ? ' Main' : ''} <E.Text color={u.percent > 80 ? 'warning' : colorOf(u.provider)}>{u.out ? 'empty' : u.known === false ? '—' : `${pips(100 - u.percent, 3)} ${Math.round(Math.max(0, 100 - u.percent))}% left`}</E.Text></E.Text>)}
      </E.Box>
      {latest ? <E.Button key="vibe:ticker" plain onPress={() => update($, ui, u => ({ ...u, vibeTab: 'decisions' as const }))}><E.Text color={IMPACT[latest.impact].color} wrap="truncate-end">{IMPACT[latest.impact].mark} {fit(latest.decision, Math.max(1, w - (E.desk ? 6 : 2)))}</E.Text></E.Button> : null}
      {ages.length ? <E.Text dimColor wrap="truncate-end">usage {ages.join(' / ')}</E.Text> : null}
      {showPowers ? <E.Text key="vibe:powers" dimColor wrap="truncate-end">{powers.slice(0, 2).map(k => `${powerLabel(k)}${(k === 'feature:codex-images' ? g.codexImages : toggleMode(t, k)) === 'force' ? ' forced' : ''}`).join(' · ')}{powers.length > 2 ? ` · +${powers.length - 2}` : ''}</E.Text> : null}
    </E.Box>
  </E.Box>
}
