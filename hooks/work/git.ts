import type { EngineInterface } from 'claude-code'
import { numstat } from '../stream'

export type Ref = { name: string; kind: 'head' | 'branch' | 'remote' | 'tag' }
export type Commit = { hash: string; parents: string[]; refs: Ref[]; subject: string; author: string; when: string }
export type GraphLine = { graph: string; commit?: Commit }
export type Lane = { row: number; col: number; color: number }
export type Edge = { from: [number, number]; to: [number, number]; color: number }
export type Change = { path: string; orig?: string; kind: 'staged' | 'unstaged' | 'untracked'; code: string; added?: number; removed?: number }
export const LANE_COLORS = ['#D97757', '#10A37F', '#4285F4', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4', '#84CC16']

const compact = (s: string) => {
  if (/just now|second/i.test(s)) return 'now'
  const m = /(\d+|an?|one)\s+(minute|hour|day|week|month|year)/i.exec(s)
  return m ? `${Number(m[1]) || 1}${({ minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' } as Record<string, string>)[m[2]!.toLowerCase()]}` : s
}

export function parseLog(stdout: string): GraphLine[] {
  return stdout.split('\n').filter(Boolean).map(line => {
    const [graph = '', hash, parents = '', decorations = '', subject = '', author = '', when = ''] = line.split('\x1f')
    if (!hash) return { graph: graph.trimEnd() }
    // Full ref names (--decorate=full) tell a local `feature/x` from a remote `origin/x`.
    const refs: Ref[] = decorations.split(', ').filter(Boolean).map(ref =>
      ref.startsWith('HEAD -> ') ? { kind: 'head', name: ref.slice(8).replace(/^refs\/heads\//, '') }
        : ref === 'HEAD' ? { kind: 'head', name: 'HEAD' }
          : ref.startsWith('tag: ') ? { kind: 'tag', name: ref.slice(5).replace(/^refs\/tags\//, '') }
            : ref.startsWith('refs/heads/') ? { kind: 'branch', name: ref.slice(11) }
              : { kind: 'remote', name: ref.replace(/^refs\/(remotes\/)?/, '') })
    return { graph: graph.trimEnd(), commit: { hash, parents: parents.split(' ').filter(Boolean), refs, subject, author, when: compact(when) } }
  })
}

export function layout(commits: Commit[]) {
  const lanes: (string | null)[] = [], colors: number[] = [], dots: Lane[] = [], edges: Edge[] = []
  let nextColor = 0, widest = 0
  const allocate = (hash: string) => {
    const free = lanes.indexOf(null), col = free < 0 ? lanes.length : free
    lanes[col] = hash
    colors[col] = nextColor++
    widest = Math.max(widest, col + 1)
    return col
  }
  commits.forEach((c, row) => {
    const waiting = lanes.indexOf(c.hash), col = waiting < 0 ? allocate(c.hash) : waiting
    dots.push({ row, col, color: colors[col]! })
    lanes.forEach((hash, other) => {
      if (other === col || hash !== c.hash) return
      // Redirect the previous row's incoming line before coalescing straight runs.
      for (const edge of edges) if (edge.to[0] === other && edge.to[1] === row) edge.to = [col, row]
      lanes[other] = null
    })
    lanes[col] = c.parents[0] ?? null
    const newLanes = new Set<number>()
    for (const parent of c.parents.slice(1)) {
      const found = lanes.indexOf(parent), target = found < 0 ? allocate(parent) : found
      if (found < 0) newLanes.add(target)
      edges.push({ from: [col, row], to: [target, row + 1], color: colors[target]! })
    }
    lanes.forEach((hash, lane) => {
      if (hash && !newLanes.has(lane)) edges.push({ from: [lane, row], to: [lane, row + 1], color: colors[lane]! })
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
  })
  const merged: Edge[] = [], tails = new Map<string, Edge>()
  for (const edge of edges) {
    if (edge.from[0] !== edge.to[0]) { merged.push(edge); continue }
    const key = `${edge.from[0]}:${edge.color}`, prev = tails.get(key)
    if (prev && prev.to[1] === edge.from[1]) prev.to = edge.to
    else { merged.push(edge); tails.set(key, edge) }
  }
  return { dots, edges: merged, lanes: widest }
}

export function laneSvg(graph: ReturnType<typeof layout>, row: number, head: boolean): string {
  const width = Math.max(36, graph.lanes * 16 + 20), x = (col: number) => 16 + col * 16, y = (r: number) => (r - row) * 30 + 15
  const edges = graph.edges.filter(e => e.from[1] <= row + 1 && e.to[1] >= row - 1).map(e => {
    const mid = (y(e.from[1]) + y(e.to[1])) / 2
    return `<path d="M ${x(e.from[0])} ${y(e.from[1])} C ${x(e.from[0])} ${mid}, ${x(e.to[0])} ${mid}, ${x(e.to[0])} ${y(e.to[1])}" stroke="${LANE_COLORS[e.color % 8]}"/>`
  }).join('')
  const dot = graph.dots[row]!, color = LANE_COLORS[dot.color % 8]!
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30" viewBox="0 0 ${width} 30"><g fill="none" stroke-width="2">${edges}</g>${head ? `<circle class="head-halo" cx="${x(dot.col)}" cy="15" r="9" fill="none" stroke="${color}" stroke-width="2"/>` : ''}<circle cx="${x(dot.col)}" cy="15" r="5" fill="${color}"/></svg>`
}

export function parseChanges(status: string, unstaged: string, staged: string): Change[] {
  const stats = { staged: new Map(numstat(staged).map(x => [x.path, x])), unstaged: new Map(numstat(unstaged).map(x => [x.path, x])) }
  const parts = status.split('\0'), changes: Change[] = []
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i]!
    if (record.startsWith('? ')) { changes.push({ path: record.slice(2), kind: 'untracked', code: '?' }); continue }
    const type = record[0]
    if (type !== '1' && type !== '2' && type !== 'u') continue
    const fields = record.split(' '), xy = fields[1] ?? '', path = fields.slice(type === '1' ? 8 : type === '2' ? 9 : 10).join(' ')
    const orig = type === '2' ? parts[++i] : undefined
    if (!path) continue
    const add = (kind: 'staged' | 'unstaged', code: string) => {
      const n = stats[kind].get(path)
      changes.push({ path, ...(orig === undefined ? {} : { orig }), kind, code, ...(n ? { added: n.added, removed: n.removed } : {}) })
    }
    if (type === 'u') add('unstaged', 'U')
    else {
      if (xy[0] && xy[0] !== '.') add('staged', xy[0])
      if (xy[1] && xy[1] !== '.') add('unstaged', xy[1])
    }
  }
  return changes
}

export function hunks(diff: string, max = 90000): { text: string; more: number } {
  const blocks: { lines: string[]; old: number; next: number }[] = []
  let current: (typeof blocks)[number] | undefined
  const lines = diff.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '�')
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line)
    if (header) {
      current = { lines: [line], old: Number(header[1] ?? 1), next: Number(header[2] ?? 1) }
      blocks.push(current)
    } else if (current && (current.old > 0 || current.next > 0 || line.startsWith('\\ No newline'))) {
      if (!/^[ +\\-]/.test(line)) { current = undefined; continue }
      current.lines.push(line)
      if (line[0] === ' ' || line[0] === '-') current.old--
      if (line[0] === ' ' || line[0] === '+') current.next--
    } else current = undefined
  }
  let text = '', more = 0, full = false
  for (const b of blocks) {
    const chunk = b.lines.join('\n'), size = text.length + (text ? 1 : 0) + chunk.length
    if (full || b.old !== 0 || b.next !== 0 || size > Math.min(max, 100000)) { more += b.lines.length; full = true }
    else text += (text ? '\n' : '') + chunk
  }
  return { text, more }
}

async function run($: EngineInterface, root: string | undefined, args: string[], accept = [0]) {
  try {
    const result = await $.process.run(['git', ...(root ? ['-C', root] : []), ...args], { timeoutMs: 8000 })
    return accept.includes(result.exitCode) ? result.stdout : undefined
  } catch { return undefined }
}

export async function repoRoot($: EngineInterface): Promise<string | undefined> {
  return (await run($, undefined, ['rev-parse', '--show-toplevel']))?.trim() || undefined
}

export const relativeFile = (file: string, root?: string) => root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file

type Source = { root: string; lines: GraphLine[]; changes: Change[] }
const sources = new Map<string, { at: number; pending: boolean; out: Promise<Source | undefined> }>()

export async function loadSource($: EngineInterface, signature = ''): Promise<Source | undefined> {
  const session = await $.session.id().catch(() => undefined)
  const sig = JSON.stringify([session, signature]), at = await $.clock.now()
  const hit = sources.get(sig)
  if (session && hit && (hit.pending || at >= hit.at && at - hit.at < 2000)) return hit.out
  const entry = { at, pending: true, out: Promise.resolve(undefined) as Promise<Source | undefined> }
  entry.out = (async () => {
    const root = await repoRoot($)
    if (!root) return undefined
    const [log, status, unstaged, staged] = await Promise.all([
      run($, root, ['log', '--graph', '--all', '--topo-order', '--no-color', '--decorate=full', '-n', '80', '--format=%x1f%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%cr']),
      run($, root, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
      run($, root, ['diff', '--numstat', '-z']),
      run($, root, ['diff', '--cached', '--numstat', '-z']),
    ])
    if (status === undefined || unstaged === undefined || staged === undefined) return undefined
    const data = { root, lines: parseLog(log ?? ''), changes: parseChanges(status, unstaged, staged) }
    return data
  })().finally(() => { entry.pending = false })
  if (session) sources.set(sig, entry)
  if (sources.size > 12) sources.delete(sources.keys().next().value!)
  return entry.out
}

// The pane redraws on every streamed edit: an open diff reuses its git output for 2 s unless the signature changed.
const recent = new Map<string, { at: number; pending: boolean; out: Promise<string | undefined> }>()
async function runRecent($: EngineInterface, sig: string, root: string, args: string[], accept?: number[]) {
  const key = JSON.stringify([sig, root, args]), at = await $.clock.now(), hit = recent.get(key)
  if (hit && (hit.pending || at >= hit.at && at - hit.at < 2000)) return hit.out
  const entry = { at, pending: true, out: Promise.resolve(undefined) as Promise<string | undefined> }
  entry.out = run($, root, args, accept).finally(() => { entry.pending = false })
  recent.set(key, entry)
  if (recent.size > 40) recent.delete(recent.keys().next().value!)
  return entry.out
}

export async function commitFiles($: EngineInterface, root: string, hash: string, sig = ''): Promise<{ path: string; added: number; removed: number }[]> {
  const text = await runRecent($, sig, root, ['show', '--numstat', '-z', '--format=', '--diff-merges=first-parent', hash])
  return numstat(text ?? '').map(({ path, added, removed }) => ({ path, added, removed }))
}

export async function fileDiff($: EngineInterface, root: string, sel: { path: string; orig?: string; kind?: Change['kind']; commit?: string }, sig = ''): Promise<string | undefined> {
  if (sel.commit) return runRecent($, sig, root, ['show', '--no-color', '--format=', '--diff-merges=first-parent', sel.commit, '--', sel.path])
  if (sel.kind === 'untracked') return runRecent($, sig, root, ['diff', '--no-color', '--no-index', '--', '/dev/null', sel.path], [0, 1])
  if (sel.kind === 'staged') return runRecent($, sig, root, ['diff', '--cached', '--no-color', '-M', '--', ...(sel.orig ? [sel.orig] : []), sel.path])
  return runRecent($, sig, root, ['diff', '--no-color', '--', sel.path])
}

export const refLabel = (r: Ref) => r.kind === 'head' ? r.name === 'HEAD' ? 'HEAD' : `HEAD → ${r.name}` : r.name

export function refSvg(ref: Ref, color: string, max = 24): string {
  const full = refLabel(ref), label = full.length > max ? `${full.slice(0, max - 1)}…` : full
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
  const width = Math.ceil(label.length * 7.2 + 12), accent = ref.kind === 'head' ? '#D97757' : ref.kind === 'tag' ? '#F59E0B' : color
  const solid = ref.kind === 'head', remote = ref.kind === 'remote'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20"><title>${esc(full)}</title><style>text{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;fill:${solid ? '#fff' : '#333'}}@media(prefers-color-scheme:dark){text{fill:${solid ? '#fff' : '#ddd'}}}</style><rect x=".5" y=".5" width="${width - 1}" height="19" rx="${ref.kind === 'tag' ? 3 : 5}" fill="${accent}" fill-opacity="${solid ? 1 : remote ? 0 : .16}" stroke="${accent}"${remote ? ' stroke-dasharray="3 2"' : ''}/><text x="6" y="14">${esc(label)}</text></svg>`
}
