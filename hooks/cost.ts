import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Costs, Media, Price, Prices, Provider, TokenRow, Tokens, TurnCost } from '../types'
import { normalGuard } from './state'

const media = atom({ plugin: 'agent-overview', key: 'media' } as const, {} as Media)
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))

export const MEDIA = [
  { id: 'elevenlabs', name: 'ElevenLabs', match: /^mcp__(?:claude_ai_ElevenLabs__|.+?__(?=creative_(?:generate_|voice_|sound_)))/, color: 'claude', credits: true },
  { id: 'kling', name: 'Kling', match: /^mcp__kling__/, color: 'success', credits: true, balance: 'query_membership_and_credits' },
  { id: 'magnific', name: 'Magnific', match: /^mcp__(?:claude_ai_Magnific__|.+?__(?=(?:account_balance|images_generate(?:_|$)|video_generate(?:_|$)|designs_generate(?:_|$))))/, color: 'remember', credits: true, balance: 'account_balance' },
  { id: 'antigravity', name: 'Antigravity', match: /^mcp__antigravity__(?=gemini_media_task$)/, color: 'suggestion', credits: false },
  { id: 'figma', name: 'Figma', match: /^mcp__(?:claude_ai_Figma__(?=generate_image$)|.+?__(?=(?:weave_run_model|weave_run_tool)$))/, color: 'warning', credits: false },
  { id: 'heygen', name: 'HeyGen', match: /^mcp__claude_ai_HyperFrames_by_HeyGen__/, color: 'planMode', credits: false },
]
export const mediaService = (tool: string, tools: string[] = []) => {
  const prefix = tool.match(/^mcp__.+?__/)?.[0]
  const service = MEDIA.find(s => s.match.test(tool)) ?? (prefix ? MEDIA.find(s => tools.some(t => t.startsWith(prefix) && s.match.test(t))) : undefined)
  return service?.id === 'figma' && !/(?:weave_run_model|weave_run_tool|generate_image)$/.test(tool) ? undefined : service
}
export const serverName = (server: string, tools: string[]) => tools.filter(t => t.startsWith(`mcp__${server}__`)).map(t => mediaService(t)).find(Boolean)?.name ?? server
export const mediaShort = (tool: string) => tool.replace(/^mcp__.+?__/, '')
export const mediaReadOnly = (tool: string) => /(?:^|_)(?:list|get|search|status|show|query|schema|guide|whoami|simulate)(?:_|$)/i.test(mediaShort(tool).replace(/([a-z])([A-Z])/g, '$1_$2')) || MEDIA.some(s => s.balance === mediaShort(tool))

// Results can arrive as joined text or MCP text blocks; never infer usage from the input.
export function mediaText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(mediaText).join('\n')
  if (!value || typeof value !== 'object') return ''
  const v = value as { text?: unknown; result?: unknown; content?: unknown }
  if (typeof v.text === 'string') return v.text
  if (v.content !== undefined) return mediaText(v.content)
  return v.result === undefined ? JSON.stringify(value) : mediaText(v.result)
}

export function elevenCredits(text: string): number | undefined {
  // Prefer explicit credits over character counts when both describe the same call.
  for (const key of ['credits_used', 'credits', 'cost', 'character_count', 'characters_used']) {
    const found = new RegExp(`(?:^|[\\s{,])['"]?${key}['"]?\\s*[:=]\\s*['"]?(\\d+(?:\\.\\d+)?)(?=['"\\s,}\\]]|$)`, 'i').exec(text)
    if (found && Number.isFinite(Number(found[1]))) return Number(found[1])
  }
  return undefined
}

export function mediaBalance(id: string, text: string): Pick<Media[string], 'left' | 'total' | 'plan'> | undefined {
  try {
    const v = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text)
    const left = id === 'kling' ? v.availableRemainCredits : id === 'magnific' ? v.credits?.available : undefined
    if (typeof left !== 'number' || !Number.isFinite(left) || left < 0) return undefined
    const total = id === 'magnific' ? v.credits?.totalPlan : undefined
    const plan = id === 'kling' ? v.membershipTypeDescription : v.plan?.productName
    return { left, total: typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : undefined, plan: typeof plan === 'string' ? plan : undefined }
  } catch { return undefined }
}

export function withMediaBalance(old: Media[string], balance: Pick<Media[string], 'left' | 'total' | 'plan'>, at: number): Media[string] {
  const left = balance.left!
  // A top-up raises the baseline too, preserving the spend already counted.
  const base = old.base === undefined ? left : old.base + Math.max(0, left - (old.left ?? left))
  return { ...old, ...balance, base, used: Math.max(0, base - left), at }
}

// List price per credit by plan, Oct 2026: the plan's price over its credits (Magnific's € at about $1.08).
// shortcut: hand-copied from the vendors' pricing pages; update when they change, or set your own rate in Prices.
const PLANS: Record<string, { re: RegExp; rate: number; credits?: number }[]> = {
  elevenlabs: [{ re: /free/i, rate: 0 }, { re: /business|scale|pro/i, rate: 0.000165 }, { re: /starter/i, rate: 0.0002 }, { re: /^/, rate: 0.00018 }],
  magnific: [{ re: /premium\s*(\+|plus)/i, rate: 0.00078 }, { re: /pro/i, rate: 0.00076 }, { re: /^/, rate: 0.00086 }],
  kling: [{ re: /ultra/i, rate: 0.0069, credits: 26000 }, { re: /premier/i, rate: 0.0115, credits: 8000 }, { re: /pro/i, rate: 0.0123, credits: 3000 }, { re: /standard/i, rate: 0.0152, credits: 660 }, { re: /^/, rate: 0.0123 }],
}
export const planOf = (id: string, plan = '') => PLANS[id]?.find(p => p.re.test(plan))
// The $ per credit used: your own rate, else the plan's list price.
export const creditRate = (id: string, plan: string | undefined, own?: number) => own ?? planOf(id, plan)?.rate

export const mediaDollars = (m: Media[string], rate?: number) => m.used !== undefined && rate !== undefined && Number.isFinite(rate) && rate >= 0 ? m.used * rate : undefined
export const usedMedia = (m: Media) => MEDIA.filter(s => m[s.id] && (m[s.id]!.running || Object.values(m[s.id]!.features).some(n => n > 0)))

const checkingMedia = new Map<string, Promise<void>>()
export async function refreshMedia($: EngineInterface, id: string, manual = false, source?: string) {
  const service = MEDIA.find(s => s.id === id)
  const suffix = service?.balance
  if (!suffix || (!manual && !(await read($, guard)).mediaBalances)) return
  const tools = await $.tool.list().catch(() => [])
  const prefix = source?.match(/^mcp__.+?__/)?.[0]
  const tool = prefix ? `${prefix}${suffix}` : tools.find(t => mediaShort(t.name) === suffix && mediaService(t.name)?.id === id)?.name ?? `${id === 'kling' ? 'mcp__kling__' : 'mcp__claude_ai_Magnific__'}${suffix}`
  // Serial reads keep an older response from replacing a newer balance.
  while (checkingMedia.has(id)) await checkingMedia.get(id)
  const pending = readMediaBalance($, id, tool, manual)
  checkingMedia.set(id, pending)
  try { await pending } finally { checkingMedia.delete(id) }
}

async function readMediaBalance($: EngineInterface, id: string, tool: string, manual: boolean) {
  try {
    if (!manual && (await $.tool.check({ tool, input: {} })).decision !== 'allow') return
    const ran = await $.tool.call({ tool })
    const balance = !ran.deny && !ran.isError ? mediaBalance(id, mediaText(ran)) : undefined
    if (balance) {
      const at = await $.clock.now()
      await update($, media, m => ({ ...m, [id]: withMediaBalance(m[id] ?? { features: {} }, balance, at) }))
    } else if (manual) $.ui.toast('Balance not reported')
  } catch {
    if (manual) $.ui.toast('Could not read media balance')
  }
}

export const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
export const addTokens = (a: Tokens, b: Partial<Tokens>): Tokens => ({
  input: a.input + (b.input ?? 0),
  output: a.output + (b.output ?? 0),
  cacheRead: a.cacheRead + (b.cacheRead ?? 0),
  cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
})
export const totalOf = (t: Tokens) => t.input + t.output + t.cacheRead + t.cacheWrite

// The id a price list knows a model by: no provider prefix, context tag, date or effort suffix.
export const priceKey = (model: string) =>
  model
    .replace(/\[.*\]$/, '')
    .split('/')
    .pop()!
    .replace(/-\d{8}$/, '')
    .replace(/-(low|medium|high|xhigh|max|minimal)$/, '')
    .toLowerCase()

// First-party price lists win over resellers' when both list a model.
const FIRST_PARTY = ['anthropic', 'openai', 'google', 'deepseek', 'moonshotai', 'zai', 'zhipuai', 'xai', 'mistral', 'alibaba', 'xiaomi', 'minimax']

// From the models.dev catalogue OpenCode caches: $ per million tokens for the models we need.
export const catalogFrom = (json: any, wanted: Set<string>) => {
  const out: Record<string, Price & { source: string }> = {}
  const rank = (pid: string) => (FIRST_PARTY.includes(pid) ? 0 : pid.startsWith('opencode') ? 1 : 2)
  const best: Record<string, number> = {}
  for (const [pid, p] of Object.entries<any>(json ?? {})) {
    for (const [mid, m] of Object.entries<any>(p?.models ?? {})) {
      const key = priceKey(mid)
      if (!wanted.has(key) || !m?.cost || typeof m.cost.input !== 'number') continue
      const r = rank(pid)
      if (best[key] !== undefined && best[key]! <= r) continue
      best[key] = r
      out[key] = { input: m.cost.input, output: m.cost.output ?? 0, cacheRead: m.cost.cache_read, cacheWrite: m.cost.cache_write, source: pid }
    }
  }
  return out
}

export const priceOf = (prices: Prices, model: string): (Price & { source?: string; edited?: boolean }) | undefined => {
  const key = priceKey(model)
  const o = prices.overrides[key]
  if (o) return { ...prices.catalog[key], ...o, edited: true }
  return prices.catalog[key]
}

// Dollars for a row: what the provider reported if it did, else tokens × price.
export const costOf = (t: Tokens, p?: Price) =>
  p ? (t.input * p.input + t.output * p.output + t.cacheRead * (p.cacheRead ?? p.input * 0.1) + t.cacheWrite * (p.cacheWrite ?? p.input * 1.25)) / 1e6 : undefined
export const rowCost = (r: TokenRow, prices: Prices) => r.reported ?? costOf(r, priceOf(prices, r.model))

export const claudeTotal = (claude: Costs['claude'], prices: Prices) => {
  let usd: number | undefined = 0
  let tokens = 0
  for (const [model, t] of Object.entries(claude)) {
    tokens += totalOf(t)
    const cost = totalOf(t) === 0 ? 0 : costOf(t, priceOf(prices, model))
    usd = usd === undefined || cost === undefined ? undefined : usd + cost
  }
  return { usd, tokens }
}

// ponytail: matching by duration; a turn id in the props would be exact.
export const matchTurnCost = (turns: TurnCost[], durationMs: number) => {
  let best: TurnCost | undefined
  let distance = 2000
  for (const turn of turns) {
    const diff = Math.abs(turn.durationMs - durationMs)
    if (diff <= distance) { best = turn; distance = diff }
  }
  return best
}

// Codex: one line per session file, "model<TAB>last token_count event<TAB>last event before midnight".
export const parseCodexTokens = (text: string): TokenRow[] => {
  const by: Record<string, Tokens> = {}
  for (const line of text.split('\n')) {
    const [m, json, before] = line.split('\t')
    if (!json) continue
    try {
      const u = JSON.parse(json)?.payload?.info?.total_token_usage
      if (!u) continue
      const model = /"model":"([^"]+)"/.exec(m ?? '')?.[1] ?? 'codex'
      const b = before ? JSON.parse(before)?.payload?.info?.total_token_usage : undefined
      const diff = (key: string) => Math.max(0, (u[key] ?? 0) - (b?.[key] ?? 0))
      const cached = diff('cached_input_tokens')
      // OpenAI counts cached tokens inside input_tokens.
      by[model] = addTokens(by[model] ?? zero(), { input: Math.max(0, diff('input_tokens') - cached), output: diff('output_tokens'), cacheRead: cached, cacheWrite: diff('cache_write_input_tokens') })
    } catch {}
  }
  return Object.entries(by).map(([model, t]) => ({ ...t, provider: 'codex', model, period: 'today' }))
}

// Gemini results carry a usage object when the CLI reports one; read what is there.
export const outputTokens = (text: string): number | undefined => {
  const explicit = /"(?:output_tokens|completion_tokens|candidatesTokenCount|outputTokens)"\s*:\s*(\d+)/.exec(text)
  const value = explicit?.[1]
  return value === undefined ? undefined : Number(value)
}

export const parseAgyUsage = (text: string): Partial<Tokens> | undefined => {
  const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? NaN)
  const input = num(/"(?:input_tokens|prompt_tokens|promptTokenCount|inputTokens)"\s*:\s*(\d+)/)
  const output = outputTokens(text) ?? NaN
  const cached = num(/"(?:cached_tokens|cachedContentTokenCount|cache_read_input_tokens|cache_read_tokens)"\s*:\s*(\d+)/)
  if (Number.isNaN(input) && Number.isNaN(output)) return undefined
  return { input: Number.isNaN(input) ? 0 : input, output: Number.isNaN(output) ? 0 : output, cacheRead: Number.isNaN(cached) ? 0 : cached }
}

export const money = (usd?: number) => (usd === undefined ? '—' : usd >= 100 ? `$${usd.toFixed(0)}` : usd >= 1 ? `$${usd.toFixed(2)}` : usd > 0 ? `$${usd.toFixed(3)}` : '$0')

export const capWindow = (p: Provider) => p === 'claude' || p === 'antigravity' ? 'per chat' : 'a day'

export const unpricedModels = (c: Costs, pr: Prices, p: Provider) => {
  const rows: TokenRow[] = p === 'claude' || p === 'antigravity'
    ? Object.entries(p === 'claude' ? c.claude : c.agy).map(([model, t]) => ({ ...t, model, provider: p, period: 'session' }))
    : c.rows.filter(r => r.provider === p)
  return [...new Set(rows.filter(r => (totalOf(r) > 0 || (r.reported ?? 0) > 0) && (r.credits || rowCost(r, pr) === undefined)).map(r => r.model))]
}

// Unknown prices disable a cap instead of silently counting those tokens as free.
export const spendBy = (c: Costs, pr: Prices, ccBase?: { day: string; value: number }, today = '') => {
  const sum = (rows: TokenRow[]) => rows.reduce((t, r) => t + (rowCost(r, pr) ?? 0), 0)
  const session = (rec: Record<string, Tokens>, provider: Provider) => sum(Object.entries(rec).map(([model, t]) => ({ ...t, provider, model, period: 'session' as const })))
  const out: Partial<Record<Provider, number>> = {
    claude: Math.max(session(c.claude, 'claude'), c.engineUsd ?? 0),
    codex: sum(c.rows.filter(r => r.provider === 'codex')),
    opencode: sum(c.rows.filter(r => r.provider === 'opencode')),
    antigravity: session(c.agy, 'antigravity'),
    // Local models run on this machine: no bill and no quota.
    ollama: 0,
  }
  const cc = sum(c.rows.filter(r => r.provider === 'commandcode'))
  if (ccBase && ccBase.day === today) out.commandcode = cc >= ccBase.value ? cc - ccBase.value : cc
  for (const p of ['claude', 'codex', 'opencode', 'antigravity', 'commandcode'] as Provider[]) {
    if (unpricedModels(c, pr, p).length) delete out[p]
  }
  return out
}

// What each side provider's figures added since the session's first reading. A total that went down
// started a new day or billing period, so all of it is this session's; a row that did not move is left out.
export const sessionRows = (rows: TokenRow[], base: TokenRow[]): TokenRow[] =>
  rows.flatMap(r => {
    const b = base.find(x => x.provider === r.provider && x.model === r.model)
    const d = b ? { input: r.input - b.input, output: r.output - b.output, cacheRead: r.cacheRead - b.cacheRead, cacheWrite: r.cacheWrite - b.cacheWrite, reported: r.reported === undefined ? undefined : r.reported - (b.reported ?? 0) } : undefined
    const fresh = !d || d.input < 0 || d.output < 0 || d.cacheRead < 0 || d.cacheWrite < 0 || (d.reported ?? 0) < 0
    const out = fresh ? r : { ...r, ...d }
    return !fresh && !out.input && !out.output && !out.cacheRead && !out.cacheWrite && !out.reported ? [] : [{ ...out, period: 'session' as const }]
  })
