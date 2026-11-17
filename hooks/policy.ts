import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Lane, Policy, RouteLogItem, Routing, Sensitivity, TaskRoute, TaskType } from '../types'
import { agyJobOn } from './state'

type $ = EngineInterface

// The owner's task table: which lane, model and effort each declared kind of task runs on.
// Defaults come from the 2026-11-17 eval run (evals/results-2026-11-17.md).
export const TASK_TYPES: TaskType[] = ['lookup', 'summarise', 'build', 'design', 'review', 'visual', 'private-extract']
export const SENSITIVITIES: Sensitivity[] = ['client', 'internal', 'public']
export const LANES: Lane[] = ['claude', 'ollama', 'gemini']
export const OLLAMA_DEFAULT = 'qwen3.5:9b'
export const GEMINI_DEFAULT = 'gemini-3.8-flash-medium'
export const CLAUDE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']
export const GEMINI_MODELS = ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
// A side lane that cannot take the task hands it to Claude: Ollama's work to Haiku, Gemini's to Sonnet.
export const FALLBACK: Record<Exclude<Lane, 'claude'>, TaskRoute> = {
  ollama: { lane: 'claude', model: 'claude-haiku-5-5', effort: 'low' },
  gemini: { lane: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' },
}

export const defaultTable = (): Record<TaskType, TaskRoute> => ({
  lookup: { lane: 'claude', model: 'claude-haiku-5-5', effort: 'low' },
  summarise: { lane: 'ollama', model: OLLAMA_DEFAULT },
  build: { lane: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' },
  design: { lane: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  review: { lane: 'claude', model: 'claude-sonnet-5-5', effort: 'high' },
  visual: { lane: 'gemini', model: GEMINI_DEFAULT },
  'private-extract': { lane: 'ollama', model: OLLAMA_DEFAULT },
})

export const defaultPolicy = (): Policy => ({ table: defaultTable(), declare: 'warn', allow: [], patterns: [] })

const isModel = (lane: Lane, m: unknown) => typeof m === 'string' && m.length < 80 && (lane === 'claude' ? /^claude-[\w.-]+$/.test(m) : lane === 'gemini' ? /^gemini-[\w.-]+$/.test(m) : /^[\w.-]+(:[\w.-]+)?$/.test(m))

export function normalPolicy(saved: unknown): Policy {
  const d = defaultPolicy()
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Policy>
  const table = { ...d.table }
  for (const t of TASK_TYPES) {
    const x = s.table?.[t]
    if (!x || !LANES.includes(x.lane) || !isModel(x.lane, x.model)) continue
    table[t] = { lane: x.lane, model: x.model, ...(x.lane === 'claude' && EFFORTS.includes(x.effort ?? '') ? { effort: x.effort } : {}) }
  }
  const paths = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((p): p is string => typeof p === 'string' && !!p.trim()).map(p => p.trim().replace(/\/+$/, '')))].slice(0, 50) : []
  return {
    table,
    declare: s.declare === 'block' || s.declare === 'off' ? s.declare : 'warn',
    allow: paths(s.allow),
    patterns: paths(s.patterns),
  }
}

export const policy = atom({ plugin: 'agent-overview', key: 'policy' } as const, defaultPolicy())
export const routeLog = atom({ plugin: 'agent-overview', key: 'routeLog' } as const, [] as RouteLogItem[])

export async function loadPolicy($: $) {
  const saved = await $.store.get('policy').catch(() => undefined)
  const log = await $.store.get('routeLog').catch(() => undefined)
  await update($, policy, () => normalPolicy(saved))
  if (Array.isArray(log)) await update($, routeLog, () => (log as RouteLogItem[]).slice(-200))
}
export async function savePolicy($: $, change: (p: Policy) => Policy) {
  const next = await update($, policy, p => normalPolicy(change(normalPolicy(p))))
  await $.store.set('policy', next).catch(() => {})
  $.ui.invalidate('prompt.section')
  return next
}

// ---------- the declaration every Agent spawn starts its description with ----------

export type Declaration = { type: TaskType; sensitivity: Sensitivity; rest: string }
export type DeclarationProblem = { problem: 'missing' | 'off-table'; type?: string; sensitivity?: string; fix: string }

const EXAMPLE = 'task:build sensitivity:internal Add the CSV parser'
export const declarationFix = (why: string) =>
  `${why} Start the Agent description with "task:<type> sensitivity:<client|internal|public>", e.g. "${EXAMPLE}". Types: ${TASK_TYPES.join(', ')}.`

export function parseDeclaration(description: string): Declaration | DeclarationProblem {
  const head = /^\s*task:\s*([\w-]+)\s+sensitivity:\s*([\w-]+)\s*(.*)$/is.exec(description ?? '')
  if (!head) {
    const type = /\btask:\s*([\w-]+)/i.exec(description ?? '')?.[1]
    const sensitivity = /\bsensitivity:\s*([\w-]+)/i.exec(description ?? '')?.[1]
    return { problem: 'missing', type, sensitivity, fix: declarationFix(type || sensitivity ? 'The declaration must come first, task then sensitivity.' : 'No task declaration.') }
  }
  const type = head[1]!.toLowerCase(), sensitivity = head[2]!.toLowerCase()
  if (!TASK_TYPES.includes(type as TaskType)) return { problem: 'off-table', type, sensitivity, fix: declarationFix(`"${type}" is not a task type in the owner's table.`) }
  if (!SENSITIVITIES.includes(sensitivity as Sensitivity)) return { problem: 'off-table', type, sensitivity, fix: declarationFix(`"${sensitivity}" is not a sensitivity.`) }
  return { type: type as TaskType, sensitivity: sensitivity as Sensitivity, rest: head[3]!.trim() }
}
export const isProblem = (d: Declaration | DeclarationProblem): d is DeclarationProblem => 'problem' in d

// ---------- where a declared task runs ----------

export type Lanes = { ollama: boolean; gemini: boolean; why: Partial<Record<Exclude<Lane, 'claude'>, string>> }

// Which side lanes can take work now. Claude only refuses both; client work never goes to the cloud lane.
export function lanesOpen(r: Routing, ollama: { installed: boolean; up: boolean }, sensitivity?: Sensitivity, cloud?: { allowed: boolean; why?: string }): Lanes {
  const why: Lanes['why'] = {}
  if (r.role === 'claude') why.ollama = why.gemini = 'Claude only'
  if (!why.ollama) why.ollama = !r.on.ollama ? 'Ollama is off' : !ollama.installed ? 'Ollama is not installed' : !ollama.up ? 'Ollama is not running' : undefined
  if (!why.gemini) why.gemini = sensitivity === 'client' ? 'client material never goes to a cloud lane'
    : !r.on.antigravity ? 'Antigravity is off'
      : !(agyJobOn(r, 'visual') || agyJobOn(r, 'coding')) ? 'Antigravity has no job on or is out of quota'
        : cloud && !cloud.allowed ? cloud.why ?? 'not allowed for this project' : undefined
  for (const k of ['ollama', 'gemini'] as const) if (!why[k]) delete why[k]
  return { ollama: !why.ollama, gemini: !why.gemini, why }
}

export type Resolved = TaskRoute & { declared: TaskRoute; moved?: string }

// The table's route for a type, moved to Claude when its side lane cannot take the task.
export function resolveRoute(p: Policy, type: TaskType, open: Lanes): Resolved {
  const declared = p.table[type]
  if (declared.lane === 'claude' || open[declared.lane]) return { ...declared, declared }
  return { ...FALLBACK[declared.lane], declared, moved: open.why[declared.lane] }
}

export const laneName = (l: Lane) => l === 'claude' ? 'Claude' : l === 'ollama' ? 'Ollama' : 'Gemini'
export const laneTool = (l: Lane) => l === 'ollama' ? 'mcp__agent-overview__ollama_run' : l === 'gemini' ? 'mcp__agent-overview__gemini_run' : 'the Agent tool'
export const routeLabel = (x: TaskRoute) => `${laneName(x.lane)} ${x.model}${x.effort ? ` (${x.effort})` : ''}`

// The routing section's lines on declarations and the table, kept short.
export function declarationText(p: Policy, open: Pick<Lanes, 'ollama' | 'gemini'>) {
  if (p.declare === 'off') return ''
  const rows = TASK_TYPES.map(t => {
    const x = p.table[t]
    const live = x.lane === 'claude' || open[x.lane]
    const run = live ? x : FALLBACK[x.lane as Exclude<Lane, 'claude'>]
    return `${t} → ${routeLabel(run)}${x.lane !== 'claude' && live ? ` via ${x.lane === 'ollama' ? 'ollama_run' : 'gemini_run'}, no subagent` : ''}`
  })
  return [
    `Task declarations (${p.declare === 'block' ? 'enforced: undeclared spawns are refused' : 'checked: undeclared spawns are flagged to the owner'}): start every Agent description with "task:<type> sensitivity:<client|internal|public>", e.g. "${EXAMPLE}". The mod sets the model and effort from this table: ${rows.join('; ')}.`,
    'Sensitivity client means client material (briefs, client files, metrics): it never goes to Gemini or any cloud side lane.',
  ].join('\n')
}

// ---------- the log of every routing decision ----------

export async function logRoute($: $, item: RouteLogItem) {
  const list = await update($, routeLog, l => [...l.filter(x => x.id !== item.id), item].slice(-200))
  await $.store.set('routeLog', list).catch(() => {})
}
export async function settleRoute($: $, match: (x: RouteLogItem) => boolean, change: Partial<RouteLogItem>) {
  const list = await read($, routeLog)
  if (!list.some(x => match(x) && x.outcome === 'running')) return
  const next = await update($, routeLog, l => l.map(x => match(x) && x.outcome === 'running' ? { ...x, ...change } : x))
  await $.store.set('routeLog', next).catch(() => {})
}
