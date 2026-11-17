import type { EngineInterface } from 'claude-code'
import { locate } from './providers'

type $ = EngineInterface

// One Gemini answer through the Antigravity CLI, with no babysitter: `agy -p` in plan mode and a
// sandbox, from a fresh empty folder that holds only the images it was given and is deleted after.
export const GEMINI_TIMEOUT_S = 240
const TEMP = /^\/(?:private\/)?(?:tmp|var\/folders\/[\w+/-]+)\/ao-gemini\.[A-Za-z0-9]{6,}$/
export const isGeminiTemp = (dir: string) => TEMP.test(dir) && !dir.includes('..')

export const geminiPrompt = (prompt: string, dir: string, images: string[], json: boolean) => [
  ...images.map(name => `Open the image ${dir}/${name} with your file viewing tool (do not run any shell command) and look at it.`),
  prompt,
  json ? 'Reply with JSON only: no prose, no code fence.' : '',
  'Answer in your reply itself. Do not write files, plans or artifacts.',
].filter(Boolean).join('\n\n')

export const geminiArgv = (bin: string, model: string, prompt: string) =>
  [bin, '--model', model, '--sandbox', '--mode', 'plan', '--print-timeout', `${GEMINI_TIMEOUT_S}s`, '--output-format', 'json', '-p', prompt]

export type GeminiOut = { text: string; status: string; inputTokens?: number; outputTokens?: number; ms?: number; denied?: string[]; error?: string }

// The CLI prints notices before its JSON; the last object is the answer.
export function parseGemini(stdout: string, stderr = ''): GeminiOut {
  const start = stdout.indexOf('{"')
  let json: any
  try { json = start >= 0 ? JSON.parse(stdout.slice(start)) : undefined } catch {}
  if (!json) return { text: '', status: 'ERROR', error: (stderr || stdout).trim().slice(0, 300) || 'no answer' }
  const u = json.usage ?? {}
  return {
    text: typeof json.response === 'string' ? json.response.trim() : '',
    status: String(json.status ?? 'ERROR'),
    inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
    outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
    ms: typeof json.duration_seconds === 'number' ? Math.round(json.duration_seconds * 1000) : undefined,
    denied: Array.isArray(json.denied_actions) ? json.denied_actions.map((d: any) => String(d?.display_name ?? d?.action ?? '')) : undefined,
    error: json.status === 'SUCCESS' ? undefined : String(json.error ?? json.status ?? 'failed').slice(0, 300),
  }
}

const safeName = (path: string, i: number) => `${i + 1}-${(path.split('/').pop() ?? 'image').replace(/[^\w.-]/g, '_').slice(-60)}`

export async function geminiRun($: $, input: { model: string; prompt: string; images?: string[]; json?: boolean }): Promise<GeminiOut> {
  const bin = await locate($, 'agy')
  if (!bin) return { text: '', status: 'ERROR', error: 'the Antigravity CLI (agy) is not installed' }
  const made = await $.process.run(['/usr/bin/mktemp', '-d', '/tmp/ao-gemini.XXXXXXXX'], { timeoutMs: 5000 })
  const dir = made.stdout.trim()
  if (made.exitCode !== 0 || !isGeminiTemp(dir)) return { text: '', status: 'ERROR', error: 'could not make a temp folder' }
  try {
    const names: string[] = []
    for (const [i, path] of (input.images ?? []).entries()) {
      const name = safeName(path, i)
      const cp = await $.process.run(['/bin/cp', '--', path, `${dir}/${name}`], { timeoutMs: 10000 })
      if (cp.exitCode !== 0) return { text: '', status: 'ERROR', error: `could not read image ${path}` }
      names.push(name)
    }
    const r = await $.process.run(geminiArgv(bin, input.model, geminiPrompt(input.prompt, dir, names, !!input.json)), { cwd: dir, timeoutMs: (GEMINI_TIMEOUT_S + 30) * 1000, stdin: "" })
    return parseGemini(r.stdout, r.stderr)
  } finally {
    // The folder is ours alone: checked against its own pattern before removal.
    if (isGeminiTemp(dir)) await $.process.run(['/bin/rm', '-rf', '--', dir], { timeoutMs: 10000 }).catch(() => undefined)
  }
}
