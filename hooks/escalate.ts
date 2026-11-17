// When a side lane's answer cannot be used, the task goes once to a Claude model, never to another side lane:
// Ollama's to Haiku, Gemini's to Sonnet. Claude is the step up for private and client work too, as it never
// leaves the owner's own Claude account for a cloud side lane.
export const ESCALATE_TO = {
  ollama: { model: 'claude-haiku-5-5', alias: 'haiku', name: 'Claude Haiku' },
  gemini: { model: 'claude-sonnet-5-5', alias: 'sonnet', name: 'Claude Sonnet' },
} as const
export type SideLane = keyof typeof ESCALATE_TO

export type Format = 'json' | { type?: string; required?: string[]; properties?: Record<string, { type?: string }> }

const typeOk = (v: unknown, t?: string) => !t || (t === 'array' ? Array.isArray(v) : t === 'integer' ? Number.isInteger(v) : t === 'null' ? v === null : t === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === t)

// Answers only: a model's JSON may sit in a code fence.
const unfence = (s: string) => /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/.exec(s)?.[1] ?? s

// Why an answer fails, or undefined when it is usable.
export function failure(text: string, opts: { doneReason?: string; format?: Format } = {}): string | undefined {
  const t = text.trim()
  if (!t) return 'it returned an empty answer'
  if (opts.doneReason === 'input-cut') return 'its input did not fit the context window and was cut off'
  if (opts.doneReason === 'length') return 'its answer was cut off at the length limit'
  // Antigravity's plan mode sometimes writes a plan file and links it instead of answering.
  if (/file:\/\/\S*\/brain\/\S+\.md/.test(t) && /\bplan\b/i.test(t)) return 'it wrote a plan file instead of answering'
  if (opts.format) {
    let v: unknown
    try { v = JSON.parse(unfence(t)) } catch { return 'its answer is not valid JSON' + (/[{[,:]\s*$/.test(t) ? ' (cut off)' : '') }
    if (typeof opts.format === 'object') {
      const f = opts.format
      if (!typeOk(v, f.type ?? (f.properties || f.required ? 'object' : undefined))) return `its JSON is not ${f.type ?? 'an object'}`
      const o = v as Record<string, unknown>
      const missing = (f.required ?? []).filter(k => !(k in o))
      if (missing.length) return `its JSON lacks ${missing.join(', ')}`
      const wrong = Object.entries(f.properties ?? {}).filter(([k, p]) => k in o && !typeOk(o[k], p.type)).map(([k]) => k)
      if (wrong.length) return `its JSON has the wrong type for ${wrong.join(', ')}`
    }
  }
  return undefined
}

// The tool result that sends the task to Claude, once.
export function escalation(from: SideLane, why: string, decl: { type?: string; sensitivity?: string } = {}) {
  const to = ESCALATE_TO[from]
  const head = `task:${decl.type ?? (from === 'gemini' ? 'visual' : 'summarise')} sensitivity:${decl.sensitivity ?? 'internal'} escalated`
  return `ESCALATED: ${from === 'ollama' ? 'Ollama' : 'Gemini'}'s answer cannot be used (${why}). Do not use it and do not retry ${from === 'ollama' ? 'ollama_run' : 'gemini_run'} for this task. ` +
    `Redo the whole task once on ${to.name} (${to.model}): call the Agent tool with model "${to.alias}", a description starting "${head}", and the full task and its input in prompt.` +
    (from === 'gemini' ? ' Copy any image paths into the prompt so the subagent can Read them.' : '') +
    ' Never send it to Gemini or another cloud side lane.'
}

export const isEscalated = (rest: string) => /^escalated\b/i.test(rest.trim())
