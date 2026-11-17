import type { EngineInterface } from 'claude-code'
import { locate } from './providers'

type $ = EngineInterface

// Antigravity's CLI runs only through gemini_run, which carries the allowlist, the sensitivity and the image checks.
// A Bash command that would run agy in any form is refused: its name in the text (also quoted, escaped, split across
// variables, inside sh -c, backticks or $()), the resolved agy binary's path, a command word that is a symlink to it,
// and the obfuscations that hide a name (hex or octal escapes, base64 or xxd decoding).

const AGY = /(?:^|[^A-Za-z0-9_])agy(?![A-Za-z0-9_])/
const OBFUSCATED = /\\x[0-9a-f]{2}|\\[0-7]{3}|\\u00[0-9a-f]{2}|base64\s+(?:-d|-D|--decode)|\bxxd\s+-r/i

// Quotes and backslashes are removed, so a''gy, "ag"y and ag\y read as agy.
const squash = (s: string) => s.replace(/\$'/g, '').replace(/['"\\]/g, '')

// Simple assignments (A=agy, B="ag" C='y') are substituted into $A, ${A} and "$A$B" a few times over.
export function expandVars(command: string): string {
  const vars = new Map<string, string>()
  for (const m of command.matchAll(/(?:^|[\s;&|(])([A-Za-z_]\w*)=("[^"\n]*"|'[^'\n]*'|[^\s;&|()]*)/g)) vars.set(m[1]!, m[2]!.replace(/^(["'])(.*)\1$/, '$2'))
  let out = command
  for (let i = 0; i < 4 && vars.size; i++) {
    const next = out.replace(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g, (all, a, b) => vars.get(a ?? b) ?? all)
    if (next === out) break
    out = next
  }
  return out
}

// Why the text of a command runs agy, or undefined.
export function agyInText(command: string, bins: string[] = []): string | undefined {
  const forms = [command, squash(command), expandVars(command), squash(expandVars(command))]
  if (forms.some(f => AGY.test(f))) return 'it names agy'
  for (const b of bins) if (b && forms.some(f => f.includes(b))) return `it names the agy binary ${b}`
  if (OBFUSCATED.test(command)) return 'it hides what it runs (escapes or decoding), so it cannot be checked for agy'
  return undefined
}

const WRAPPERS = /^(?:nohup|env|exec|time|timeout|command|builtin|sudo|nice|xargs|stdbuf|caffeinate|setsid|then|do|else|if|while|until|!)$/
const SHELL_C = /\b(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*c\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/g

// The command word of every simple command, wrappers and sh -c bodies unwrapped.
export function programWords(command: string, depth = 0): string[] {
  const out: string[] = []
  if (depth > 3) return out
  for (const m of command.matchAll(SHELL_C)) out.push(...programWords(m[1] ?? m[2] ?? '', depth + 1))
  for (const seg of command.split(/&&|\|\||[;&|()`\n]|\$\(/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (i < words.length) {
      const w = squash(words[i]!)
      if (/^[A-Za-z_]\w*=/.test(w) || WRAPPERS.test(w) || w.startsWith('-') || /^\d+[smhd]?$/.test(w)) { i++; continue }
      out.push(w)
      break
    }
  }
  return out
}

const seen = new Map<string, { at: number; why?: string }>()
async function resolved($: $, word: string, cwd: string): Promise<string | undefined> {
  let path = word
  if (!word.includes('/')) {
    const w = await $.process.run(['/usr/bin/which', word], { cwd, timeoutMs: 3000 }).catch(() => undefined)
    path = w?.exitCode === 0 ? w.stdout.trim().split('\n')[0] ?? '' : ''
    if (!path) return undefined
  }
  const r = await $.process.run(['/usr/bin/readlink', '-f', '--', path], { cwd, timeoutMs: 3000 }).catch(() => undefined)
  const out = r?.exitCode === 0 ? r.stdout.trim() : ''
  return out.startsWith('/') ? out : undefined
}

// Why this Bash command would run agy, or undefined: the text first, then each command word followed through PATH and symlinks.
export async function runsAgy($: $, command: string, cwd: string): Promise<string | undefined> {
  const bin = await locate($, 'agy').catch(() => undefined)
  const real = bin ? await resolved($, bin, cwd) : undefined
  const text = agyInText(command, [bin, real].filter((x): x is string => !!x))
  if (text) return text
  const now = await $.clock.now()
  for (const word of [...new Set(programWords(command))].slice(0, 8)) {
    const key = word.includes('/') ? `${cwd}\0${word}` : word
    const hit = seen.get(key)
    if (hit && now - hit.at < 30_000) { if (hit.why) return hit.why; continue }
    const target = await resolved($, word, cwd)
    const why = target && (target.split('/').pop() === 'agy' || target === real) ? `${word} resolves to the agy binary (${target})` : undefined
    if (seen.size > 400) seen.clear()
    seen.set(key, { at: now, why })
    if (why) return why
  }
  return undefined
}
