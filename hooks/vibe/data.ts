import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Act, AgentNode, Costs, DecisionItem, EditItem, Finding, History, LiveEdit, MainInfo, Prices, Providers, SideLive, Stage, TurnCost, VibeLog, Written } from '../../types'
import { allOf, blank, defaultRouting, providerOf, usageAge } from '../state'
import { displayAgents, displayHistory } from '../babysitter'
import { stateOf } from '../graph'
import { claudeTotal, costOf, priceOf, rowCost, sessionRows } from '../cost'
import { activeEvents } from './events'
import { SCENES } from './scenes'
import type { Scene, VibeAct, VibeData } from './engine'

const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
const written = atom({ plugin: 'agent-overview', key: 'written' } as const, { added: 0, removed: 0, files: [] } as Written)
const live = atom({ plugin: 'agent-overview', key: 'live' } as const, null as LiveEdit | null)
const sideLive = atom({ plugin: 'agent-overview', key: 'sideLive' } as const, null as SideLive | null)
const acts = atom({ plugin: 'agent-overview', key: 'acts' } as const, {} as Record<string, Act>)
const decisions = atom({ plugin: 'agent-overview', key: 'decisions' } as const, [] as DecisionItem[])
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, { claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(), ollama: blank() } as Providers)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const costs = atom({ plugin: 'agent-overview', key: 'costs' } as const, { rows: [], claude: {}, agy: {} } as Costs)
const prices = atom({ plugin: 'agent-overview', key: 'prices' } as const, { catalog: {}, overrides: {} } as Prices)
const turnCosts = atom({ plugin: 'agent-overview', key: 'turnCosts' } as const, [] as TurnCost[])
const findings = atom({ plugin: 'agent-overview', key: 'findings' } as const, [] as Finding[])
const history = atom({ plugin: 'agent-overview', key: 'history' } as const, { since: 0, items: [] } as History)
const vibe = atom({ plugin: 'agent-overview', key: 'vibe' } as const, { acts: [], combo: 0, commits: 0, pushes: 0, best: 0, phase: '' } as VibeLog)
const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)

export const TEST_RE = /(?:^|&&|;|\|)\s*(?:npx(?:\s+-y)?\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|jest|vitest|pytest|mocha|go\s+test|cargo\s+test|(?:claude\s+)?plugin\s+test|tsc)(?=\s|$|[;&|])/i
export const COMMIT_RE = /\bgit\b[^|;&]*\bcommit\b/
export const PUSH_RE = /\bgit\b[^|;&]*\bpush\b/
export const actKind = (tool: string, title: string): VibeAct['kind'] => tool === 'Bash' ? !COMMIT_RE.test(title) && !PUSH_RE.test(title) && TEST_RE.test(title) ? 'test' : 'bash' : /^(?:Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) ? 'edit' : 'other'

export function sessionCost(c: Costs, pr: Prices): number {
  let total = Math.max(claudeTotal(c.claude, pr).usd ?? 0, c.engineUsd ?? 0)
  if (c.base) for (const r of sessionRows(c.rows, c.base)) {
    if (['codex', 'opencode', 'commandcode'].includes(r.provider) && !r.credits) total += rowCost(r, pr) ?? 0
  }
  for (const [model, t] of Object.entries(c.agy)) total += costOf(t, priceOf(pr, model)) ?? 0
  return total
}

export type TokenSample = { at: number; out: number }
// Retain the sample just before the window so sparse token reports still have a useful baseline.
export function sampleTps(ring: TokenSample[], at: number, out: number, running: boolean): number {
  const last = ring[ring.length - 1]
  if (last && (at < last.at || out < last.out)) ring.length = 0
  if (ring[ring.length - 1]?.at === at) ring[ring.length - 1] = { at, out }
  else ring.push({ at, out })
  while (ring.length > 2 && ring[1]!.at <= at - 30000) ring.shift()
  const first = ring[0]!
  return running && at > first.at ? Math.max(0, Math.round((out - first.out) * 1000 / (at - first.at))) : 0
}
const samples: TokenSample[] = []

export async function vibeData($: EngineInterface): Promise<VibeData> {
  const [now, m, list, changed, l, sl, active, ds, ps, r, c, pr, turns, fs, log, h, work] = await Promise.all([
    $.clock.now(), read($, main), read($, nodes), read($, edits), read($, live), read($, sideLive), read($, acts), read($, decisions),
    read($, providers).then(allOf), read($, routing), read($, costs), read($, prices), read($, turnCosts), read($, findings), read($, vibe), read($, history), read($, stage),
  ])
  const candidates = displayAgents(list, changed).filter(n => n.kind !== 'workflow').map(n => ({ ...n, provider: n.provider ?? providerOf(n.model), state: stateOf(n, list) }))
  const agents = candidates
    .filter(n => n.state === 'failed'
      ? !candidates.some(next => next.provider === n.provider && (next.startedAt ?? 0) > (n.endedAt ?? n.startedAt ?? 0))
      : n.state === 'running' || (n.endedAt ?? -Infinity) > now - 60000)
    .sort((a, b) => Number(b.state === 'failed') - Number(a.state === 'failed') || Number(b.state === 'running') - Number(a.state === 'running') || (b.state === 'running' ? b.startedAt ?? 0 : b.endedAt ?? 0) - (a.state === 'running' ? a.startedAt ?? 0 : a.endedAt ?? 0))
    .slice(0, 8).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const agentRunning = candidates.some(n => n.state === 'running')
  const running = !!m.working || agentRunning || Object.values(active).some(a => a.state === 'running')
  let edit: VibeData['edit'] = null
  if (l) {
    const node = list.find(n => l.agent && n.agentId === l.agent)
    edit = { file: l.file, added: l.text ? l.text.split('\n').length : 0, removed: 0, provider: node?.provider ?? providerOf(node?.model ?? '') }
  }
  else if (sl?.files[0]) {
    const file = sl.files[0], node = list.find(n => n.id === sl.id)
    edit = { file: file.path, added: file.added, removed: file.removed, provider: node?.provider ?? providerOf(node?.model ?? '') }
  } else {
    const latest = changed.filter(e => (e.at ?? -Infinity) > now - 20000).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]
    if (latest) edit = { file: latest.file, added: latest.added ?? 0, removed: latest.removed ?? 0, provider: latest.provider ?? providerOf(latest.model ?? '') }
  }
  const recent: VibeAct[] = [...log.acts, ...Object.values(active).filter(a => a.state === 'running').map(a => ({ tool: a.tool, title: a.title, state: 'running' as const, at: a.at, kind: actKind(a.tool, a.title) }))].sort((a, b) => a.at - b.at).slice(-12)
  const test = [...recent].reverse().find(a => a.kind === 'test' && a.state !== 'running' && a.at > now - 60000)
  const tot = await read($, written)
  const lines = Math.max(tot.added + tot.removed, changed.reduce((sum, e) => sum + (e.added ?? 0) + (e.removed ?? 0), 0))
  const timestamps = [h.since, ...Object.values(active).flatMap(a => [a.at, a.endedAt ?? 0]), ...log.acts.map(a => a.at), ...changed.map(e => e.at ?? 0), sl?.at ?? 0,
    ...list.flatMap(n => [n.startedAt ?? 0, n.endedAt ?? 0]), ...ds.map(d => d.at), ...turns.map(t => t.at)]
  const last = timestamps.reduce((a, b) => Math.max(a, b), 0)
  const out = Object.values(c.claude).reduce((sum, t) => sum + t.output, 0)
  return {
    now, hour: new Date(now).getHours(), events: activeEvents(log.events ?? [], now),
    stage: work?.at ?? null, sessionStartedAt: log.startedAt ?? h.since,
    lastFailAt: log.lastFailAt, lastTest: log.lastTest, pendingCommits: log.pendingCommits ?? Math.max(0, log.commits - log.pushes),
    finishedTasks: Math.max(candidates.filter(n => n.state === 'done').length, log.sessionId ? displayHistory(h.items, list, changed).filter(i => i.session === log.sessionId && i.state === 'done').length : 0),
    visualChecks: log.visualChecks ?? 0, lastPushAt: log.lastPushAt,
    main: { model: m.model, effort: m.effort, working: !!m.working, lastTool: m.lastTool, waiting: (!m.working && !agentRunning) || (active.main?.state === 'running' && active.main.tool === 'AskUserQuestion') },
    agents: agents.map(n => ({ id: n.id, label: n.label, provider: n.provider, model: n.model, effort: n.effort, state: n.state, startedAt: n.startedAt, endedAt: n.endedAt, steps: n.steps, lastTool: n.lastTool })),
    edit, acts: recent, tests: test ? test.state === 'failed' ? 'fail' : 'pass' : null, decisions: ds,
    usage: ['claude' as const, ...r.order.filter(p => p !== 'claude')].map(p => {
      const percent = Math.max(0, ...ps[p].meters.filter(m => m.label !== 'Context').map(m => m.percent))
      return { provider: p, on: r.on[p], percent, known: ps[p].meters.some(m => m.label !== 'Context'), out: !!ps[p].alert || !!r.paused?.[p] || percent >= 100, tag: r.tags?.[p] ?? 'normal', age: usageAge(ps[p], now), estimate: p === 'opencode' && ps[p].usageSource !== 'live' }
    }),
    cost: sessionCost(c, pr), ctx: ps.claude.meters.find(m => m.label === 'Context')?.percent ?? 0,
    commits: log.commits, pushes: log.pushes, combo: log.combo, best: Math.max(log.best, lines), lines, findings: fs.filter(f => !f.dismissed).length,
    idle: running ? 0 : Math.max(0, Math.floor((now - last) / 1000)), tps: sampleTps(samples, now, out, running),
  }
}

export function sceneKey(d: VibeData, scene?: Scene): string {
  return JSON.stringify([activeEvents(d.events ?? [], d.now), scene ? scene.key?.(d) : Object.values(SCENES).map(s => s.key?.(d))])
}
