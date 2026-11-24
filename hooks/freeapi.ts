import type { EngineInterface } from 'claude-code'

type $ = EngineInterface

// Free-tier cloud APIs that all speak the OpenAI chat-completions shape. They are a side lane for PUBLIC text jobs only:
// free tiers may train on prompts, so nothing internal or client-owned ever goes here (the tool enforces it).
// Model ids on free tiers change without notice: the defaults below are a starting point, and `model` overrides them.
export type FreeId = 'groq' | 'cerebras' | 'openrouter'
export const FREE_PROVIDERS: Record<FreeId, { name: string; url: string; model: string; option: string }> = {
  cerebras: { name: 'Cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama3.1-8b', option: 'cerebrasApiKey' },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', option: 'groqApiKey' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct:free', option: 'openrouterApiKey' },
}
// Fastest first; OpenRouter last as the catch-all fallback.
export const FREE_ORDER: FreeId[] = ['cerebras', 'groq', 'openrouter']
export const FREE_TIMEOUT_MS = 60_000

export type FreeKeys = Partial<Record<FreeId, string>>
export type FreeRun = {
  ok: boolean
  provider: FreeId
  model: string
  text: string
  inputTokens?: number
  outputTokens?: number
  ms?: number
  // Why it failed, for the log and for choosing whether to try the next provider.
  error?: string
  retry?: boolean
}

// The keys the owner set in the mod's options; a blank or missing key means that provider is not set up.
export function keysOf(options: unknown): FreeKeys {
  const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
  const keys: FreeKeys = {}
  for (const id of FREE_ORDER) {
    const v = o[FREE_PROVIDERS[id].option]
    if (typeof v === 'string' && v.trim()) keys[id] = v.trim()
  }
  return keys
}

export const freeBody = (model: string, prompt: string, opts: { system?: string; json?: boolean } = {}) => ({
  model,
  messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), { role: 'user', content: prompt }],
  temperature: 0.2,
  stream: false,
  ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
})

// One call to one provider. Never throws: a failure comes back with `retry` saying whether another provider could do better.
export async function freeRun($: $, id: FreeId, key: string, prompt: string, opts: { model?: string; system?: string; json?: boolean } = {}): Promise<FreeRun> {
  const p = FREE_PROVIDERS[id]
  const model = opts.model || p.model
  const start = await $.clock.now()
  const fail = (error: string, retry: boolean): FreeRun => ({ ok: false, provider: id, model, text: '', error: `${p.name}: ${error}`.slice(0, 300), retry })
  let response: { status: number; ok: boolean; text: string }
  let timer: ReturnType<$['clock']['after']> | undefined
  try {
    response = await Promise.race([
      $.http.fetch(p.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(freeBody(model, prompt, opts)) }),
      new Promise<never>((_resolve, reject) => { timer = $.clock.after(FREE_TIMEOUT_MS, () => reject(new Error('no answer in time'))) }),
    ])
  } catch (err) {
    return fail(String((err as Error)?.message ?? err), true)
  } finally { timer?.cancel() }
  let json: any = {}
  try { json = JSON.parse(response.text) } catch {}
  if (!response.ok) {
    const why = String(json?.error?.message ?? json?.error ?? `HTTP ${response.status}`)
    // Rate limits, outages and a bad key are another provider's chance; a malformed request would fail everywhere.
    return fail(why, response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500)
  }
  const text = json?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) return fail('an empty answer', true)
  const inputTokens = typeof json?.usage?.prompt_tokens === 'number' ? json.usage.prompt_tokens : undefined
  const outputTokens = typeof json?.usage?.completion_tokens === 'number' ? json.usage.completion_tokens : undefined
  return { ok: true, provider: id, model: typeof json?.model === 'string' ? json.model : model, text, inputTokens, outputTokens, ms: (await $.clock.now()) - start }
}

// The providers to try, in order: the one asked for alone, else every one with a key, fastest first.
export function freePlan(keys: FreeKeys, asked?: unknown): FreeId[] {
  if (typeof asked === 'string' && asked in FREE_PROVIDERS) return keys[asked as FreeId] ? [asked as FreeId] : []
  return FREE_ORDER.filter(id => keys[id])
}

export async function freeChain($: $, keys: FreeKeys, prompt: string, opts: { provider?: unknown; model?: string; system?: string; json?: boolean } = {}): Promise<{ run?: FreeRun; errors: string[] }> {
  const plan = freePlan(keys, opts.provider)
  const errors: string[] = []
  if (!plan.length) return { errors: [typeof opts.provider === 'string' && opts.provider in FREE_PROVIDERS ? `no ${FREE_PROVIDERS[opts.provider as FreeId].name} key is set in the mod's options` : 'no free-API key is set in the mod\'s options (groqApiKey, cerebrasApiKey, openrouterApiKey)'] }
  for (const id of plan) {
    // A model named for one provider means nothing to the next.
    const run = await freeRun($, id, keys[id]!, prompt, { ...opts, model: plan.length === 1 ? opts.model : undefined })
    if (run.ok) return { run, errors }
    errors.push(run.error ?? `${id} failed`)
    if (!run.retry) break
  }
  return { errors }
}
