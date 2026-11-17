import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { ChatSurfaceState, GitInfo, MainInfo } from '../types'
import { defaultRouting, nameOf, tagOf } from './state'
import { shortModel } from './ui'

const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const git = atom({ plugin: 'agent-overview', key: 'git' } as const, { error: 'loading' } as GitInfo)
const chatSurface = atom({ plugin: 'agent-overview', key: 'chatSurface' } as const, { editVersion: 0, alerts: {} } as ChatSurfaceState)

// Parse only literal argv. Never execute a permission request to describe its effects.
export function literalWords(command: string): string[] | undefined {
  const words: string[] = []
  let word = '', quote = '', active = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      if (c === quote) quote = ''
      else if (quote === '"' && /[$`\\]/.test(c)) return
      else word += c
    } else if (c === '"' || c === "'") { quote = c; active = true }
    else if (c === '\\') { if (++i >= command.length) return; word += command[i]; active = true }
    else if (/[\r\n;&|<>`$*?{}()[\]~]/.test(c)) return
    else if (/\s/.test(c)) { if (active) { words.push(word); word = ''; active = false } }
    else { word += c; active = true }
  }
  if (quote) return
  if (active) words.push(word)
  return words
}
export function isTestCommand(words: string[]) {
  const args = [...words]
  if (args[0] === 'npx') { args.shift(); while (['-y', '--yes', '--no-install'].includes(args[0] ?? '')) args.shift() }
  const bin = args[0]?.split('/').pop(), a = args.slice(1)
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(bin ?? '')) return /^(?:test)(?::[\w-]+)?$/.test(a[a[0] === 'run' ? 1 : 0] ?? '')
  if (['jest', 'vitest', 'pytest', 'mocha'].includes(bin ?? '')) return true
  return (bin === 'go' || bin === 'cargo' || bin === 'make') && a[0] === 'test'
    || bin === 'claude' && a[0] === 'plugin' && a[1] === 'test'
    || /^python(?:3)?$/.test(bin ?? '') && a[0] === '-m' && ['pytest', 'unittest'].includes(a[1] ?? '')
}
const clean = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim()

async function gitText($: EngineInterface, args: string[], cwd?: string) {
  const result = await $.process.run(['git', ...args], { cwd, timeoutMs: 3000 }).catch(() => undefined)
  return result?.exitCode === 0 && !result.isStdoutTruncated ? result.stdout : undefined
}
export async function testFiles($: EngineInterface, cwd: string): Promise<string | undefined> {
  const paths = await gitText($, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd)
  if (paths === undefined) return
  const files = [...new Set(paths.split('\0').filter(Boolean))].sort()
  // shortcut: trees over 3000 files get no passing-tests claim; use a batched stat API for larger repos.
  if (files.length > 3000) return
  const rows: [string, number, number][] = []
  for (let i = 0; i < files.length; i += 50) {
    const batch = await Promise.all(files.slice(i, i + 50).map(async path => {
      const stat = await $.fs.stat(`${cwd}/${path}`).catch(() => undefined)
      if (stat) return [path, stat.size, stat.mtimeMs] as [string, number, number]
      return await $.fs.exists(`${cwd}/${path}`).catch(() => true) ? null : undefined
    }))
    if (batch.includes(null)) return
    rows.push(...batch.filter((r): r is [string, number, number] => r !== undefined))
  }
  return JSON.stringify(rows)
}
export async function commandLocation($: EngineInterface, command: string) {
  let words = literalWords(command), cwd = await $.session.cwd().catch(() => undefined)
  if (!cwd) return undefined
  const cd = /^\s*cd\s+(.+?)\s*&&\s*([\s\S]+)$/.exec(command)
  if (cd) {
    const dir = literalWords(cd[1]!)
    if (dir?.length !== 1) return undefined
    cwd = dir[0]!.startsWith('/') ? dir[0]! : `${cwd}/${dir[0]}`
    words = literalWords(cd[2]!)
  }
  if (!words?.length) return undefined
  if (words[0]?.split('/').pop() === 'git' && words[1] === '-C' && words[2]) {
    cwd = words[2].startsWith('/') ? words[2] : `${cwd}/${words[2]}`
    words = [words[0], ...words.slice(3)]
  }
  return { words, cwd }
}
export async function deletedFiles($: EngineInterface, words: string[], cwd: string): Promise<number | undefined> {
  const program = words[0]?.split('/').pop()
  if (program === 'git' && words[1] === 'reset' && words.includes('--hard')) {
    const rest = words.slice(2).filter(w => w !== '--hard' && w !== '--quiet' && w !== '-q')
    if (rest.length > 1 || rest[0]?.startsWith('-')) return
    // Untracked obstructions may also be removed by reset; decline a count in that case.
    if (await gitText($, ['ls-files', '--others', '-z'], cwd) !== '') return
    const paths = await gitText($, ['diff', '--name-only', '--diff-filter=A', '-z', rest[0] ?? 'HEAD', '--'], cwd)
    if (paths === undefined) return
    let count = 0
    for (const path of paths.split('\0').filter(Boolean)) {
      const stat = await $.fs.stat(`${cwd}/${path}`).catch(() => undefined)
      if (!stat) return
      if (stat.kind === 'file' || stat.isLink) count++
    }
    return count
  }
  if (program !== 'rm' || !words.slice(1).some(w => /^-[^-]*[rR]/.test(w) || w === '--recursive')) return
  let options = true
  const targets: string[] = []
  for (const word of words.slice(1)) {
    if (options && word === '--') { options = false; continue }
    if (options && word.startsWith('-')) {
      if (!/^-[rRfivd]+$/.test(word) && !['--recursive', '--force', '--verbose'].includes(word)) return
      continue
    }
    if (!word || word.split('/').some(part => part === '.' || part === '..')) return
    targets.push(word.startsWith('/') ? word : `${cwd}/${word}`)
  }
  if (!targets.length) return
  const seen = new Set<string>()
  let budget = 5000
  const walk = async (path: string): Promise<number> => {
    if (--budget < 0) throw new Error('count too large')
    const stat = await $.fs.stat(path)
    if (stat.isLink || stat.kind === 'file') {
      const real = path.replace(/\/+/g, '/').replace(/\/\.\//g, '/')
      if (seen.has(real)) return 0
      seen.add(real); return 1
    }
    if (stat.kind !== 'dir') throw new Error('unknown entry')
    let n = 0
    for (const e of await $.fs.list(path)) n += await walk(`${path}/${e.name}`)
    return n
  }
  try {
    let count = 0
    for (const path of targets) if (await $.fs.exists(path)) count += await walk(path)
    return count
  } catch { return undefined }
}

export async function permissionContext($: EngineInterface, tool: string, input: unknown): Promise<string | undefined> {
  const args = (input ?? {}) as Record<string, unknown>
  if (tool === 'Agent' || tool === 'Workflow') {
    const r = await read($, routing)
    const provider = (['claude', ...r.order] as const).find(p => tagOf(r, p) === 'main')
    if (provider && provider !== 'claude' && r.on[provider] && !r.paused?.[provider] && r.role !== 'claude') {
      const model = typeof args.model === 'string' ? args.model : (await read($, main)).model
      const family = /opus|sonnet|haiku/i.exec(model)?.[0]
      return `${family ? family[0]!.toUpperCase() + family.slice(1).toLowerCase() : clean(shortModel(model || 'Claude'))} subagent while ${nameOf(provider)} is Main`
    }
    return
  }
  if (tool !== 'Bash') return
  const command = String(args.command ?? '')
  const location = await commandLocation($, command)
  if (!location) return
  const { words, cwd } = location
  const push = words[0]?.split('/').pop() === 'git' && words[1] === 'push'
  const pr = words[0]?.split('/').pop() === 'gh' && words[1] === 'pr' && words[2] === 'create'
  if (push || pr) {
    let branch = (await gitText($, ['branch', '--show-current'], cwd))?.trim()
    if (!branch && cwd === await $.session.cwd()) { const g = await read($, git); if (!('error' in g)) branch = g.branch }
    if (push) {
      const tail = words.slice(2)
      if (tail.some(x => x.startsWith('-') && !['-u', '--set-upstream', '--force', '--force-with-lease', '--no-verify'].includes(x))) return
      const refs = tail.filter(x => !x.startsWith('-'))
      if (refs.length > 2) return
      if (refs[1]) branch = refs[1].includes(':') ? refs[1].split(':').pop() : refs[1] === 'HEAD' ? branch : refs[1]
    } else {
      const head = words.indexOf('--head')
      if (head >= 0) branch = words[head + 1]
    }
    if (!branch) return
    const s = await read($, chatSurface), now = await $.clock.now()
    const fresh = s.test?.passed && s.test.version === s.editVersion && s.test.cwd === cwd && s.test.files !== undefined && s.test.files === await testFiles($, cwd)
    return `push to ${clean(branch)} · ${fresh ? `tests passed ${Math.max(0, Math.floor((now - s.test!.at) / 60000))}m ago` : 'tests not run since last edit'}`
  }
  const count = await deletedFiles($, words, cwd)
  return count === undefined ? undefined : `deletes ${count} files`
}
