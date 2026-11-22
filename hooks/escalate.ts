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

// ---------- the shape a prompt asks for, and tidying a small local model's answer to it ----------
// Small local models get the content right more often than the format: a correct regex wrapped in an explanation,
// a fourth bullet when three were asked for. The answer is tidied to the shape the prompt's own words ask for; one
// that still breaks it (too long, wrong count, not JSON) is escalated like any unusable answer.

export type Shape = { only?: 'json' | 'code' | 'text'; oneLine?: boolean; maxChars?: number; bullets?: number }

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const num = (w: string) => NUM[w.toLowerCase()] ?? Number(w)

export function shapeOf(prompt: string, system = ''): Shape {
  const t = `${system}\n${prompt}`.slice(0, 4000)       // the instructions sit at the start, before any pasted input
  const s: Shape = {}
  if (/\b(json only|only (?:the |a |valid )?json|return json\b|output json\b)/i.test(t)) s.only = 'json'
  else if (/\b(?:output|reply with|return|give|respond with)\s+(?:only|just)\b|\bonly the (?:code|pattern|regex|function|query|command)\b|\bnothing else\b/i.test(t))
    s.only = /\b(code|pattern|regex|function|query|command|class|snippet)\b/i.test(t) ? 'code' : 'text'
  if (/\b(one|single)[- ]line\b/i.test(t)) s.oneLine = true
  const max = /\b(?:max(?:imum)?|at most|up to|no more than)\s*(\d{2,4})\s*char/i.exec(t) ?? /\b(\d{2,4})\s*char(?:acter)?s?\s*(?:max|or (?:less|fewer))/i.exec(t)
  if (max) s.maxChars = Number(max[1])
  const b = /\bexactly\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:short\s+)?bullet/i.exec(t)
  if (b) s.bullets = num(b[1]!)
  return s
}

const FENCE = /```[\w+-]*\s*\n([\s\S]*?)\n?```/
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/
const CHATTER = /^(?:here(?:'|’)?s|here is|sure|certainly|of course|below is|the following|this (?:regex|pattern|function|code|query))\b.*[:.]?\s*$/i

export function tidy(text: string, shape: Shape): string {
  let t = text.trim()
  if (shape.only) {
    const fenced = FENCE.exec(t)?.[1]
    if (fenced !== undefined) t = fenced.trim()
    else if (shape.only === 'json') {
      const start = t.search(/[[{]/), end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
      if (start >= 0 && end > start) t = t.slice(start, end + 1)
    } else {
      const lines = t.split('\n')
      while (lines.length > 1 && CHATTER.test(lines[0]!.trim())) lines.shift()        // "Here's the pattern:" before it
      const gap = lines.findIndex((l, i) => i > 0 && !l.trim())                          // an explanation after a blank line
      if (gap > 0 && /^(?:this|here|explanation|note|it |the (?:regex|pattern|function|code))/i.test((lines[gap + 1] ?? '').trim())) lines.length = gap
      t = lines.join('\n').trim()
    }
  }
  if (shape.oneLine) {
    const line = t.split('\n').map(l => l.trim()).find(l => l && !CHATTER.test(l)) ?? ''
    t = line.replace(/^(?:commit message|message|subject)\s*:\s*/i, '').replace(/^["'`]+|["'`]+$/g, '').trim()
  }
  if (shape.bullets) {
    const lines = t.split('\n')
    const idx = lines.map((l, i) => BULLET.test(l) ? i : -1).filter(i => i >= 0)
    if (idx.length > shape.bullets) {
      const keep = new Set<number>()
      idx.slice(0, shape.bullets).forEach((at, k) => {                                 // a bullet's own wrapped lines stay with it
        const next = idx[k + 1] ?? lines.length
        for (let i = at; i < next && (i === at || (lines[i]!.trim() && !BULLET.test(lines[i]!))); i++) keep.add(i)
      })
      t = lines.filter((_, i) => keep.has(i)).join('\n').trim()
    }
  }
  return t
}

// Why a tidied answer still breaks the shape asked for, or undefined.
export function shapeFailure(text: string, shape: Shape): string | undefined {
  if (shape.only === 'json') { try { JSON.parse(text) } catch { return 'the prompt asked for JSON only and its answer is not valid JSON' } }
  if (shape.oneLine && text.includes('\n')) return 'the prompt asked for one line and its answer has several'
  if (shape.maxChars && text.length > shape.maxChars) return `its answer is ${text.length} characters, over the ${shape.maxChars} asked for`
  if (shape.bullets) {
    const n = text.split('\n').filter(l => BULLET.test(l)).length
    if (n !== shape.bullets) return `it gave ${n} bullet point${n === 1 ? '' : 's'}, not the ${shape.bullets} asked for`
  }
  return undefined
}
