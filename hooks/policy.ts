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
  // Ollama passed the visual eval 2/2, faster and on this Mac; Gemini takes the public ones (see resolveRoute).
  visual: { lane: 'ollama', model: OLLAMA_DEFAULT },
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
  const paths = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((p): p is string => typeof p === 'string' && !!p.trim()).map(p => p.trim().replace(/(.)\/+$/, '$1')))].slice(0, 50) : []
  return {
    table,
    declare: s.declare === 'block' || s.declare === 'off' ? s.declare : 'warn',
    allow: paths(s.allow),
    // Patterns keep a trailing slash: it marks a folder.
    patterns: Array.isArray(s.patterns) ? [...new Set(s.patterns.filter((p): p is string => typeof p === 'string' && !!p.trim() && p.length < 200).map(p => p.trim()))].slice(0, 50) : [],
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

export type Declaration = { type: TaskType; sensitivity: Sensitivity; rest: string; effort?: string }
export type DeclarationProblem = { problem: 'missing' | 'off-table'; type?: string; sensitivity?: string; fix: string }

const EXAMPLE = 'task:build sensitivity:internal Add the CSV parser'
export const declarationFix = (why: string) =>
  `${why} Start the Agent description with "task:<type> sensitivity:<client|internal|public>", e.g. "${EXAMPLE}". Types: ${TASK_TYPES.join(', ')}.`

export function parseDeclaration(description: string): Declaration | DeclarationProblem {
  const head = /^\s*task:\s*([\w-]+)\s+sensitivity:\s*([\w-]+)(?:\s+effort:\s*([\w-]+))?\s*(.*)$/is.exec(description ?? '')
  if (!head) {
    const type = /\btask:\s*([\w-]+)/i.exec(description ?? '')?.[1]
    const sensitivity = /\bsensitivity:\s*([\w-]+)/i.exec(description ?? '')?.[1]
    return { problem: 'missing', type, sensitivity, fix: declarationFix(type || sensitivity ? 'The declaration must come first, task then sensitivity.' : 'No task declaration.') }
  }
  const type = head[1]!.toLowerCase(), sensitivity = head[2]!.toLowerCase()
  if (!TASK_TYPES.includes(type as TaskType)) return { problem: 'off-table', type, sensitivity, fix: declarationFix(`"${type}" is not a task type in the owner's table.`) }
  if (!SENSITIVITIES.includes(sensitivity as Sensitivity)) return { problem: 'off-table', type, sensitivity, fix: declarationFix(`"${sensitivity}" is not a sensitivity.`) }
  const effort = head[3]?.toLowerCase()
  if (effort && !EFFORTS.includes(effort)) return { problem: 'off-table', type, sensitivity, fix: declarationFix(`"${effort}" is not an effort (${EFFORTS.join(', ')}).`) }
  return { type: type as TaskType, sensitivity: sensitivity as Sensitivity, rest: head[4]!.trim(), ...(effort ? { effort } : {}) }
}

// A declaration may ask for less effort than the owner's table gives, never more: the table is the ceiling.
export function lowerEffort(table: string | undefined, asked: string | undefined): string | undefined {
  if (!table || !asked) return table
  return EFFORTS.indexOf(asked) < EFFORTS.indexOf(table) ? asked : table
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
    : sensitivity === 'internal' ? 'Gemini takes public material only'
    : !r.on.antigravity ? 'Antigravity is off'
      : !(agyJobOn(r, 'visual') || agyJobOn(r, 'coding')) ? 'Antigravity has no job on or is out of quota'
        : cloud && !cloud.allowed ? cloud.why ?? 'not allowed for this project' : undefined
  for (const k of ['ollama', 'gemini'] as const) if (!why[k]) delete why[k]
  return { ollama: !why.ollama, gemini: !why.gemini, why }
}

export type Resolved = TaskRoute & { declared: TaskRoute; moved?: string }

// The table's route for a type, moved to Claude when its side lane cannot take the task.
export const isDefaultVisual = (x: TaskRoute) => x.lane === 'ollama' && x.model === OLLAMA_DEFAULT
export function resolveRoute(p: Policy, type: TaskType, open: Lanes, sensitivity?: Sensitivity): Resolved {
  let declared = p.table[type]
  // Public images go to Gemini while the visual row is still the default; client and internal ones stay on Ollama.
  if (type === 'visual' && sensitivity === 'public' && isDefaultVisual(declared) && open.gemini) declared = { lane: 'gemini', model: GEMINI_DEFAULT }
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
    return `${t} → ${routeLabel(run)}${x.lane !== 'claude' && live ? ` via ${x.lane === 'ollama' ? 'ollama_run' : 'gemini_run'}, no subagent` : ''}${t === 'visual' && isDefaultVisual(x) && open.gemini ? `; public images → Gemini ${GEMINI_DEFAULT} via gemini_run` : ''}`
  })
  return [
    `Task declarations (${p.declare === 'block' ? 'enforced: undeclared spawns are refused' : 'checked: undeclared spawns are flagged to the owner'}): start every Agent description with "task:<type> sensitivity:<client|internal|public>", e.g. "${EXAMPLE}". The mod sets the model and effort from this table: ${rows.join('; ')}. To run one call at less effort than its row, add "effort:<level>" after the sensitivity (lower only; the table is the ceiling).`,
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

// ---------- confidentiality: what never goes to a cloud side lane ----------

// Client material, always: briefs, metrics, the client labels of the golden set, and env files.
export const CLIENT_PATTERNS = ['client_briefs/', 'runs/metrics/', 'engine/rag/golden/labels/client/', '*.env', '.env']

// Paths a project's own rules call "Never commit" or confidential (CLAUDE.md, a .clan file's text):
// the backticked paths of that section, and of any line that says so.
export function neverCommitPatterns(text: string): string[] {
  const out = new Set<string>()
  const add = (p: string) => { if (/^[\w.*\/-]+$/.test(p) && /[./*]/.test(p) && !/^\d/.test(p) && !/^\.{2,}$/.test(p)) out.add(p) }
  const take = (chunk: string, bare: boolean) => {
    for (const m of chunk.matchAll(/`([^`\n]{1,120})`/g)) add(m[1]!.trim())
    // Unbackticked paths: a folder ("client_briefs/"), a dotfile (".env"), a glob ("*.env") or a file with an extension in a folder.
    if (bare) for (const m of chunk.replace(/`[^`\n]*`/g, ' ').matchAll(/(?:^|[\s(,;:"'])((?:\.{0,2}\/)?[\w.*-]+(?:\/[\w.*-]+)*\/|\.[\w-]{2,}|\*\.[\w]+|[\w-]+(?:\/[\w.-]+)+\.\w{1,6})(?=[\s),;:"'.]|$)/g)) add(m[1]!.replace(/^\.\//, ''))
  }
  const SAYS = /never commit|do not commit|don'?t commit|must not be committed|confidential|never (?:share|send|upload|push)/i
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*#{1,6}\s.*(never commit|do not commit|don'?t commit|confidential)/i.test(line)) {
      let j = i + 1
      const chunk: string[] = []
      while (j < lines.length && !/^\s*#{1,6}\s/.test(lines[j]!)) chunk.push(lines[j++]!)
      take(chunk.join('\n'), true)
    } else if (SAYS.test(line)) take(line, true)
  }
  return [...out]
}

const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
// A pattern as a match on path boundaries: "dir/" anywhere a path segment starts, with or without its trailing
// slash ("cd client_briefs && ...", "ls runs/metrics"), "*.env" any file of that kind.
export function patternRegex(p: string): RegExp {
  const dir = p.endsWith('/')
  const body = esc(p.replace(/^\.?\//, '').replace(/\/+$/, '')).replace(/\*/g, '[^\\s/"\'`]*')
  return new RegExp(`(?:^|[\\s"'\`(=:/@;&|<>])${body}${dir ? '(?:/|\\s|$|["\'`);&|<>])' : '(?![\\w-])'}`, 'i')
}

const globRe = (g: string) => new RegExp(`^${[...g].map(c => c === '*' ? '.*' : c === '?' ? '.' : esc(c)).join('')}$`, 'i')
// A glob in the text ("client_br*/x", "runs/met*") that could name a folder the patterns protect, compared segment by segment.
function globHit(text: string, patterns: string[]): string | undefined {
  const tokens = text.split(/[\s"'`()=;&|<>]+/).filter(t => /[*?]/.test(t) && t.replace(/[*?]/g, '').length >= 3)
  for (const p of patterns.filter(x => x.endsWith('/'))) {
    const dir = p.replace(/^\.?\//, '').replace(/\/+$/, '').split('/')
    for (const tok of tokens) {
      const all = tok.split('/').filter(Boolean)
      for (let at = 0; at < all.length; at++) {
        const segs = all.slice(at, at + dir.length)
        if (segs.every((s, i) => globRe(s).test(dir[i]!)) && segs.some(s => /[*?]/.test(s) && s.replace(/[*?]/g, '').length >= 2)) return p
      }
    }
  }
  return undefined
}
export function clientHit(text: string, patterns: string[]): string | undefined {
  return patterns.find(p => patternRegex(p).test(text)) ?? globHit(text, patterns)
}

export const onAllowlist = (allow: string[], cwd: string) => allow.some(a => a === '/' || cwd === a || cwd.startsWith(`${a}/`))

// ---------- sensitivity a side-lane call carries ----------

const RANK: Record<string, number> = { public: 0, internal: 1, client: 2 }
// The strictest declared sensitivity of an agent chain (the calling agent and its parents). A word that is not
// one of the three is read as client: fail closed.
export function strictest(declared: (string | undefined)[]): Sensitivity | undefined {
  let top: Sensitivity | undefined
  for (const d of declared) {
    if (d === undefined) continue
    const s = (d in RANK ? d : 'client') as Sensitivity
    if (!top || RANK[s]! > RANK[top]!) top = s
  }
  return top
}
// What a gemini_run call is held to: the tool argument must be exactly public or internal (client is accepted as
// the stricter word and then refused downstream); it can only make the inherited sensitivity stricter.
export function sideSensitivity(arg: unknown, inherited: Sensitivity | undefined): { sensitivity: Sensitivity } | { refuse: string } {
  if (arg !== 'public' && arg !== 'internal' && arg !== 'client') return { refuse: `sensitivity must be exactly "public" or "internal" (got ${arg === undefined ? 'nothing' : JSON.stringify(String(arg)).slice(0, 40)}); client material never goes to a cloud lane` }
  return { sensitivity: strictest([arg, inherited]) ?? arg }
}

// May this go to Antigravity? Not client work (or an unknown sensitivity), not text naming client paths, not from a
// folder inside a confidential path, and only from an allowlisted project. publicOnly also refuses internal.
export function cloudCheck(p: Policy, cwd: string, opts: { sensitivity?: string; text?: string; found?: string[]; publicOnly?: boolean } = {}): { allowed: boolean; why?: string } {
  if (opts.sensitivity === 'client') return { allowed: false, why: 'client material never goes to a cloud lane' }
  if (opts.sensitivity !== undefined && opts.sensitivity !== 'public' && opts.sensitivity !== 'internal') return { allowed: false, why: `sensitivity "${String(opts.sensitivity).slice(0, 40)}" is not public or internal, so it is treated as client material` }
  if (opts.publicOnly && opts.sensitivity !== 'public') return { allowed: false, why: 'this lane takes public material only: its sandbox is not proven to keep it to the files given' }
  const patterns = [...CLIENT_PATTERNS, ...(opts.found ?? []), ...p.patterns]
  const hit = opts.text ? clientHit(opts.text, patterns) : undefined
  if (hit) return { allowed: false, why: `it names a confidential path (${hit})` }
  const here = cwd ? clientHit(`${cwd}/`, patterns) : undefined
  if (here) return { allowed: false, why: `this folder is inside a confidential path (${here})` }
  if (!onAllowlist(p.allow, cwd)) return { allowed: false, why: `this project (${cwd || 'unknown'}) is not on the Antigravity allowlist` }
  return { allowed: true }
}
