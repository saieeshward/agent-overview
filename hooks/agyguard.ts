import type { EngineInterface } from 'claude-code'
import { locate } from './providers'

type $ = EngineInterface

// Antigravity's CLI runs only through gemini_run, which carries the allowlist, the sensitivity and the image checks.
// A Bash command that would run agy in any form is refused. The command is read the way a shell reads it: quotes,
// escapes, variables, heredocs, $(), backticks, sh -c, eval and wrappers (env, xargs, find -exec...) are unwrapped, and
// only a COMMAND WORD is judged: the name agy, a path ending in it, a glob that could expand to it, the resolved binary
// (and a symlink to it, in runsAgy), and a shell script file whose text runs it. The name inside an argument, a path
// segment (src/agy.ts), a quoted string or heredoc text that is not executed is just data and passes. Text that is
// decoded or built at run time (base64 -d, xxd -r, printf or echo escapes, rev) is refused only when it reaches a shell,
// eval or the command word, where it could not be checked.

const MARK = '\u0001' // stands for a $(), backtick or <() substitution inside a word
const ESC = /\\(?:x[0-9a-fA-F]{1,2}|[0-7]{1,3}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})/

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

// ---------- reading a command like a shell ----------

type Cmd = { words: string[]; subs: string[]; pipeNext: boolean; escaped: boolean; heredocs: { body: string; quoted: boolean }[] }
const fresh = (): Cmd => ({ words: [], subs: [], pipeNext: false, escaped: false, heredocs: [] })

const ANSI: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }
const ansi = (s: string) => s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|.)/g, (_, g: string) =>
  /^x/.test(g) ? String.fromCharCode(parseInt(g.slice(1), 16)) : /^[0-7]/.test(g) ? String.fromCharCode(parseInt(g, 8)) : /^[uU]./.test(g) && g.length > 1 ? String.fromCodePoint(parseInt(g.slice(1), 16)) : ANSI[g] ?? g)

// The body of a $( or ( that opens just before `from`, and where it ends.
function readParen(t: string, from: number): [string, number] {
  let depth = 1, i = from
  for (; i < t.length; i++) {
    const c = t[i]!
    if (c === '\\') i++
    else if (c === "'") { const j = t.indexOf("'", i + 1); i = j < 0 ? t.length : j }
    else if (c === '"') { for (i++; i < t.length && t[i] !== '"'; i++) if (t[i] === '\\') i++ }
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return [t.slice(from, i), i + 1]
  }
  return [t.slice(from), t.length]
}
function readTick(t: string, from: number): [string, number] {
  let i = from
  for (; i < t.length && t[i] !== '`'; i++) if (t[i] === '\\') i++
  return [t.slice(from, i), i + 1]
}
// The commands an unquoted heredoc body would run through $() and backticks.
function inlineSubs(body: string): string[] {
  const out: string[] = []
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') i++
    else if (body[i] === '$' && body[i + 1] === '(') { const [b, n] = readParen(body, i + 2); out.push(b); i = n - 1 }
    else if (body[i] === '`') { const [b, n] = readTick(body, i + 1); out.push(b); i = n - 1 }
  }
  return out
}

export function parse(text: string): Cmd[] {
  const cmds: Cmd[] = []
  let cur = fresh(), word = '', inWord = false, skipTarget = false
  const pend: { delim: string; strip: boolean; quoted: boolean; cmd: Cmd }[] = []
  const endWord = () => { if (inWord) { if (skipTarget) skipTarget = false; else cur.words.push(word) } word = ''; inWord = false }
  const endCmd = (pipe = false) => {
    endWord()
    if (cur.words.length || cur.subs.length || cur.heredocs.length) { cur.pipeNext = pipe; cmds.push(cur); cur = fresh() }
  }
  const sub = (body: string) => { cur.subs.push(body); word += MARK; inWord = true }
  const heredocs = (from: number) => {
    let i = from
    for (const p of pend) {
      const lines: string[] = []
      while (i < text.length) {
        let nl = text.indexOf('\n', i); if (nl < 0) nl = text.length
        const line = text.slice(i, nl); i = nl + 1
        if ((p.strip ? line.replace(/^\t+/, '') : line) === p.delim) break
        lines.push(line)
      }
      p.cmd.heredocs.push({ body: lines.join('\n'), quoted: p.quoted })
    }
    pend.length = 0
    return i
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]!, n = text[i + 1]
    if (c === '\n') { endCmd(); i++; if (pend.length) i = heredocs(i); continue }
    if (c === '\\') {
      if (n === '\n') { i += 2; continue }
      if (n !== undefined) { word += n; inWord = true }
      i += 2; continue
    }
    if (c === "'") {
      const j = text.indexOf("'", i + 1), s = text.slice(i + 1, j < 0 ? text.length : j)
      word += s; inWord = true; if (ESC.test(s)) cur.escaped = true
      i = j < 0 ? text.length : j + 1; continue
    }
    if (c === '"') {
      let s = ''
      for (i++; i < text.length && text[i] !== '"'; i++) {
        const d = text[i]!
        if (d === '\\' && i + 1 < text.length) { const e = text[++i]!; if (/[$"\\`]/.test(e)) s += e; else if (e !== '\n') s += `\\${e}` }
        else if (d === '$' && text[i + 1] === '(') { const [b, nx] = readParen(text, i + 2); cur.subs.push(b); s += MARK; i = nx - 1 }
        else if (d === '`') { const [b, nx] = readTick(text, i + 1); cur.subs.push(b); s += MARK; i = nx - 1 }
        else s += d
      }
      i++; word += s; inWord = true; if (ESC.test(s)) cur.escaped = true
      continue
    }
    if (c === '$' && n === "'") {
      let j = i + 2
      for (; j < text.length && text[j] !== "'"; j++) if (text[j] === '\\') j++
      const s = text.slice(i + 2, j)
      word += ansi(s); inWord = true; if (ESC.test(s)) cur.escaped = true
      i = j + 1; continue
    }
    if (c === '$' && n === '(') { const [b, nx] = readParen(text, i + 2); sub(b); i = nx; continue }
    if (c === '`') { const [b, nx] = readTick(text, i + 1); sub(b); i = nx; continue }
    if ((c === '<' || c === '>') && n === '(') { const [b, nx] = readParen(text, i + 2); sub(b); i = nx; continue }
    // Redirections: their target is data (or a heredoc), not a command word.
    const num = !inWord && /^\d+(?=[<>])/.exec(text.slice(i, i + 4))
    if (c === '<' || c === '>' || num || (c === '&' && n === '>')) {
      if (num) i += num[0].length
      endWord()
      if (text.startsWith('<<<', i)) { i += 3; skipTarget = true; continue }
      if (text.startsWith('<<', i)) {
        i += 2
        const strip = text[i] === '-'; if (strip) i++
        while (text[i] === ' ' || text[i] === '\t') i++
        let j = i
        for (; j < text.length && !/[\s;&|()<>]/.test(text[j]!); j++) if (text[j] === "'" || text[j] === '"') { const q = text.indexOf(text[j]!, j + 1); j = q < 0 ? text.length : q }
        const raw = text.slice(i, j)
        pend.push({ delim: raw.replace(/['"\\]/g, ''), strip, quoted: /['"\\]/.test(raw), cmd: cur })
        i = j; continue
      }
      while (i < text.length && /[<>&]/.test(text[i]!)) i++
      skipTarget = true
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue }
    if (c === ';') { endCmd(); i++; continue }
    if (c === '&') { endCmd(); i += n === '&' ? 2 : 1; continue }
    if (c === '|') { const pipe = n !== '|'; endCmd(pipe); i += n === '|' || n === '&' ? 2 : 1; continue }
    if (c === '(' || c === ')') { endCmd(); i++; continue }
    if (c === '#' && !inWord) { while (i < text.length && text[i] !== '\n') i++; continue }
    word += c; inWord = true; i++
  }
  endCmd()
  if (pend.length) heredocs(text.length)
  return cmds
}

// ---------- which word runs ----------

const WRAPPERS = /^(?:nohup|env|exec|time|timeout|command|builtin|sudo|nice|xargs|stdbuf|caffeinate|setsid|then|do|else|elif|if|while|until|!|\{|\})$/
const SHELLS = /^(?:ba|z|da|k|a)?sh$/
const base = (w: string) => w.split('/').pop() ?? ''

function cmdWord(words: string[]): { i: number; via: string[] } {
  const via: string[] = []
  let i = 0
  for (; i < words.length; i++) {
    const w = words[i]!
    if (/^[A-Za-z_]\w*=/.test(w) || w.startsWith('-') || /^\d+[smhd]?$/.test(w)) continue
    if (WRAPPERS.test(w)) { via.push(w); continue }
    break
  }
  return { i, via }
}

function braces(s: string, depth = 0): string[] {
  const m = /\{([^{}]*,[^{}]*)\}/.exec(s)
  if (!m || depth > 3) return [s]
  return m[1]!.split(',').flatMap(alt => braces(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length), depth + 1)).slice(0, 64)
}
function globRe(g: string): RegExp {
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!
    if (c === '*') re += '.*'
    else if (c === '?') re += '.'
    else if (c === '[') {
      const j = g.indexOf(']', i + 2)
      if (j < 0) { re += '\\['; continue }
      re += `[${g.slice(i + 1, j).replace(/^[!^]/, '^').replace(/\\/g, '\\\\')}]`
      i = j
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}
// Does this command word name agy: literally, by path, or as a glob/brace pattern that could expand to it or to a known binary?
function nameHit(word: string, bins: string[]): boolean {
  for (const w of braces(word)) {
    const b = base(w)
    if (/^agy$/i.test(b)) return true
    if (/[?*[]/.test(w)) {
      const targets = ['agy', ...bins.map(base)]
      if (targets.some(t => globRe(base(w)).test(t)) || bins.some(p => globRe(w).test(p))) return true
    }
  }
  return false
}

const isDecoder = (cw: string, args: string[], escaped: boolean) => {
  const b = base(cw)
  return (b === 'base64' && args.some(a => /^(?:--decode|-[A-Za-z]*[dD][A-Za-z]*)$/.test(a)))
    || (b === 'openssl' && args.includes('base64') && args.some(a => /^-[A-Za-z]*d/.test(a)))
    || (b === 'xxd' && args.some(a => /^-[a-z]*r[a-z]*$/.test(a)))
    || b === 'rev'
    || ((b === 'printf' || b === 'echo') && (escaped || args.some(a => ESC.test(a))))
}

type Scan = { why?: string; scripts: string[]; decodes: boolean; words: string[] }

// Why this text runs agy (or hides what it runs), the shell script files it would run, and every command word.
function scan(text: string, bins: string[], depth = 0): Scan {
  const out: Scan = { scripts: [], decodes: false, words: [] }
  if (depth > 4) return out
  const cmds = parse(expandVars(text))
  const stdinShell: boolean[] = [], decoder: boolean[] = []
  const merge = (r: Scan) => { out.scripts.push(...r.scripts); out.words.push(...r.words); if (r.decodes) out.decodes = true; if (r.why && !out.why) out.why = r.why }
  for (const [k, cmd] of cmds.entries()) {
    const { i, via } = cmdWord(cmd.words)
    const cw = cmd.words[i], args = cmd.words.slice(i + 1)
    const subRes = cmd.subs.map(s => scan(s, bins, depth + 1))
    subRes.forEach(merge)
    const subDecodes = subRes.some(r => r.decodes)
    for (const h of cmd.heredocs) if (!h.quoted) inlineSubs(h.body).forEach(s => merge(scan(s, bins, depth + 1)))
    stdinShell[k] = false; decoder[k] = false
    if (out.why) return out
    for (const b of bins) if (b && cmd.words.some(w => w.includes(b))) return { ...out, why: `it names the agy binary ${b}` }
    if (!cw) continue
    if (via.includes('command') && cmd.words.slice(0, i).some(w => w === '-v' || w === '-V')) continue
    out.words.push(cw)
    if (nameHit(cw, bins)) return { ...out, why: 'it runs agy' }
    decoder[k] = isDecoder(cw, args, cmd.escaped)
    if (decoder[k]) out.decodes = true
    const w = base(cw)
    let execs = cw.includes(MARK)
    if (SHELLS.test(w)) {
      execs = true
      const ci = args.findIndex(a => /^-[A-Za-z]*c[A-Za-z]*$/.test(a))
      const file = args.find(a => !a.startsWith('-'))
      if (ci >= 0 && args[ci + 1] !== undefined) merge(scan(args[ci + 1]!, bins, depth + 1))
      else if (file && file !== '/dev/stdin') out.scripts.push(file)
      else stdinShell[k] = true
      if (ci < 0 && stdinShell[k]) for (const h of cmd.heredocs) merge(scan(h.body, bins, depth + 1))
      if (via.includes('xargs')) stdinShell[k] = true
    } else if (w === 'eval') {
      execs = true
      merge(scan(args.join(' '), bins, depth + 1))
    } else if (w === 'source' || w === '.') {
      execs = true
      const file = args.find(a => !a.startsWith('-'))
      if (file === '/dev/stdin' || !file) stdinShell[k] = true
      else out.scripts.push(file)
    } else if (w === 'find' || w === 'fd') {
      for (const [j, a] of args.entries()) if (/^-(?:exec|execdir|ok|okdir)$/.test(a) && args[j + 1] !== undefined) { const end = args.findIndex((x, y) => y > j && (x === ';' || x === '+')); merge(scan(args.slice(j + 1, end < 0 ? undefined : end).join(' '), bins, depth + 1)) }
    }
    if (out.why) return out
    if (execs && subDecodes) return { ...out, why: 'it decodes text into a shell command, so it cannot be checked for agy' }
  }
  // Decoded text piped into a shell.
  let seen = false
  for (const [k] of cmds.entries()) {
    if (k > 0 && !cmds[k - 1]!.pipeNext) seen = false
    if (seen && stdinShell[k]) return { ...out, why: 'it pipes decoded text into a shell, so it cannot be checked for agy' }
    if (decoder[k]) seen = true
  }
  return out
}

// Why the text of a command runs agy, or undefined (no file is read here: see scripts in runsAgy).
export function agyInText(command: string, bins: string[] = []): string | undefined {
  return scan(command, bins).why
}

// The command word of every simple command, wrappers, sh -c bodies and substitutions unwrapped.
export function programWords(command: string): string[] {
  return scan(command, []).words.map(w => w.replace(/\u0001/g, ''))
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

// Why this Bash command would run agy, or undefined: the text first, then the shell scripts it runs (one level, read with
// $.fs; a script that cannot be read is allowed), then each command word followed through PATH and symlinks.
export async function runsAgy($: $, command: string, cwd: string): Promise<string | undefined> {
  const bin = await locate($, 'agy').catch(() => undefined)
  const real = bin ? await resolved($, bin, cwd) : undefined
  const bins = [bin, real].filter((x): x is string => !!x)
  const s = scan(command, bins)
  if (s.why) return s.why
  for (const file of [...new Set(s.scripts)].slice(0, 4)) {
    const path = file.startsWith('/') ? file : file.startsWith('~/') ? '' : `${cwd}/${file}`
    const body = path ? await Promise.resolve().then(() => $.fs.read(path)).catch(() => undefined) : undefined
    const why = typeof body === 'string' ? agyInText(body.slice(0, 200_000), bins) : undefined
    if (why) return `the script ${file} runs agy (${why})`
  }
  const now = await $.clock.now()
  for (const word of [...new Set(s.words.map(w => w.replace(/\u0001/g, '')).filter(Boolean))].slice(0, 8)) {
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
