import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'
import type { Ui, VibeLog } from '../../types'
import { normalGuard } from '../state'
import { FPS, toCells } from './engine'
import { SCENES } from './scenes'
import type { Canvas, Focus, VibeAct, VibeData } from './engine'
import { actKind, COMMIT_RE, PUSH_RE, sceneKey, vibeData } from './data'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const vibe = atom({ plugin: 'agent-overview', key: 'vibe' } as const, { acts: [], combo: 0, commits: 0, pushes: 0, best: 0, phase: '' } as VibeLog)

type Playback = { frames: Canvas[]; columns: number; rows: number; key: string; fps: number; index: number; focus?: Focus; maxRows: number }
const rasters = new WeakMap<Canvas[], Map<string, ReturnType<typeof toCells>>>()
export function frameCells(frames: Canvas[], index: number, columns: number, focus?: Focus, maxRows = 256): ReturnType<typeof toCells> {
  let cache = rasters.get(frames)
  if (!cache) { cache = new Map(); rasters.set(frames, cache) }
  const key = JSON.stringify([index, columns, maxRows, focus])
  let cells = cache.get(key)
  if (!cells) { cells = toCells(frames[index]!, columns, focus, maxRows); cache.set(key, cells) }
  return cells
}
let playback: Playback | undefined
let fast: Timer | undefined, fastFps = 0, checker: Timer | undefined

export function stopPlayback(): void {
  fast?.cancel(); fast = undefined; fastFps = 0; playback = undefined
}
export function play(frames: Canvas[], columns: number, rows: number, key: string, fps: number, focus?: Focus, maxRows = rows): number {
  if (playback?.key !== key || playback.frames !== frames || playback.columns !== columns || playback.rows !== rows) {
    playback = { frames, columns, rows, key, fps, index: 0, focus, maxRows }
  } else playback.fps = fps
  if (!fps) { fast?.cancel(); fast = undefined; fastFps = 0 }
  return playback.index
}
async function visible($: EngineInterface): Promise<boolean> {
  const u = await read($, ui)
  if ((u.pendingArea ?? u.area) !== 'vibe' || (u.vibeTab ?? 'live') !== 'live') return false
  return (await $.ui.panes()).some(p => p.id === 'agent-overview' && p.isPlaced && p.isShown)
}
async function advance($: EngineInterface): Promise<void> {
  const p = playback
  if (!p) return
  try {
    p.index = (p.index + 1) % p.frames.length
    const { cells } = frameCells(p.frames, p.index, p.columns, p.focus, p.maxRows)
    const result = await $.ui.blit({ requestId: 'agent-overview', key: 'vibe:scene', cells, columns: p.columns, rows: p.rows })
    if (result.deny && playback === p) stopVibe()
  } catch { if (playback === p) stopPlayback() }
}
export const vibePhase = (d: VibeData) => {
  const hud = { ...d, tps: Math.floor(d.tps / 10) * 10, cost: Math.floor(d.cost * 10) / 10, ctx: Math.floor(d.ctx / 5) * 5 }
  return JSON.stringify([sceneKey(hud), ...Object.values(SCENES).map(s => s.hud?.(hud, 128))])
}
export async function vibeTick($: EngineInterface): Promise<void> {
  try {
    if (!(await visible($))) { stopVibe(); return }
    const d = await vibeData($), log = await read($, vibe), phase = vibePhase(d)
    if (d.best > log.best) await $.store.set('vibeBest', d.best).catch(() => {})
    if (d.best > log.best || phase !== log.phase) await update($, vibe, v => ({ ...v, best: Math.max(v.best, d.best), phase }))
    const fps = FPS[normalGuard(await read($, guard)).vibe.motion]
    if (!fps || !playback || !playback.fps) { fast?.cancel(); fast = undefined; fastFps = 0; return }
    if (fast && fastFps === fps) return
    fast?.cancel(); fastFps = fps
    fast = $.clock.every(Math.round(1000 / fps), () => { void advance($) })
  } catch { stopPlayback() }
}

export function stopVibe(): void {
  stopPlayback(); checker?.cancel(); checker = undefined
}
export function watchVibe($: EngineInterface, u: Ui): void {
  if ((u.pendingArea ?? u.area) !== 'vibe' || (u.vibeTab ?? 'live') !== 'live') { stopVibe(); return }
  checker ??= $.clock.every(1000, () => { void vibeTick($) })
}
export function registerVibe(on: On): void {
  on('state.set', { plugin: 'agent-overview', key: 'ui' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.value?.isSet) watchVibe($, e.value)
    return ran
  })
  on('ui.close', { id: 'agent-overview' }, async (_$, e, next) => {
    stopVibe()
    return next(e)
  })
  on('ui.open', { id: 'agent-overview' }, async ($, e, next) => {
    const ran = await next(e)
    watchVibe($, await read($, ui))
    return ran
  })
  on('session.start', {}, async ($, e, next) => {
    const ran = await next(e)
    stopVibe()
    const sessionId = await $.session.id(), log = await read($, vibe)
    if (log.sessionId !== sessionId) {
      const saved = await $.store.get('vibeBest').catch(() => 0)
      const lastFailAt = await $.store.get('vibeLastFailAt').catch(() => undefined)
      const startedAt = await $.clock.now()
      await update($, vibe, () => ({ sessionId, startedAt, lastFailAt: typeof lastFailAt === 'number' ? lastFailAt : undefined,
        pendingCommits: 0, visualChecks: 0, acts: [], combo: 0, commits: 0, pushes: 0, best: typeof saved === 'number' && Number.isFinite(saved) ? Math.max(0, saved) : 0, phase: '' }))
    }
    watchVibe($, await read($, ui))
    return ran
  })
  on('tool.call', {}, async ($, call, next) => {
    const ran = await next(call)
    const input = call as unknown as { tool: string; command?: string; file_path?: string; notebook_path?: string }
    if (!input.tool || input.tool.startsWith('mcp__agent-overview__')) return ran
    const command = input.command ?? ''
    const title = input.tool === 'Bash' ? command.split('\n')[0]!.slice(0, 120) : /^(?:Edit|Write|MultiEdit|NotebookEdit)$/.test(input.tool) ? input.file_path ?? input.notebook_path ?? input.tool : input.tool
    const failed = !!(ran.deny || ran.isError), kind = actKind(input.tool, command)
    const act: VibeAct = { tool: input.tool, title, state: failed ? 'failed' : 'done', at: await $.clock.now(), kind,
      ...(kind === 'test' ? { tests: failed ? 'fail' as const : 'pass' as const } : {}) }
    if (kind === 'test' && failed) await $.store.set('vibeLastFailAt', act.at).catch(() => {})
    await update($, vibe, v => ({ ...v, acts: [...v.acts, act].slice(-12), combo: failed ? 0 : v.combo + 1,
      lastFailAt: kind === 'test' && failed ? act.at : v.lastFailAt,
      lastTest: kind === 'test' ? failed ? 'fail' : 'pass' : v.lastTest,
      pendingCommits: !failed && input.tool === 'Bash' && PUSH_RE.test(command) ? 0 : (v.pendingCommits ?? Math.max(0, v.commits - v.pushes)) + (!failed && input.tool === 'Bash' && COMMIT_RE.test(command) ? 1 : 0),
      lastPushAt: !failed && input.tool === 'Bash' && PUSH_RE.test(command) ? act.at : v.lastPushAt,
      visualChecks: (v.visualChecks ?? 0) + (!failed && /^mcp__antigravity__gemini_visual_qa$/.test(input.tool) ? 1 : 0),
      commits: v.commits + (!failed && input.tool === 'Bash' && COMMIT_RE.test(command) ? 1 : 0),
      pushes: v.pushes + (!failed && input.tool === 'Bash' && PUSH_RE.test(command) ? 1 : 0) }))
    return ran
  })
}
