import { nameOf } from './state'
import type { Act, AgentNode, HistoryItem, Provider, ProviderInfo, Providers, Routing } from '../types'

export function watchKey(all: Record<string, Act>, nodes: AgentNode[], watch?: string) {
  if (watch !== undefined && watch !== 'follow') return watch
  const sorted = Object.values(all).sort((a, b) => b.at - a.at)
  const running = sorted.find(a => a.state === 'running' && !nodes.some(n => n.id === a.toolUseId && n.provider && n.provider !== 'claude' && !n.agentId))
  if (running) return running.key
  const side = nodes.filter(n => n.provider && n.provider !== 'claude' && !n.agentId && n.state === 'running').sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
  return side ? `node:${side.id}` : sorted[0]?.key
}

// Keep offsets so executable and flag matches can read their original values.
function shellMask(text: string): string {
  const out = text.split('')
  const heredocs: { word: string; tabs: boolean }[] = []
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (c === quote) quote = ''
      else {
        out[i] = ' '
        if (c === '\\' && quote === '"' && i + 1 < text.length) out[++i] = ' '
      }
    } else if (c === '"' || c === "'") quote = c
    else if (c === '\\' && i + 1 < text.length) { out[i] = ' '; out[++i] = ' ' }
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]!))) {
      while (i < text.length && text[i] !== '\n') out[i++] = ' '
      i--
    } else if (c === '<' && text[i + 1] === '<') {
      const m = /^<<(-?)[ \t]*(?:'([\w]+)'|"([\w]+)"|([\w]+))/.exec(text.slice(i))
      if (m) { heredocs.push({ word: (m[2] ?? m[3] ?? m[4])!, tabs: m[1] === '-' }); i += m[0].length - 1 }
    } else if (c === '\n' && heredocs.length) {
      for (const doc of heredocs) {
        let start = i + 1
        while (start < text.length) {
          const end = text.indexOf('\n', start)
          const stop = end < 0 ? text.length : end
          const line = text.slice(start, stop).replace(/\r$/, '')
          for (let j = start; j < stop; j++) out[j] = ' '
          i = stop
          if ((doc.tabs ? line.replace(/^\t+/, '') : line) === doc.word) break
          start = stop + 1
        }
      }
      heredocs.length = 0
    }
  }
  return out.join('')
}

export const detachedCommand = (command: string): boolean => {
  const masked = shellMask(command)
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '&' && !/[&<>]/.test(masked[i - 1] ?? '') && !/[&>]/.test(masked[i + 1] ?? '')) return true
  }
  const inner = sideCommand(command)?.shell
  return !!inner && detachedCommand(inner.command)
}

function flagValue(text: string, masked: string, flag: RegExp): string | undefined {
  const m = flag.exec(masked)
  if (!m) return undefined
  return /^(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/.exec(text.slice(m.index + m[0].length))?.slice(1).find(x => x !== undefined)
}

// Process commands are already argv text: only their leading executable can be a run.
function sideCall(text: string, masked: string, vars: Record<string, string> = {}) {
  const prefix = /^\s*(?:(?:env|exec|time|nohup)\s+|[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/.exec(masked)![0].length
  text = text.slice(prefix)
  masked = masked.slice(prefix)
  const node = /^(?:[^\s"']*\/)?node\s+/.exec(masked)
  const offset = node?.[0].length ?? 0
  const program = masked.slice(offset)
  const original = text.slice(offset)
  let provider: Provider | undefined
  if (/^(?:[^\s"']*\/)?codex\s+(?:(?:-C|--cd)(?:\s+|=)(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*(?:exec|e)(?=\s|$)/.test(program)) provider = 'codex'
  else if (!node && /^(?:[^\s"']*\/)?opencode\s+run(?=\s|$)/.test(program)) provider = 'opencode'
  else if (!node && /^(?:[^\s"']*\/)?ollama\s+run(?=\s|$)/.test(program)) provider = 'ollama'
  else {
    const quoted = /^(?:"([^"]*)"|'([^']*)')(?=\s|$)/.exec(original)
    const path = quoted ? quoted[1] ?? quoted[2]! : undefined
    const resolved = path?.startsWith('$') ? vars[path.slice(1)] : path
    const ccPath = resolved ? /(?:^|\/)command-code\/dist\/index\.mjs$/.test(resolved) : /^(?:[^\s"']| (?=Code\.app\/))*?command-code\/dist\/index\.mjs(?=\s|$)/.test(program)
    if (ccPath || (!node && /^(?:[^\s"']*\/)?(?:cmd|cmdc|commandcode|command-code)(?=\s|$)/.test(program))) provider = 'commandcode'
  }
  if (!provider || /(?:^|\s)(?:--help|-h|--version|-V)(?=\s|$)/.test(masked)) return undefined
  if (provider === 'commandcode' && !/(?:^|\s)(?:-p|--print)(?=\s|$|=)/.test(masked)) return undefined
  if (provider === 'ollama') {
    const model = ollamaModelOf(original)
    return model ? { provider, model, effort: undefined as string | undefined, dir: undefined as string | undefined } : undefined
  }
  const model = flagValue(text, masked, /(?:^|\s)(?:-m|--model)(?:[ \t]+|=)/)
  const dir = flagValue(text, masked, /(?:^|\s)(?:-C|--cd)(?:[ \t]+|=)/)
  const effort = provider === 'codex'
    ? [...masked.matchAll(/(?:^|\s)(?:-c|--config)(?:[ \t]+|=)/g)].map(m => flagValue(text.slice(m.index), masked.slice(m.index), /^(?:\s)?(?:-c|--config)(?:[ \t]+|=)/)?.match(/^model_reasoning_effort\s*=\s*["']?([\w-]+)/)?.[1]).find(Boolean)
    : flagValue(text, masked, provider === 'opencode' ? /(?:^|\s)--variant(?:[ \t]+|=)/ : /(?:^|\s)--effort(?:[ \t]+|=)/)
  return { provider, model, ...(effort ? { effort } : {}), ...(dir ? { dir } : {}) }
}

// `ollama run [flags] MODEL [PROMPT]`: the first word after run that is not a flag or a flag's value.
const OLLAMA_VALUES = ['--format', '--keepalive', '--dimensions', '--ask', '--choice', '--level', '--voice']
function ollamaModelOf(text: string): string | undefined {
  const words = wordsOf(text).filter(w => !w.operator)
  const run = words.findIndex(w => w.text === 'run')
  for (let i = run + 1; run >= 0 && i < words.length; i++) {
    const w = words[i]!.text
    if (/^[;&|]/.test(w)) return undefined
    if (OLLAMA_VALUES.includes(w)) { i++; continue }
    if (w.startsWith('-')) continue
    return w
  }
  return undefined
}

type SideCommand = { provider: Provider; model?: string; effort?: string; dir?: string; text: string; start: number; shell?: { start: number; end: number; command: string } }
export function sideCommand(command: string): SideCommand | undefined {
  const masked = shellMask(command)
  const vars: Record<string, string> = {}
  let start = 0
  for (const end of [...masked.matchAll(/[;&|()\n]/g)].map(m => m.index!).concat(masked.length)) {
    const text = command.slice(start, end)
    const blanked = masked.slice(start, end)
    const assignment = /^\s*([A-Za-z_]\w*)=(["'])([^"'\n]*)\2\s*$/.exec(text)
    if (assignment && blanked.includes(`${assignment[1]}=`)) vars[assignment[1]!] = assignment[3]!
    const words = wordsOf(text)
    let i = 0
    while (i < words.length) {
      const word = words[i]!.text, program = word.split('/').pop()!
      if (/^[A-Za-z_]\w*=/.test(word)) { i++; continue }
      if (/^(?:nohup|env|exec|time|timeout)$/.test(program)) {
        i++
        while (words[i]?.text.startsWith('-')) {
          const option = words[i++]!.text
          if (/^(?:-u|--unset|-C|--chdir|-s|--signal|-k|--kill-after)$/.test(option)) i++
          if (option === '--') break
        }
        if (program === 'timeout') i++
        continue
      }
      if (/^(?:sh|bash|zsh)$/.test(program) && /^-[A-Za-z]*c[A-Za-z]*$/.test(words[i + 1]?.text ?? '')) {
        const inner = words[i + 2]
        if (inner) {
          const found = sideCommand(inner.text)
          if (found) return { ...found, shell: { start: start + inner.start, end: start + inner.end, command: inner.text } }
        }
        break
      }
      const offset = words[i]!.start
      const found = sideCall(text.slice(offset), blanked.slice(offset), vars)
      if (found) return { ...found, text: text.slice(offset), start: start + offset }
      break
    }
    start = end + 1
  }
  return undefined
}

export function externalOf(command: string): { provider: Provider; model?: string; effort?: string } | undefined {
  const found = sideCommand(command)
  if (found) { const { text, dir, start, shell, ...run } = found; return run }
  return undefined
}

// Keep quoted words together without evaluating anything from the shell.
function wordsOf(text: string) {
  return [...text.matchAll(/\d*(?:<<|>>|[<>])&?|(?:"(?:[^"\\]|\\.)*"|'[^']*'|\\.|[^\s<>"'\\])+/g)].map(m => {
    let word = '', quote = ''
    for (let i = 0; i < m[0].length; i++) {
      const c = m[0][i]!
      if (c === quote) quote = ''
      else if (!quote && (c === '"' || c === "'")) quote = c
      else if (c === '\\' && quote !== "'" && i + 1 < m[0].length && (!quote || /["\\$`\n]/.test(m[0][i + 1]!))) {
        const next = m[0][++i]!
        if (next !== '\n') word += next
      } else word += c
    }
    return { text: word, operator: /^\d*[<>]+&?$/.test(m[0]), start: m.index!, end: m.index! + m[0].length }
  })
}

export function taskOf(command: string): string | undefined {
  const found = sideCommand(command)
  if (!found) return undefined
  const args = wordsOf(found.text)
  if (found.provider === 'commandcode') {
    const i = args.findIndex(a => a.text === '-p' || a.text === '--print' || a.text.startsWith('--print='))
    if (i < 0) return undefined
    if (args[i]!.text.startsWith('--print=')) return args[i]!.text.slice(8) || undefined
    return args[i + 1]?.operator ? undefined : args[i + 1]?.text || undefined
  }
  const program = args.findIndex(a => new RegExp(`(?:^|/)${found.provider}$`).test(a.text))
  let start = program + 1
  while (args[start]?.text === '-C' || args[start]?.text === '--cd' || /^(?:-C|--cd)=/.test(args[start]?.text ?? '')) start += args[start]!.text.includes('=') ? 1 : 2
  if (found.provider === 'codex' ? !['exec', 'e'].includes(args[start]?.text ?? '') : args[start]?.text !== 'run') return undefined
  if (found.provider === 'ollama') {
    const at = args.findIndex((a, i) => i > start && a.text === found.model)
    const text: string[] = []
    for (let i = at + 1; at >= 0 && i < args.length; i++) {
      if (args[i]!.operator) { i++; continue }
      if (OLLAMA_VALUES.includes(args[i]!.text)) { i++; continue }
      if (!args[i]!.text.startsWith('-')) text.push(args[i]!.text)
    }
    return text.join(' ').trim() || undefined
  }
  const values = ['-m', '--model', '-c', '--config', '-s', '--sandbox', '-C', '--cd', '-o', '--output-last-message', '--output-schema', '-p', '--profile', '-i', '--image', '--variant', '--agent', '--format', '--session', '--title', '--file', '-f', '--attach', '--port', '--add-dir', '--enable', '--disable', '--color', '--local-provider', '--thread-source', '--cyber-access-program']
  const text: string[] = []
  let positional = false
  for (let i = start + 1; i < args.length; i++) {
    const a = args[i]!.text
    if (args[i]!.operator) { i++; continue }
    if (!positional && a === '--') { positional = true; continue }
    if (!positional && values.includes(a)) { i++; continue }
    if (!positional && a.startsWith('-') && a !== '-') continue
    if (found.provider === 'codex' && a === '-') return undefined
    text.push(a)
  }
  return text.join(' ').trim() || undefined
}

export function stdinFileOf(command: string): string | undefined {
  const found = sideCommand(command)
  if (!found) return undefined
  // Match operators before unquoting, so a literal "<" in a prompt is harmless.
  const m = /(?:^|[^<])<\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s<>]+)(?=\s|$)/.exec(shellMask(found.text))
  if (!m) return undefined
  const start = m.index + m[0].indexOf('<') + 1
  const word = wordsOf(found.text.slice(start))[0]?.text
  return word && !/[$`~]/.test(word) ? word : undefined
}

export function labelOf(text: string): string {
  const lines = text.split(/\r?\n/).map(l => l.trim())
  const task = lines.find(l => /^# Task:\s*\S/.test(l))?.replace(/^# Task:\s*/, '')
  const heading = lines.find(l => /^#{1,6}\s+\S/.test(l))?.replace(/^#{1,6}\s+/, '')
  return (task ?? heading ?? lines.find(Boolean) ?? '').trim().slice(0, 70)
}

// Read only our marker from ps -E; never retain the rest of a process's environment.
export function sideMarkers(psText: string): Map<number, string> {
  const markers = new Map<number, string>()
  for (const line of psText.split('\n')) {
    const pid = Number(/^\s*(\d+)/.exec(line)?.[1])
    if (!pid) continue
    for (const token of line.split(/\s+/)) if (token.startsWith('AO_RUN=')) markers.set(pid, token.slice(7))
  }
  return markers
}

export type SideRun = { pid: number; provider: Provider; model?: string; effort?: string; dir?: string; ms: number }

export function sideRuns(psText: string): SideRun[] {
  const runs: SideRun[] = []
  for (const line of psText.split('\n')) {
    const m = /^\s*(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s+(.+)$/.exec(line)
    if (!m) continue
    const command = m[6]!
    const program = command.replace(/^(?:[^\s"']*\/)?node\s+/, '')
    // ps flattens argv, including the space in Command Code.app.
    const path = /^(?:"([^"]*)"|'([^']*)'|((?:[^\s]| (?=Code\.app\/))+))/.exec(program)?.slice(1).find(x => x !== undefined) ?? ''
    if (path.startsWith('/Applications/ChatGPT.app/') || /\/vendor\//.test(path)) continue
    const run = sideCall(command, command)
    if (!run) continue
    const { provider, model, effort, dir } = run
    runs.push({ pid: Number(m[1]), provider, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(dir ? { dir } : {}), ms: (((Number(m[2] ?? 0) * 24 + Number(m[3] ?? 0)) * 60 + Number(m[4])) * 60 + Number(m[5])) * 1000 })
  }
  return runs
}

// The runs this session started: a process whose parent chain reaches `root`, the session's own engine.
export function mine<T extends { pid: number }>(runs: T[], psTree: string, root: number): T[] {
  const parent = new Map([...psTree.matchAll(/^\s*(\d+)\s+(\d+)/gm)].map(m => [Number(m[1]), Number(m[2])]))
  const reaches = (pid: number) => {
    for (let p = pid, i = 0; p > 1 && i < 64; p = parent.get(p) ?? 0, i++) if (p === root) return true
    return false
  }
  return runs.filter(r => reaches(r.pid))
}

export type TreeRow = { node: AgentNode; depth: number; prefix: string; state: AgentNode['state'] }

// A workflow group has no life of its own: it runs while any of its agents does.
export const stateOf = (n: AgentNode, list: AgentNode[]): AgentNode['state'] => {
  if (n.kind !== 'workflow') return n.state
  const kids = list.filter(k => k.parentNode === n.id)
  if (!kids.length) return n.state
  return kids.some(k => stateOf(k, list) === 'running') ? 'running' : kids.some(k => k.state === 'failed') ? 'failed' : 'done'
}

// The tree of agents, newest work first, each row with the connector glyphs that draw its branch.
// With `only`, just those agents show; a parent left out is skipped, so its children attach to
// the nearest shown ancestor.
export const buildTree = (list: AgentNode[], only?: Set<string>) => {
  const byId = new Map(list.map(n => [n.id, n]))
  const shown = list.filter(n => !only || only.has(n.id))
  const shownIds = new Set(shown.map(n => n.id))
  const parentOf = (n: AgentNode) => {
    let p = n.parentNode ? byId.get(n.parentNode) : undefined
    while (p && !shownIds.has(p.id)) p = p.parentNode ? byId.get(p.parentNode) : undefined
    return p?.id
  }
  const kids = new Map<string | undefined, AgentNode[]>()
  for (const n of shown) {
    const p = parentOf(n)
    kids.set(p, [...(kids.get(p) ?? []), n])
  }
  const rank = (n: AgentNode) => (stateOf(n, list) === 'running' ? 0 : 1)
  const order = (xs: AgentNode[]) => [...xs].sort((a, b) => rank(a) - rank(b) || (b.startedAt ?? 0) - (a.startedAt ?? 0))
  const rows: TreeRow[] = []
  const walk = (n: AgentNode, depth: number, lead: string, isLast: boolean) => {
    rows.push({ node: n, depth, prefix: `${lead}${isLast ? '╰─' : '├─'}`, state: stateOf(n, list) })
    const children = order(kids.get(n.id) ?? [])
    children.forEach((c, i) => walk(c, depth + 1, `${lead}${isLast ? '  ' : '│ '}`, i === children.length - 1))
  }
  const roots = order(kids.get(undefined) ?? [])
  roots.forEach((n, i) => walk(n, 0, '', i === roots.length - 1))
  return rows
}

export type Stage = { key: string; name: string; nodes: AgentNode[]; start: number; end?: number; state: 'running' | 'done' | 'failed'; color: string }
const STAGE_COLORS = ['suggestion', 'planMode', 'claude', 'remember', 'warning']
const WAVE_MS = 5000

// A run's stages, in the order they started, named from the work itself: agents labelled
// "word: task" (as workflow scripts and Claude often name them) share that word's stage;
// the rest group into waves, agents started within a few seconds of each other.
export const stagesOf = (list: AgentNode[], all = list): Stage[] => {
  const real = list.filter(n => n.kind !== 'workflow').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const out: Stage[] = []
  let wave: Stage | undefined
  let waveAt = -Infinity
  for (const n of real) {
    const at = n.startedAt ?? 0
    const tag = /^\s*([A-Za-z][\w-]{0,14}(?: [\w-]{1,14})?)\s*:\s*\S/.exec(n.label)?.[1]
    if (tag) {
      const key = `tag:${tag.toLowerCase()}`
      let s = out.find(x => x.key === key)
      if (!s) out.push((s = { key, name: tag[0]!.toUpperCase() + tag.slice(1), nodes: [], start: at, state: 'done', color: '' }))
      s.nodes.push(n)
      continue
    }
    if (!wave || at - waveAt > WAVE_MS) out.push((wave = { key: `wave:${n.id}`, name: '', nodes: [], start: at, state: 'done', color: '' }))
    wave.nodes.push(n)
    waveAt = at
  }
  return out.map((s, i) => {
    const states = s.nodes.map(n => stateOf(n, all))
    const running = states.includes('running')
    const first = s.nodes[0]!.label || s.nodes[0]!.kind
    return {
      ...s,
      name: s.name || (s.nodes.length > 1 ? `${first} +${s.nodes.length - 1}` : first),
      state: running ? 'running' : states.every(x => x === 'failed') ? 'failed' : 'done',
      end: running ? undefined : Math.max(...s.nodes.map(n => n.endedAt ?? n.startedAt ?? 0)),
      color: STAGE_COLORS[i % STAGE_COLORS.length]!,
    }
  })
}

const SHORT: Record<string, string> = { '5-hour': '5h', Weekly: 'wk', Monthly: 'mo', 'Weekly Opus': 'opus wk', Spend: 'spend' }

// The dim line under the prompt: every provider's usage in one glance.
export const usageAge = (info: Pick<ProviderInfo, 'usageAt'>, now: number) => info.usageAt !== undefined && now - info.usageAt > 3600000 ? `${Math.floor((now - info.usageAt) / 3600000)}h old` : ''
export const usageTail = (all: Providers, r: Routing, now?: number) => {
  const role = r.role === 'claude' ? 'claude only' : r.role === 'plan' ? 'plans only' : 'auto'
  const parts: string[] = [role + (r.role !== 'claude' && r.worker && r.on[r.worker.provider] && !(r.role === 'plan' && r.worker.provider === 'claude') ? ` ⇢ ${r.worker.model}` : '')]
  for (const p of ['claude', ...r.order] as Provider[]) {
    const info = all[p]
    if (!info || info.status === 'missing') continue
    const short = nameOf(p)
    // Local and free: nothing to watch unless it is on and its server is down.
    if (p === 'ollama') {
      if (r.on[p] && info.offline) parts.push(`${short} down`)
      continue
    }
    if (p !== 'claude' && !r.on[p]) {
      parts.push(`${short} off`)
      continue
    }
    const meters = info.meters.filter(m => m.label !== 'Context').slice(0, 2).map(m => `${SHORT[m.label] ?? m.label} ${p === 'opencode' && info.usageSource !== 'live' ? '≈' : ''}${Math.round(Math.max(0, 100 - m.percent))}% left${m.percent >= 85 ? '!' : ''}${usageAge(info, now ?? info.checkedAt ?? 0) ? ` · ${usageAge(info, now ?? info.checkedAt ?? 0)}` : ''}`)
    const spend = p === 'opencode' ? info.facts.find(f => /spent in 7 days/.test(f))?.replace(' spent in 7 days', '/7d') : undefined
    const credits = p === 'commandcode' && !meters.length ? info.facts.find(f => /monthly credits/.test(f))?.replace(/\.\d+ monthly credits left| monthly credits left/, ' cr') : undefined
    const bits = [...meters, spend, credits, info.alert ? 'quota!' : undefined].filter(Boolean)
    if (bits.length) parts.push(`${short} ${bits.join(' ')}`)
  }
  return parts.join(' · ')
}

// Provider reset durations, including short waits and fractional units, as milliseconds.
export const resetIn = (text: string) => {
  const m = /resets? (?:in|after) ((?:\d+(?:\.\d+)?\s*[dhms]\s*)+)/i.exec(text)
  if (!m) return undefined
  let ms = 0
  for (const [, n, u] of m[1]!.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) ms += Number(n) * ({ d: 86400000, h: 3600000, m: 60000, s: 1000 }[u!.toLowerCase()] ?? 0)
  return ms || 60000
}

// Out of quota: an alert says so, or a usage meter is full. `until` is when it should be back, if known.
export const quotaOf = (info: ProviderInfo, provider?: Provider) => {
  if (provider === 'codex' && !info.alert) return undefined
  const full = info.meters.filter(m => m.label !== 'Context' && (m.percent >= 100 || m.limited))
  const hit = !!info.alert && /quota|limit|exhaust|credit/i.test(info.alert)
  if (!hit && !full.length) return undefined
  const waits = [info.alert ?? '', ...full.map(m => m.detail ?? '')].map(resetIn).filter((x): x is number => x !== undefined)
  return { why: hit ? info.alert! : `${full[0]!.label} quota full`, wait: waits.length ? Math.max(...waits) : undefined }
}

// A run's output that says the provider is out of quota or credits.
export const QUOTA_TEXT = /quota|rate.?limit|\b429\b|RESOURCE_EXHAUSTED|out of credits|insufficient (credits|balance)|usage limit/i

export type Score = { model: string; provider?: Provider; tasks: number; failed: number; redone: number; avgMs: number }
const words = (s: string) => s.toLowerCase().replace(/^[\w -]{1,20}:\s*/, '').split(/\W+/).filter(Boolean).slice(0, 4).join(' ')

// Each model's record from the agent history. A task counts as redone when another task whose first
// words match it (one may run on: "fix the header" / "fix the header again") starts within 30 minutes of it ending.
// ponytail: matching on the first four words, not on what the task changed; a task log would be exact.
export const scorecard = (items: HistoryItem[]): Score[] => {
  const by = new Map<string, Score & { ms: number }>()
  const sorted = [...items].sort((a, b) => a.at - b.at)
  sorted.forEach((it, i) => {
    const s = by.get(it.model) ?? { model: it.model, provider: it.provider, tasks: 0, failed: 0, redone: 0, avgMs: 0, ms: 0 }
    s.tasks++
    s.ms += it.ms
    if (it.state === 'failed') s.failed++
    const end = it.at + it.ms
    const key = words(it.label)
    const same = (k: string) => k.includes(' ') && key.includes(' ') && (k.startsWith(key) || key.startsWith(k))
    if (sorted.slice(i + 1).some(x => x.at >= end && x.at - end <= 1800000 && same(words(x.label)))) s.redone++
    by.set(it.model, s)
  })
  return [...by.values()].map(({ ms, ...s }) => ({ ...s, avgMs: ms / s.tasks })).sort((a, b) => b.tasks - a.tasks)
}
