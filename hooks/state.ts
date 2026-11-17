import type { EngineInterface } from 'claude-code'
import type { AlertKind, DecisionItem, Guard, ModelSpeeds, Provider, ProviderInfo, Routing, RoutingTag, VibeStyle } from '../types'
import { quotaOf, sideCommand } from './graph'
import { routingSpeed } from './speed'
import { BABYSITTER_MODEL, babysitterModel } from './babysitter'

// Routing is each chat's own (kept across relaunches by its session id); a new chat starts from the last one set anywhere.
async function routingKey($: EngineInterface) {
  const id = await $.session.id().catch(() => '')
  return id ? `routing:${id}` : 'routing'
}
export async function loadRouting($: EngineInterface): Promise<unknown> {
  return (await $.store.get(await routingKey($)).catch(() => undefined)) ?? (await $.store.get('routing').catch(() => undefined))
}
export async function storeRouting($: EngineInterface, r: Routing) {
  await $.store.set(await routingKey($), r).catch(() => {})
  await $.store.set('routing', r).catch(() => {})
}

// The per-chat keys grow with every chat: a side base matters only on its day, and the newest 200 routings are kept.
export async function pruneStore($: EngineInterface) {
  const today = new Date(await $.clock.now()).toDateString()
  const keys = await $.store.keys().catch(() => [] as string[])
  for (const k of keys.filter(k => k.startsWith('base:'))) {
    const v = await $.store.get(k).catch(() => undefined) as { day?: string } | undefined
    if (v?.day !== today) await $.store.delete(k).catch(() => {})
  }
  // shortcut: store order stands in for age; keep a last-used stamp if a busy chat's routing ever goes missing.
  for (const k of keys.filter(k => k.startsWith('routing:')).slice(0, -200)) {
    await $.store.delete(k).catch(() => {})
    await $.store.delete(k.replace(/^routing:/, 'preset:')).catch(() => {})
  }
  for (const k of keys.filter(k => k.startsWith('decisions:')).slice(0, -50)) await $.store.delete(k).catch(() => {})
  for (const k of keys.filter(k => k.startsWith('turns:')).slice(0, -200)) await $.store.delete(k).catch(() => {})
}

export function normalGuard(saved: unknown): Guard {
  const s = (saved ?? {}) as Partial<Guard>
  const styles = (['office', 'arcade'] as VibeStyle[]).filter(id => Array.isArray(s.vibe?.styles) && s.vibe.styles.includes(id))
  return {
    chat: {
      office: (['off', 'slim', 'glass', 'heads', 'dock', 'peek', 'line', 'ticker'] as const).find(style => style === s.chat?.office) ?? 'slim',
      railPreset: s.chat?.railPreset ?? true, hint: s.chat?.hint ?? true, stripRuns: s.chat?.stripRuns ?? true,
      stripDone: s.chat?.stripDone ?? true, stripQuota: s.chat?.stripQuota ?? true,
      spinner: s.chat?.spinner ?? true, mentions: s.chat?.mentions ?? true,
      permission: s.chat?.permission ?? true, sounds: s.chat?.sounds ?? false,
      events: Object.fromEntries((['run', 'review', 'quota', 'question'] as AlertKind[]).map(kind => [kind, {
        notify: s.chat?.events?.[kind]?.notify ?? true, sound: s.chat?.events?.[kind]?.sound ?? true,
      }])) as Guard['chat']['events'],
      vibeDivider: s.chat?.vibeDivider === 'boat' ? 'boat' : 'chase',
      theme: s.chat?.theme === 'overview' || s.chat?.theme === 'work' || s.chat?.theme === 'vibe' ? s.chat.theme : 'mode',
    },
    mediaWidget: s.mediaWidget ?? true,
    mediaBalances: s.mediaBalances ?? true,
    creditPrice: Object.fromEntries(Object.entries(s.creditPrice ?? {}).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n >= 0)),
    caps: s.caps ?? {},
    ccBase: s.ccBase,
    chatLook: s.chatLook ?? true,
    usageTail: s.usageTail ?? true,
    autoPause: s.autoPause ?? true,
    planSubagents: s.planSubagents === 'handoff' ? 'handoff' : 'block',
    routingGuard: s.routingGuard === 'enforce' || s.routingGuard === 'off' ? s.routingGuard : 'warn',
    babysitterModel: typeof s.babysitterModel === 'string' && /^claude-(?:sonnet|haiku|opus)-[\w.-]+$/.test(s.babysitterModel) ? s.babysitterModel : BABYSITTER_MODEL,
    codexImages: s.codexImages === 'off' || s.codexImages === 'force' ? s.codexImages : 'on',
    ctxWarn: s.ctxWarn ?? 80,
    ticker: s.ticker ?? true,
    qaLog: s.qaLog ?? true,
    follow: s.follow ?? true,
    review: s.review ?? false,
    work: {
      ponytail: typeof s.work?.ponytail === 'boolean' ? s.work.ponytail : true,
      grill: typeof s.work?.grill === 'boolean' ? s.work.grill : true,
    },
    vibe: {
      styles: styles.length ? styles : ['office', 'arcade'],
      motion: s.vibe?.motion === 'calm' || s.vibe?.motion === 'still' ? s.vibe.motion : 'full',
    },
  }
}

export { usageAge } from './graph'

export const blank = (): ProviderInfo => ({ status: 'loading', meters: [], facts: [], models: [] })

// Every provider has an entry, those added since the state was written (Ollama) included.
export const allOf = <T extends Partial<Record<Provider, ProviderInfo>>>(ps: T): T & Record<Provider, ProviderInfo> =>
  PROVIDERS.every(p => ps?.[p.id]) ? ps as T & Record<Provider, ProviderInfo> : { ...Object.fromEntries(PROVIDERS.map(p => [p.id, blank()])), ...ps } as T & Record<Provider, ProviderInfo>

// Claude first, then the side subscriptions. Colours read on light and dark themes alike.
export const PROVIDERS: { id: Provider; name: string; short: string; hotkey: string; color: string }[] = [
  { id: 'claude', name: 'Claude', short: 'Claude', hotkey: 'c', color: 'claude' },
  { id: 'codex', name: 'Codex', short: 'Codex', hotkey: 'x', color: '#10A37F' },
  { id: 'commandcode', name: 'Command Code', short: 'Cmd', hotkey: 'm', color: '#B8860B' },
  { id: 'opencode', name: 'OpenCode', short: 'OpenCode', hotkey: 'o', color: '#8B5CF6' },
  { id: 'antigravity', name: 'Antigravity', short: 'Agy', hotkey: 'g', color: '#4285F4' },
  { id: 'ollama', name: 'Ollama (local)', short: 'Ollama', hotkey: 'l', color: '#C026D3' },
]
export const OTHERS: Provider[] = ['antigravity', 'opencode', 'commandcode', 'codex', 'ollama']

// Ollama runs on this Mac: free and private, for small text jobs only. Embedding models never take tasks.
export const OLLAMA_JOBS = 'free, private, local: quick summaries, commit messages, diff summaries, log triage, explain-this-code, extracting fields from private briefs. Not for design, multi-file changes, creative writing or anything agentic.'
export const isEmbedder = (model: string) => /embed/i.test(model)
// Local model ids are name:tag ("qwen2.5:7b"), never provider/model.
export const isLocalModel = (model: string) => /^ollama\//i.test(model) || /^[a-z0-9][\w.-]*:[\w.-]+$/i.test(model)

// Which provider a model id belongs to, from the name alone.
export const providerOf = (model: string): Provider =>
  isLocalModel(model) ? 'ollama'
  : /gemini|antigravity|agy/i.test(model) ? 'antigravity'
    : /opencode|kimi|deepseek|glm|qwen|mimo|grok/i.test(model) ? 'opencode'
      : /command/i.test(model) ? 'commandcode'
        : /codex|gpt|\bo\d/i.test(model) ? 'codex'
          : 'claude'

export const colorOf = (p: Provider) => PROVIDERS.find(x => x.id === p)?.color ?? 'text'
export const nameOf = (p: Provider) => PROVIDERS.find(x => x.id === p)?.name ?? p

export const AGY_CODING_MODEL = 'gemini-4-argon-high'
export const AGY_VISUAL_MODEL = 'gemini-3.8-flash-high'
// The CLI's model ids; pickers use the refreshed provider catalogue.
const agyModels = new Set([
  ...['gemini-4-argon', 'gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5'].flatMap(m => ['low', 'medium', 'high'].map(e => `${m}-${e}`)),
  'gpt-oss-120b-medium',
])
export type AgyJob = 'coding' | 'visual'
export const agyJobModel = (r: Routing, job: AgyJob) => job === 'coding' ? r.agyCodingModel ?? AGY_CODING_MODEL : r.agyVisualModel ?? AGY_VISUAL_MODEL
export const agyBucket = (model: string) => /argon/i.test(model) ? 'Argon' : /claude|gpt/i.test(model) ? 'Claude/GPT' : 'Gemini'
export function agyJobQuota(r: Routing, job: AgyJob, now?: number) {
  const bucket = agyBucket(agyJobModel(r, job))
  const meters = (r.agyQuota ?? []).filter(m => m.label.startsWith(`${bucket} `))
  const quota = quotaOf({ ...blank(), meters })
  const resets = meters.filter(m => m.percent >= 100 || m.limited).map(m => m.resetAt).filter((t): t is number => t !== undefined && Number.isFinite(t))
  return quota && now !== undefined && resets.length ? { ...quota, wait: Math.max(0, Math.max(...resets) - now) } : quota
}
export const agyJobOn = (r: Routing, job: AgyJob) => (job === 'coding' ? r.agyCoding : r.agyVisual) && !agyJobQuota(r, job)
export const agyQuotaLine = (r: Routing) => {
  const jobs = (['coding', 'visual'] as const).filter(job => (job === 'coding' ? r.agyCoding : r.agyVisual) && agyJobQuota(r, job))
  return jobs.length === 2 ? 'Coding + visual out of quota' : jobs.length ? `${jobs[0] === 'coding' ? 'Coding' : 'Visual checks'} out of quota` : ''
}
export function agyModelNotice(r: Routing, g: Pick<Guard, 'routingGuard'>, job: AgyJob, model?: string) {
  const preferred = agyJobModel(r, job)
  if ((g.routingGuard === 'warn' || g.routingGuard === 'enforce') && model && model !== preferred) return `Antigravity ${job === 'coding' ? 'coding' : 'visual checks'}: model "${model}" differs from the owner's model "${preferred}".`
}

// The owner's standing order from CLAUDE.md: Antigravity, then OpenCode, then Command Code.
export const defaultRouting = (): Routing => ({
  optimize: 'quality',
  adversary: null,
  order: [...OTHERS],
  // Ollama is off until the owner turns it on.
  on: { claude: true, antigravity: true, opencode: true, commandcode: true, codex: true, ollama: false },
  models: { claude: [], antigravity: [], opencode: [], commandcode: [], codex: [], ollama: [] },
  agyVisual: true,
  agyCoding: false,
  agyCodingModel: AGY_CODING_MODEL,
  agyVisualModel: AGY_VISUAL_MODEL,
  picks: [],
  role: 'auto',
  tags: {},
  useOrder: true,
  worker: null,
})

export const tagOf = (r: Routing, p: Provider): RoutingTag => r.tags?.[p] ?? 'normal'

export const mainOf = (r: Routing): Routing['worker'] => {
  const p = (['claude', ...OTHERS] as Provider[]).find(p => tagOf(r, p) === 'main')
  const x = r.picks.find(x => x.provider === p)
  return x ? { provider: x.provider, model: x.model } : null
}

// Older saved settings may miss providers added since: fill them in.
export const normalRouting = (saved: unknown): Routing => {
  const d = defaultRouting()
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Routing> & { mode?: string }
  const order = [...(s.order ?? []).filter(p => OTHERS.includes(p)), ...OTHERS.filter(p => !(s.order ?? []).includes(p))]
  const oldPicks = Array.isArray(s.picks) ? s.picks.filter(x => x && PROVIDERS.some(p => p.id === x.provider) && typeof x.model === 'string') : undefined
  // Saved percentage allocations become a stable rank; weights are discarded after this migration.
  if (s.mode === 'split') oldPicks?.sort((a, b) => (Number((b as { weight?: number }).weight) || 0) - (Number((a as { weight?: number }).weight) || 0))
  const tags: NonNullable<Routing['tags']> = {}
  let main = false
  for (const p of ['claude', ...OTHERS] as Provider[]) {
    const tag = s.tags?.[p]
    if (tag !== 'main' && tag !== 'normal' && tag !== 'saver') continue
    tags[p] = tag === 'main' && main ? 'normal' : tag
    if (tag === 'main') main = true
  }
  if (!('tags' in s) && s.worker && PROVIDERS.some(p => p.id === s.worker!.provider) && typeof s.worker.model === 'string') tags[s.worker.provider] = 'main'
  const r: Routing = {
    optimize: s.optimize === 'balanced' || s.optimize === 'speed' ? s.optimize : 'quality',
    adversary: null,
    order,
    on: { ...d.on, ...(s.on ?? {}), claude: true },
    models: { ...d.models, ...(s.models ?? {}) },
    // Older settings had one visual/coding switch; coding there meant both.
    agyVisual: typeof s.agyVisual === 'boolean' ? s.agyVisual : true,
    agyCoding: typeof s.agyCoding === 'boolean' ? s.agyCoding : (s as { agyMode?: string }).agyMode === 'coding',
    agyCodingModel: agyModels.has(s.agyCodingModel ?? '') ? s.agyCodingModel! : d.agyCodingModel,
    agyVisualModel: agyModels.has(s.agyVisualModel ?? '') ? s.agyVisualModel! : d.agyVisualModel,
    ...(Array.isArray(s.agyQuota) ? { agyQuota: s.agyQuota } : {}),
    picks: oldPicks
      ? oldPicks.map(x => ({ provider: x.provider, model: x.model, ...(typeof x.effort === 'string' && x.effort.length <= 12 ? { effort: x.effort } : {}), ...(typeof x.note === 'string' && x.note.trim() ? { note: x.note.trim().slice(0, 160) } : {}) }))
      : (['claude', ...OTHERS] as Provider[]).flatMap(p => (s.models?.[p] ?? []).map(model => ({ provider: p, model }))),
    role: s.role === 'plan' || s.role === 'claude' ? s.role : 'auto',
    tags,
    useOrder: typeof s.useOrder === 'boolean' ? s.useOrder : true,
    worker: null,
    paused: Object.fromEntries(Object.entries(s.paused ?? {}).filter(([p, v]) => OTHERS.includes(p as Provider) && v && typeof v.until === 'number')),
  }
  const a = s.adversary
  // Opus 5.5 is always a reviewer the owner can pick, pinned or not.
  const pick = a && typeof a.model === 'string' && (r.picks.find(x => x.provider === a.provider && x.model === a.model) || (a.provider === 'claude' && a.model === 'claude-opus-5-5' ? { provider: 'claude' as const, model: a.model, effort: undefined } : undefined))
  if (a && pick) r.adversary = { provider: pick.provider, model: pick.model, effort: pick.effort, rounds: typeof a.rounds === 'number' && Number.isFinite(a.rounds) ? Math.max(1, Math.min(5, Math.round(a.rounds))) : 2 }
  return withPicks(r, r.picks)
}

// Both refused spawns and permitted planners get the same live list.
export const handoffList = (r: Routing, speeds: ModelSpeeds = {}): string => {
  const canWork = (p: Provider) => p !== 'claude' && r.on[p] && (p !== 'antigravity' || agyJobOn(r, 'coding') || agyJobOn(r, 'visual'))
  const picks = livePicks(r).filter(x => canWork(x.provider))
  const choices: { provider: Provider; model?: string; note?: string; effort?: string }[] = picks.length ? picks : r.order.filter(canWork).map(provider => ({ provider, model: r.models[provider][0] }))
  return choices.map((x, i) => `${i + 1}. ${x.model ? `${x.model}${x.effort ? ` (${x.effort})` : ''} on ` : ''}${nameOf(x.provider)}${x.model ? routingSpeed(speeds, x.model) : ''}${x.provider === 'antigravity' && !agyJobOn(r, 'coding') ? ' (visual checks only)' : ''}${x.provider === 'ollama' ? ' (small text jobs only)' : ''} via ${routingHow(r, x.provider, x.model, x.effort)}${x.note ? ` (note: ${x.note})` : ''}`).join(', ')
}

export const planDeny = (r: Routing) => `The owner set Claude to plans only: no Claude subagents or workflows. Hand the task to a side model yourself with Bash (run_in_background for long runs), from the owner's list: ${handoffList(r) || '(no side models enabled)'}. Then check what comes back.`

// A Claude planner gets the owner's whole live mix, so it can match the task to a model.
export const handoffText = (r: Routing, speeds: ModelSpeeds = {}): string | undefined => {
  if (r.role !== 'plan') return undefined
  const list = handoffList(r, speeds)
  if (!list) return undefined
  const b = lead(r)
  const rank = livePicks(r).findIndex(x => x.provider === b?.provider && x.model === b.model) + 1
  const main = b ? ` Implementation work goes to the ${b.main ? 'main' : 'default'} model, ${b.model ?? 'the default model'}${b.effort ? ` (${b.effort})` : ''} on ${nameOf(b.provider)}${b.provider === 'antigravity' && !agyJobOn(r, 'coding') ? ' (visual checks only)' : ''}${rank ? `, #${rank} in the list above` : ''}, through ${routingHow(r, b.provider, b.model, b.effort)}, by default, in one complete run with the context it needs. If a task needs more than it, use a model higher in the list; if less, one lower down.` : ''
  return `[Owner's routing: Claude plans only] Do not do this task's work yourself. Hand it, in ONE complete run with everything in the task below, to the side model that fits it from the owner's list, strongest first: ${list}.${main}${optimizeText(r) ? ` ${optimizeText(r)}` : ''}${adversaryText(r, true) ? ` ${adversaryText(r, true)}` : ''} Then check what comes back and return that. Do the work yourself only if those runs fail or are out of quota.`
}

// Over-cap providers go to the back of the line, their mix models last, without touching the saved order.
export const demote = (r: Routing, over: Provider[]): Routing =>
  over.length
    ? { ...r, order: [...r.order.filter(p => !over.includes(p)), ...r.order.filter(p => over.includes(p))], picks: [...r.picks.filter(x => !over.includes(x.provider)), ...r.picks.filter(x => over.includes(x.provider))] }
    : r

// Initial seeds for the stored built-in presets, ranked by provider.
const CHEAP: Provider[] = ['ollama', 'opencode', 'commandcode', 'antigravity', 'codex', 'claude']
const BEST: Provider[] = ['codex', 'claude', 'antigravity', 'opencode', 'commandcode', 'ollama']
const byRank = (rank: Provider[]) => (r: Routing): Routing => {
  const at = (p: Provider) => rank.indexOf(p)
  return withPicks({ ...r, role: r.role === 'claude' ? 'auto' : r.role, order: [...r.order].sort((a, b) => at(a) - at(b)) }, [...r.picks].sort((a, b) => at(a.provider) - at(b.provider)))
}
export const BUILT_IN: { name: string; apply: (r: Routing) => Routing }[] = [
  { name: 'Cheap', apply: byRank(CHEAP) },
  { name: 'Max quality', apply: byRank(BEST) },
]
// Stable comparison of the owner's routing choices.
export const presetKey = (r: Routing) => JSON.stringify([r.optimize, r.adversary ?? null, r.role, r.order, r.on, r.agyVisual, r.agyCoding, r.agyCodingModel, r.agyVisualModel, r.tags, r.useOrder, r.picks.map(x => [x.provider, x.model, x.effort, x.note])])

export const move = (list: Provider[] | string[], item: string, by: number) => {
  const out = [...list] as string[]
  const i = out.indexOf(item)
  const j = i + by
  if (i < 0 || j < 0 || j >= out.length) return out
  ;[out[i], out[j]] = [out[j]!, out[i]!]
  return out
}

export const HOW: Record<Provider, (model?: string, effort?: string, routing?: Routing) => string> = {
  claude: (m, e) => `the Agent tool${m ? ` with model "${m}"` : ''}${e ? ` and effort "${e}"` : ''}`,
  antigravity: (m, _e, r) => r ? [
    agyJobOn(r, 'coding') ? `coding: gemini_bounded_task with model "${agyJobModel(r, 'coding')}"` : '',
    agyJobOn(r, 'visual') ? `visual checks: gemini_visual_qa (and gemini_media_task) with model "${agyJobModel(r, 'visual')}"` : '',
  ].filter(Boolean).join('; ') : `gemini_bounded_task with model "${m ?? AGY_CODING_MODEL}"`,
  opencode: (m, e) => `\`opencode run -m ${m ?? '<provider/model>'}${e ? ` --variant ${e}` : ''} "<task>"\` (see the other-agents skill)`,
  commandcode: (m, e) => `the Command Code CLI${m ? ` with --model ${m}` : ''}${e ? ` --effort ${e}` : ''} (see the other-agents skill)`,
  codex: (m, e) => `\`codex exec${m ? ` -m ${m}` : ''}${e ? ` -c model_reasoning_effort=${e}` : ''} "<task>" < /dev/null\``,
  ollama: m => `the ollama_run tool (mcp__agent-overview__ollama_run)${m ? ` with model "${m}"` : ''}: put the whole task and its input in prompt; it returns the model's text (call it directly, no subagent needed)`,
}

export const routingHow = (r: Routing, p: Provider, model?: string, effort?: string) => HOW[p](model, effort, r)

// Read words rather than prompt text: a flag mentioned inside a task is not a CLI option.
export function withFlags(command: string, provider: Provider, pick: { model?: string; effort?: string; disable?: string[]; run?: string }): string {
  if (provider !== 'codex' && provider !== 'opencode' && provider !== 'commandcode') return command
  // Each pass inserts in one place, including inside an originally quoted shell word.
  if (pick.run && (pick.model || pick.effort || pick.disable?.length)) return withFlags(withFlags(command, provider, { ...pick, run: undefined }), provider, { run: pick.run })
  const found = sideCommand(command)
  if (provider === 'codex' && (!found || found.provider !== provider)) return command
  if (found?.shell) {
    const { start, end, command: inner } = found.shell
    const rewritten = withFlags(inner, provider, pick)
    if (rewritten === inner) return command
    // Insert into the original shell word so its expansion and escaping stay intact.
    let prefix = 0
    while (prefix < inner.length && inner[prefix] === rewritten[prefix]) prefix++
    const added = rewritten.slice(prefix, rewritten.length - (inner.length - prefix))
    const raw = command.slice(start, end)
    let decoded = 0, at = 0, quote = ''
    for (; at < raw.length && decoded < prefix; at++) {
      const ch = raw[at]!
      if (ch === quote) quote = ''
      else if (!quote && (ch === '"' || ch === "'")) quote = ch
      else {
        if (ch === '\\' && quote !== "'" && (!quote || /["\\$`\n]/.test(raw[at + 1] ?? ''))) at++
        decoded++
      }
    }
    if (at === 0 && (raw[0] === "'" || raw[0] === '"')) quote = raw[at++]!
    const insert = quote === "'" ? added.replace(/'/g, `'"'"'`) : quote === '"' ? added.replace(/[\\"$`]/g, '\\$&') : added
    return command.slice(0, start + at) + insert + command.slice(start + at)
  }
  const segment = found?.text ?? command
  const words = [...segment.matchAll(/\d*(?:<<|>>|[<>])&?|(?:"(?:[^"\\]|\\.)*"|'[^']*'|\\.|[^\s;&|()<>"'\\])+|[;&|()]/g)]
  const args = words.map(w => w[0].replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_all, double, single) => double ?? single))
  let start = -1
  let end = -1
  for (let i = 0; i < args.length; i++) {
    const program = args[i]!.split('/').pop()!
    const before = args[i - 1]
    if (i && !/^[;&|(]$/.test(before!) && !/^(?:env|exec|time|nohup)$/.test(before!) && !/^[A-Za-z_]\w*=/.test(before!)) continue
    if (provider === 'codex' && program === 'codex') {
      let j = i + 1
      while (args[j] === '-C' || args[j] === '--cd' || /^(?:-C|--cd)=/.test(args[j] ?? '')) j += args[j]!.includes('=') ? 1 : 2
      if (args[j] === 'exec' || args[j] === 'e') { start = i; end = j; break }
    } else if (provider === 'opencode' && program === 'opencode' && args[i + 1] === 'run') {
      start = i; end = i + 1; break
    } else if (provider === 'commandcode') {
      if (/^(?:cmd|cmdc|commandcode|command-code)$/.test(program)) { start = end = i; break }
      if (program === 'node' && (/command-code\/dist\/index\.mjs$/.test(args[i + 1] ?? '') || (args[i + 1] === '$CC' && /(?:command-code\/dist\/index\.mjs|Command Code\.app)/.test(command)))) {
        start = i; end = i + 1; break
      }
    }
  }
  if (end < 0) return command
  if (pick.run && found) {
    const prefix = `env AO_RUN=${shellArg(pick.run)} `
    return command.slice(0, found.start).endsWith(prefix) ? command : command.slice(0, found.start) + prefix + command.slice(found.start)
  }
  const stop = args.findIndex((a, i) => i > end && /^[;&|()]$/.test(a))
  const own = args.slice(start, stop < 0 ? undefined : stop)
  const modelFlag = provider === 'commandcode' ? /^--model(?:=|$)/ : /^(?:-m|--model)(?:=|$)/
  const effortFlag = provider === 'codex' ? /^(?:-c|--config)(?:=|$)/ : provider === 'opencode' ? /^--variant(?:=|$)/ : /^--effort(?:=|$)/
  const hasEffort = own.some((a, i) => effortFlag.test(a) && (provider !== 'codex' || /^model_reasoning_effort\s*=/.test(a.replace(/^(?:-c|--config)=/, '')) || /^model_reasoning_effort\s*=/.test(own[i + 1] ?? '')))
  const model = pick.model && !own.some(a => modelFlag.test(a)) ? ` ${provider === 'commandcode' ? '--model' : '-m'} ${shellArg(pick.model)}` : ''
  const effort = pick.effort && !hasEffort ? provider === 'codex' ? ` -c ${shellArg(`model_reasoning_effort=${pick.effort}`)}` : ` ${provider === 'opencode' ? '--variant' : '--effort'} ${shellArg(pick.effort)}` : ''
  const disable = provider === 'codex' ? [...new Set(pick.disable ?? [])].filter(feature => !own.some((a, i) => a === `--disable=${feature}` || (a === '--disable' && own[i + 1] === feature))).map(feature => ` --disable ${shellArg(feature)}`).join('') : ''
  const raw = words.slice(start, stop < 0 ? undefined : stop)
  // Any pipe into this command (one in a group or subshell too) feeds codex its stdin; stop at the command before.
  const piped = /(?:^|[^|])\|(?!\|)/.test(command.slice(0, found?.start ?? 0).split(/[;\n]/).pop()!)
  const stdin = provider === 'codex' && !raw.some(w => /^0?</.test(w[0])) && !own.includes('-') && !piped ? ' < /dev/null' : ''
  const at = (found?.start ?? 0) + words[end]!.index! + words[end]![0].length
  return command.slice(0, at) + model + effort + disable + stdin + command.slice(at)
}

const shellArg = (s: string) => /^[\w./:=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'"'"'`)}'`

// The picks that can take work now: their provider is on, and Claude only when Claude does work.
export const livePicks = (r: Routing) =>
  r.role === 'claude' ? r.picks.filter(x => x.provider === 'claude') : r.picks.filter(x => canWork(r, x.provider))

const canWork = (r: Routing, p: Provider) => p === 'claude' ? r.on[p] && r.role !== 'plan' : r.on[p] && !r.paused?.[p] && (p !== 'antigravity' || agyJobOn(r, 'coding') || agyJobOn(r, 'visual'))

export const lead = (r: Routing, over: Provider[] = []): { provider: Provider; model?: string; effort?: string; note?: string; main: boolean } | undefined => {
  if (r.role === 'claude') return undefined
  const p = (['claude', ...OTHERS] as Provider[]).find(p => tagOf(r, p) === 'main')
  const picks = livePicks(r)
  const chosen = picks.find(x => x.provider === p)
  if (chosen && !over.includes(chosen.provider)) return { ...chosen, main: true }
  // Ollama takes small jobs only: it is the main model when tagged so, never by rank.
  const x = picks.find(x => x.provider !== p && tagOf(r, x.provider) !== 'saver' && x.provider !== 'ollama')
  return x ? { ...x, main: false } : undefined
}

export type SubagentRoute = { deny?: string; notice?: string; reason?: string; handoff?: string; provider?: Provider; impact?: DecisionItem['impact'] }

export function subagentRoute(r: Routing, g: Guard, input: { prompt?: string; description?: string; model?: string; fork?: boolean; resume?: unknown }, retried: boolean, over: Provider[] = []): SubagentRoute {
  if (!input.fork && !input.resume && input.model && babysitterModel(input.prompt ?? '', input.model, g.babysitterModel) === input.model) return {}
  if (r.role !== 'auto' || g.routingGuard === 'off' || tagOf(r, 'claude') === 'main') return {}
  const saver = tagOf(r, 'claude') === 'saver'
  const target = lead(r, over) ?? (saver ? livePicks(r).find(x => x.provider !== 'claude' && x.provider !== 'ollama' && !over.includes(x.provider)) : undefined)
  if (!target || target.provider === 'claude') return {}
  const provider = target.provider
  const main = `${nameOf(provider)} (${target.model ?? 'default model'})`
  const notice = saver
    ? `Claude is Saver: conserve it; hand this to ${main}.`
    : `Routing: Main is ${main}. Prefer handing tasks to it; use Claude subagents when a task needs Claude.`
  const route: SubagentRoute = { notice, provider, impact: saver ? 'medium' : 'low' }
  if (g.routingGuard === 'warn') return route
  if (saver) {
    if (g.planSubagents === 'handoff' && !input.fork && !input.resume) return { handoff: `${notice} Hand the task below to it with ${routingHow(r, provider, target.model, target.effort)} in one complete run. Check what comes back and return the result. Do the work yourself only if the side run fails or is out of quota.` }
    return { deny: `${notice} Use ${routingHow(r, provider, target.model, target.effort)}. Claude subagents and workflows are refused while Claude is Saver.` }
  }
  const reason = [input.prompt, input.description].map(s => /^\s*(?:\/\/\s*)?Reason:[ \t]*(\S[^\r\n]*)/im.exec(s ?? '')?.[1]?.trim()).find(Boolean)
  if (retried && reason) return { ...route, reason }
  return { deny: `Routing: Main is ${main}. Hand this to it with ${routingHow(r, provider, target.model, target.effort)}, or call again in this turn with a one-line reason why it needs Claude. Add a line starting "Reason: " to the prompt or description (Workflow: a "// Reason: " line in the script).` }
}

// Side providers whose CLI is not on this machine.
export const missingOf = (ps: Partial<Record<Provider, { status?: string }>>): Provider[] => OTHERS.filter(p => ps[p]?.status === 'missing')
// Installed but not answering (Ollama with its local server down): no work goes there until it does.
export const offlineOf = (ps: Partial<Record<Provider, { status?: string; offline?: string }>>): Provider[] => OTHERS.filter(p => ps[p]?.status !== 'missing' && !!ps[p]?.offline)
// A reading of the routing with those providers out: no work goes to a tool that is not installed.
// The saved routing keeps the owner's choices, so they return when the tool is installed.
export const without = (r: Routing, gone: Provider[]): Routing => {
  if (!gone.some(p => r.on[p] || r.picks.some(x => x.provider === p) || tagOf(r, p) === 'main')) return r
  const tags = Object.fromEntries(Object.entries(r.tags ?? {}).filter(([p, tag]) => !(tag === 'main' && gone.includes(p as Provider)))) as Routing['tags']
  return withPicks({
    ...r, tags,
    on: { ...r.on, ...Object.fromEntries(gone.map(p => [p, false])) } as Routing['on'],
    adversary: r.adversary && gone.includes(r.adversary.provider) ? null : r.adversary,
  }, r.picks.filter(x => !gone.includes(x.provider)))
}

// The gemini and subagent rewrites read each provider's model order too.
export const withPicks = (r: Routing, picks: Routing['picks']): Routing => ({
  ...r,
  picks,
  worker: mainOf({ ...r, picks }),
  models: Object.fromEntries((['claude', ...OTHERS] as Provider[]).map(p => [p, picks.filter(x => x.provider === p).map(x => x.model)])) as Routing['models'],
})

export const withTag = (r: Routing, p: Provider, tag: RoutingTag): Routing => {
  const tags = { ...r.tags, [p]: tag }
  if (tag === 'main') for (const q of ['claude', ...OTHERS] as Provider[]) if (q !== p && tags[q] === 'main') tags[q] = 'normal'
  const next = tag === 'main' ? {
    ...r, tags, on: { ...r.on, [p]: true },
    paused: Object.fromEntries(Object.entries(r.paused ?? {}).filter(([q]) => q !== p)),
    agyCoding: p === 'antigravity' ? true : r.agyCoding,
  } : { ...r, tags }
  return { ...next, worker: mainOf(next) }
}

const noted = (x: Routing['picks'][number]) => (x.note ? ` (note: ${x.note})` : '')

// The system-prompt section that tells the model the owner's live routing choices.
// The second argument is kept for callers that counted delegated runs.
// `over` lists providers past the owner's daily spend cap: they are used last.
export const optimizeText = (r: Routing) => r.optimize === 'balanced' ? 'Between models that suit a task equally, pick the faster.' : r.optimize === 'speed' ? 'Prefer the fastest allowed model that can still do the task well.' : ''

// Adversarial review is the owner's to ask for: the model never starts one, and a planner is never told to.
// The owner's setting (a Claude model and rounds) is only the default for /review-adversarial.
const adversaryText = (r: Routing, short = false) => {
  if (short) return ''
  const a = r.adversary
  const who = a?.provider === 'claude' ? a.model : 'claude-opus-5-5'
  return `Adversarial review: only when Sai asks for one; never on your own and never as a routine step after changes. Then call adversarial_review (mcp__agent-overview__adversarial_review) with the goal, and a base ref if he names one: it shows him the cost of ${who} at high effort for up to ${a?.rounds ?? 2} rounds, and he starts it with /review-adversarial go.`
}

// What Ollama is for and which local models it may run: the owner's allowed ones, else every installed one.
const ollamaLine = (r: Routing, installed: string[], speeds: ModelSpeeds) => {
  const picked = r.picks.filter(x => x.provider === 'ollama' && !isEmbedder(x.model)).map(x => x.model)
  const models = picked.length ? picked : installed.filter(m => !isEmbedder(m))
  if (!models.length) return 'Ollama (local) is on but has no chat model installed: do not use it.'
  return `Ollama (local) runs models on this Mac at no cost: ${OLLAMA_JOBS}${picked.length || !r.picks.length ? '' : ' Use it for those jobs even though it is not in the allowed list.'} Models: ${models.map(m => m + routingSpeed(speeds, m)).join(', ')}. Run it with ${HOW.ollama(models[0])}.`
}

export const routingText = (saved: Routing, _done: Partial<Record<Provider, number>> = {}, over: { p: Provider; spent: number; cap: number }[] = [], opts: Partial<Pick<Guard, 'planSubagents' | 'codexImages' | 'routingGuard' | 'babysitterModel'>> & { missing?: Provider[]; down?: Provider[]; ollamaModels?: string[]; claudeModels?: { id: string; efforts?: string[] }[] } = {}, speeds: ModelSpeeds = {}) => {
  const gone = opts.missing ?? []
  // Installed but not answering: off for now, and said so when the owner had it on.
  const down = (opts.down ?? []).filter(p => !gone.includes(p))
  const downOn = down.filter(p => saved.on[p])
  // With no model picked, Claude's own models and efforts are still a choice to make per task.
  const family = (id: string) => ['fable', 'opus', 'sonnet', 'haiku'].findIndex(f => id.includes(f))
  const own = [...(opts.claudeModels ?? [])].filter(m => family(m.id) >= 0).sort((a, b) => family(a.id) - family(b.id))
  const claudeTiers = !saved.picks.some(x => x.provider === 'claude') && saved.on.claude && saved.role !== 'plan' && own.length > 1
    ? `Claude subagents, no model picked by the owner, so choose per task from Claude's models, smartest first: ${own.map((m, i) => `${i + 1}. ${m.id}${m.efforts?.length ? ` (effort ${m.efforts.join('/')})` : ''}${routingSpeed(speeds, m.id)}`).join(', ')}. ` +
      'Set the Agent tool\'s model and effort to fit the task: hard work (design, tricky bugs, large builds) gets a model near the top at high effort; routine building a middle model at medium; small self-contained work (lookups, summaries, narrow edits) a model further down at low effort.'
    : ''
  const r = demote(without(saved, [...gone, ...down]), over.map(x => x.p))
  const live = r.order.filter(p => canWork(r, p))
  const off = (['claude', ...r.order] as Provider[]).filter(p => !r.on[p] && !gone.includes(p) && !downOn.includes(p))
  const picks = livePicks(r)
  const main = lead(r, over.map(x => x.p))
  const tagged = PROVIDERS.find(p => tagOf(r, p.id) === 'main')?.id
  const reason = tagged === undefined ? '' : !r.picks.some(x => x.provider === tagged) ? 'no allowed model'
    : r.paused?.[tagged] ? 'auto-paused after running out of quota' : !r.on[tagged] ? 'turned off'
      : over.some(x => x.p === tagged) ? 'over its spend cap' : tagged === 'claude' && r.role === 'plan' ? 'Claude is under Plans only'
        : !canWork(r, tagged) ? 'no permitted tasks' : ''
  const fallback = tagged && reason ? `The main provider, ${nameOf(tagged)}, is unavailable right now (${reason}), so ` : 'No main provider is set: '
  const imagePick = picks.find(x => x.provider === 'codex')
  const rank = picks.findIndex(x => x.provider === main?.provider && x.model === main.model) + 1
  const available = (['claude', ...r.order] as Provider[]).filter(p => canWork(r, p))
  const normal = available.filter(p => tagOf(r, p) === 'normal')
  const saver = available.filter(p => tagOf(r, p) === 'saver')
  const follow = 'Give each task to it by default, in one complete run with the context it needs, then check the result.' +
    (saver.length ? " Use Saver providers only when a task needs that model's ability or the others failed or ran out." : '')
  const head = 'Delegation routing, set live by the owner in the agent panel. It overrides any delegation order or provider rules in CLAUDE.md or AGENTS.md; follow it exactly.' + `\nSubagents that only run and wait on a side provider use ${opts.babysitterModel ?? BABYSITTER_MODEL}.`
  const guardLine = opts.routingGuard === 'off' ? '' : `Routing guard: ${opts.routingGuard ?? 'warn'}.`
  if (r.role === 'claude') {
    return [head, guardLine, optimizeText(r), adversaryText(r), picks.some(x => x.provider === 'claude') ? `Allowed models: ${picks.filter(x => x.provider === 'claude').map(x => `${x.model}${x.effort ? ` (${x.effort})` : ''} on Claude${routingSpeed(speeds, x.model)}`).join(', ')}.` : '', claudeTiers, 'Claude only: do all work yourself or in Claude subagents. Do not use Antigravity, OpenCode, Command Code, Codex or Ollama; calls to them are refused.'].filter(Boolean).join('\n')
  }
  const lines = [
    head,
    guardLine,
    optimizeText(r),
    adversaryText(r),
    r.role === 'plan'
      ? `Claude plans only: you, the main chat, plan, coordinate and check results. Delegated work of every kind (scouting, building, reviewing) goes to ${main ? 'the main model below' : 'the side providers below'}, not to Claude subagents: one complete run per task with the context it needs, then check the result. Write code yourself only if those runs fail. ${opts.planSubagents === 'handoff' ? 'If you still use the Agent or Workflow tool, each Claude subagent is told to pass its task to a side provider and check what comes back.' : 'Do not use the Agent or Workflow tool: Claude subagents are refused. Run the side providers yourself with Bash (in the background for long runs) and check what comes back.'}`
      : '',
    picks.length
      ? `Allowed models, smartest first: ${picks.map((x, i) => `${i + 1}. ${x.model}${x.effort ? ` (${x.effort})` : ''} on ${nameOf(x.provider)}${routingSpeed(speeds, x.model)}${tagOf(r, x.provider) === 'normal' ? '' : ` (${tagOf(r, x.provider)})`}${noted(x)}`).join(', ')}. ` +
        'Delegate only to these. Match the model to how hard the task is: hard work (design, tricky bugs, large builds) needs a model near the top; small self-contained work (summaries, boilerplate, narrow edits) can go further down.'
      : live.length
        ? `Hand small self-contained work to these providers${r.useOrder === false ? '' : ', first one first'}: ${live.map((p, i) => `${r.useOrder === false ? '' : `${i + 1}. `}${nameOf(p)}`).join(', ')}.`
        : r.role === 'plan' && opts.planSubagents !== 'handoff' ? 'Every side provider is turned off: ask the owner to enable a side provider.' : 'Every side provider is turned off: keep all delegated work in Claude subagents.',
    ...(picks.length ? [] : (['claude', ...r.order] as Provider[]))
      .filter(p => r.on[p] && r.models[p].length)
      .map(p => `${nameOf(p)} models in order of preference: ${r.models[p].map(model => model + routingSpeed(speeds, model)).join(' > ')}. Use the first unless it fails or is out of quota.`),
    main
      ? main.main
        ? `Main provider: ${nameOf(main.provider)}. It takes most delegated tasks through ${main.model ? `${main.model}${main.effort ? ` (${main.effort})` : ''} on ${nameOf(main.provider)}, #${rank} in the list` : 'its default model'}, run with ${routingHow(r, main.provider, main.model, main.effort)}. ${follow}`
        : `${fallback}the smartest allowed model ${tagged && reason ? 'on another provider that is not Saver' : 'whose provider is not Saver'}, ${main.model}${main.effort ? ` (${main.effort})` : ''} on ${nameOf(main.provider)} (#${rank}), takes most delegated tasks, run with ${routingHow(r, main.provider, main.model, main.effort)}. ${follow}`
      : tagged && reason ? `${fallback}choose another allowed model for this task.` : '',
    picks.some(x => x.provider === 'claude') ? `Claude subagents: ${picks.filter(x => x.provider === 'claude').map(x => HOW.claude(x.model, x.effort)).join('; ')}.` : '',
    claudeTiers,
    normal.length ? `Normal providers, use as you see fit for any task they suit: ${normal.map(nameOf).join(', ')}.` : '',
    saver.length ? `Saver providers, conserve their usage: ${saver.map(nameOf).join(', ')}. Use them only when a task needs that model's ability or the others failed or ran out.` : '',
    saver.includes('claude') ? "Claude is Saver: hand work to the other models rather than doing it yourself or in Claude subagents, unless a task needs Claude's ability." : '',
    r.useOrder === false
      ? 'Provider order is off: choose by model ability and the tags above only.'
      : live.length
      ? `Provider order, for ties between models that can do a task and as the fallback order when one fails or runs out (the main and the tags above come first): ${live.map(nameOf).join(' > ')}.`
      : '',
    picks.some(x => x.note) ? "A note after a model is the owner's guidance on when to use it; follow it over the rank." : '',
    over.length ? `Over the owner's spend cap, so use them last: ${over.map(x => `${nameOf(x.p)} ($${x.spent.toFixed(2)} of $${x.cap})`).join(', ')}.` : '',
    Object.keys(r.paused ?? {}).length ? `Paused automatically after running out of quota: ${(Object.keys(r.paused!) as Provider[]).map(p => nameOf(p)).join(', ')}. They come back on by themselves when the quota resets.` : '',
    off.length ? `Turned off, never use: ${off.map(nameOf).join(', ')}. Calls to them are refused.` : '',
    gone.length ? `Not installed or not set up on this machine, never use: ${gone.map(nameOf).join(', ')}.` : '',
    downOn.length ? `Off for now because it is not running, never use until it is: ${downOn.map(nameOf).join(', ')}${downOn.includes('ollama') ? " (Ollama's local server is not answering; start the Ollama app)" : ''}. Calls to it are refused.` : '',
    canWork(r, 'ollama') ? ollamaLine(r, opts.ollamaModels ?? [], speeds) : '',
    r.on.codex
      ? opts.codexImages === 'off'
        ? 'Do not use Codex\'s image generation (turned off by the owner); Codex runs get `--disable image_generation`.'
        : `Codex can generate images with its built-in image tool: run ${HOW.codex(imagePick?.model ?? r.models.codex[0], imagePick?.effort)} with a prompt like "Use your image generation tool to make <the image>; save it as <name>.png in <folder>". Use it when an image is asked for and no better-suited tool is named.`
      : '',
    r.on.codex && opts.codexImages === 'force'
      ? 'The owner set image generation to Codex: for every image you are asked to create, use Codex\'s built-in image tool as above (not other image tools), save the file where the owner wants it, and say where it is.'
      : '',
    r.on.antigravity
      ? agyJobOn(r, 'coding') || agyJobOn(r, 'visual')
        ? `Antigravity ${!agyJobOn(r, 'coding') ? 'is for visual and media checks only; ' : ''}${HOW.antigravity(undefined, undefined, r)}. For a one-shot visual check (images as absolute paths, inside this project) or a small public text job, call gemini_run (mcp__agent-overview__gemini_run) directly, no subagent; public material only, never internal or client material.`
        : 'Antigravity has no available jobs: do not use it.'
      : '',
  ]
  return lines.filter(Boolean).join('\n')
}
