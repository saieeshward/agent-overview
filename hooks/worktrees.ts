import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { WorktreeList, WorktreeRow } from '../types'

type $ = EngineInterface

// /clean-worktrees: every worktree of this repo with a numbered verdict; the owner picks numbers to remove,
// and only those are removed, after their unpushed commits (bundle) and uncommitted work (patch) are backed up.
const listing = atom({ plugin: 'agent-overview', key: 'worktrees' } as const, { repo: '', at: 0, rows: [] } as WorktreeList)
const STALE_MS = 15 * 60 * 1000

export type Verdict = WorktreeRow['verdict']
export const ORDER: Verdict[] = ['WIP', 'PUSH-FIRST', 'OPEN-PR', 'SAFE']

// git worktree list --porcelain: blocks of "worktree <path>", "HEAD <sha>", "branch refs/heads/<b>" | "detached", "prunable ...".
export function parsePorcelain(text: string): { path: string; head?: string; branch?: string; prunable?: boolean; bare?: boolean }[] {
  return text.split(/\n\n+/).map(block => {
    const get = (k: string) => block.split('\n').find(l => l === k || l.startsWith(`${k} `))
    const path = get('worktree')?.slice(9) ?? ''
    return { path, head: get('HEAD')?.slice(5), branch: get('branch')?.slice(7).replace(/^refs\/heads\//, ''), prunable: !!get('prunable'), bare: !!get('bare') }
  }).filter(w => w.path)
}

// Dirty work wins, then commits no remote has, then an open PR; clean and contained in a remote or merged is safe.
export function verdictOf(x: { dirty: number; unpushed: number; openPr?: number; merged: boolean; inRemote: boolean; prMerged: boolean; prunable?: boolean }): { verdict: Verdict; why: string } {
  if (x.prunable) return { verdict: 'SAFE', why: 'folder is gone (prunable)' }
  if (x.dirty) return { verdict: 'WIP', why: `${x.dirty} uncommitted change${x.dirty === 1 ? '' : 's'}` }
  if (x.unpushed && !x.merged) return { verdict: 'PUSH-FIRST', why: `${x.unpushed} commit${x.unpushed === 1 ? '' : 's'} on no remote` }
  if (x.openPr) return { verdict: 'OPEN-PR', why: `PR #${x.openPr} is open` }
  if (x.merged) return { verdict: 'SAFE', why: 'merged into the default branch' }
  if (x.prMerged) return { verdict: 'SAFE', why: 'its PR was merged' }
  if (x.inRemote) return { verdict: 'SAFE', why: 'contained in a remote branch' }
  return { verdict: 'PUSH-FIRST', why: 'not on any remote' }
}

async function run($: $, argv: string[], cwd?: string, timeoutMs = 15000, env?: Record<string, string>) {
  const r = await $.process.run(argv, { cwd, timeoutMs, env }).catch(() => undefined)
  return { ok: r?.exitCode === 0, out: (r?.stdout ?? '').trim(), err: (r?.stderr ?? '').trim() }
}
function git($: $, cwd: string, ...argv: string[]) { return run($, ['git', ...argv], cwd) }

export async function listWorktrees($: $): Promise<WorktreeList | { error: string }> {
  const cwd = await $.session.cwd().catch(() => '')
  const common = await git($, cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (!cwd || !common.ok) return { error: 'this folder is not a git repository' }
  const all = parsePorcelain((await git($, cwd, 'worktree', 'list', '--porcelain')).out)
  const repo = all[0]?.path ?? cwd
  const def = (await git($, repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).out || ((await git($, repo, 'rev-parse', '--verify', '--quiet', 'origin/main')).ok ? 'origin/main' : 'main')
  // One PR listing for the whole repo, by head branch (gh may be missing or signed out: then no PR facts).
  const prs = new Map<string, { number: number; state: string }[]>()
  if ((await run($, ['/usr/bin/env', 'gh', '--version'], repo, 5000)).ok) {
    const got = await run($, ['/usr/bin/env', 'gh', 'pr', 'list', '--state', 'all', '--limit', '300', '--json', 'number,state,headRefName'], repo, 20000)
    try { for (const p of JSON.parse(got.out || '[]') as { number: number; state: string; headRefName: string }[]) prs.set(p.headRefName, [...(prs.get(p.headRefName) ?? []), p]) } catch {}
  }
  const rows: WorktreeRow[] = []
  for (const w of all.slice(1)) {
    if (w.bare) continue
    const at = w.prunable ? 0 : Number((await git($, w.path, 'log', '-1', '--format=%ct')).out) * 1000 || 0
    const index = w.prunable ? undefined : (await git($, w.path, 'rev-parse', '--path-format=absolute', '--git-dir')).out
    const touched = index ? (await $.fs.stat(`${index}/index`).catch(() => undefined))?.mtimeMs ?? 0 : 0
    const dirty = w.prunable ? 0 : (await git($, w.path, 'status', '--porcelain')).out.split('\n').filter(Boolean).length
    const head = w.head ?? ''
    const unpushed = head ? Number((await git($, repo, 'rev-list', '--count', head, '--not', '--remotes')).out) || 0 : 0
    const merged = !!head && (await git($, repo, 'merge-base', '--is-ancestor', head, def)).ok
    const inRemote = !!head && !!(await git($, repo, 'branch', '-r', '--contains', head)).out
    const mine = w.branch ? prs.get(w.branch) ?? [] : []
    const openPr = mine.find(p => p.state === 'OPEN')?.number
    const prMerged = mine.some(p => p.state === 'MERGED')
    const v = verdictOf({ dirty, unpushed, openPr, merged, inRemote, prMerged, prunable: w.prunable })
    rows.push({ n: rows.length + 1, path: w.path, branch: w.branch, head: head.slice(0, 12), ...v, dirty, unpushed, last: Math.max(at, touched) })
  }
  const next: WorktreeList = { repo, at: (await $.clock.now()) || 1, rows }
  await update($, listing, () => next)
  return next
}

const day = (t: number) => t ? new Date(t).toISOString().slice(0, 10) : 'unknown'
export function listingText(l: WorktreeList) {
  if (!l.rows.length) return `No worktrees besides the main one in ${l.repo}.`
  const lines = l.rows.map(r => `${String(r.n).padStart(2)}. ${r.verdict.padEnd(10)} ${r.branch ?? `(detached ${r.head.slice(0, 7)})`} · last activity ${day(r.last)} · ${r.why}\n      ${r.path}`)
  return [`Worktrees of ${l.repo}:`, ...lines, '', 'Remove by number: /clean-worktrees <n> [n...] (e.g. /clean-worktrees 2 5). Unpushed commits are bundled and uncommitted changes saved as patches in archive/<date>-worktrees/ first. Nothing is removed unless you name it.'].join('\n')
}

// The folder a removal may touch: a listed, non-main worktree, absolute, deep enough to be nobody's home.
export const removable = (path: string, repo: string) => path.startsWith('/') && path !== repo && path.split('/').filter(Boolean).length >= 3 && !/(^|\/)\.\.(\/|$)/.test(path)

// Back up, then remove only the numbers the owner named. Each shell step reads its paths from guarded variables.
export async function cleanPicked($: $, picks: number[]): Promise<string> {
  let l = await read($, listing)
  const now = await $.clock.now()
  if (!l.rows.length || !l.at || now - l.at > STALE_MS) return 'The list is missing or older than 15 minutes: run /clean-worktrees to see the current numbers first.'
  const fresh = await listWorktrees($)
  if ('error' in fresh) return fresh.error
  const same = picks.every(n => { const a = l.rows.find(r => r.n === n), b = fresh.rows.find(r => r.n === n); return a && b && a.path === b.path && a.verdict === b.verdict })
  if (!same) return `The worktrees changed since the list was shown:\n\n${listingText(fresh)}`
  l = fresh
  const date = new Date(now).toISOString().slice(0, 10)
  const archive = `${l.repo}/archive/${date}-worktrees`
  const out: string[] = []
  for (const n of [...new Set(picks)].sort((a, b) => a - b)) {
    const r = l.rows.find(x => x.n === n)
    if (!r) { out.push(`${n}: no such number`); continue }
    if (!removable(r.path, l.repo)) { out.push(`${n}: refused, ${r.path} is not a safe path to remove`); continue }
    const name = `${(r.branch ?? r.head).replace(/[^\w.-]+/g, '_')}`
    const env = { WT: r.path, OUT: archive, NAME: name, REF: r.branch ? `refs/heads/${r.branch}` : r.head }
    if (!(await run($, ['/bin/sh', '-c', 'mkdir -p "${OUT:?}"'], l.repo, 5000, env)).ok) { out.push(`${n}: could not make ${archive}; nothing removed`); continue }
    const saved: string[] = []
    if (r.unpushed) {
      const b = await run($, ['/bin/sh', '-c', 'git -C "${WT:?}" bundle create "${OUT:?}/${NAME:?}.bundle" "${REF:?}" --not --remotes'], l.repo, 60000, env)
      if (!b.ok) { out.push(`${n}: bundle failed (${b.err.slice(0, 120)}); nothing removed`); continue }
      saved.push(`${name}.bundle`)
    }
    if (r.dirty) {
      const p = await run($, ['/bin/sh', '-c', 'git -C "${WT:?}" diff HEAD --binary > "${OUT:?}/${NAME:?}.patch" && git -C "${WT:?}" ls-files --others --exclude-standard -z | tar -czf "${OUT:?}/${NAME:?}-untracked.tgz" -C "${WT:?}" --null -T -'], l.repo, 60000, env)
      if (!p.ok) { out.push(`${n}: saving uncommitted work failed (${p.err.slice(0, 120)}); nothing removed`); continue }
      saved.push(`${name}.patch`, `${name}-untracked.tgz`)
    }
    // Every backup must be on disk before the worktree goes (a patch may be empty when only new files changed).
    const missing: string[] = []
    for (const f of saved) {
      const st = await $.fs.stat(`${archive}/${f}`).catch(() => undefined)
      if (!st || st.kind !== 'file' || (f.endsWith('.bundle') && !st.size)) missing.push(f)
    }
    if (missing.length) { out.push(`${n}: backup ${missing.join(', ')} is missing; nothing removed`); continue }
    const prunable = r.why.includes('prunable')
    // The owner named this one: a dirty worktree needs --force, and its work is saved above.
    const rm = prunable ? await run($, ['git', '-C', l.repo, 'worktree', 'prune'], l.repo)
      : await run($, ['git', '-C', l.repo, 'worktree', 'remove', ...(r.dirty ? ['--force'] : []), r.path], l.repo, 60000)
    out.push(rm.ok ? `${n}: removed ${r.path}${saved.length ? ` (saved ${saved.join(', ')} in archive/${date}-worktrees/)` : ''}` : `${n}: git refused to remove it: ${rm.err.slice(0, 160)}`)
  }
  await update($, listing, x => ({ ...x, at: 0 }))
  return out.join('\n')
}

export function parsePicks(args: string): number[] | undefined {
  const words = args.trim().split(/[\s,]+/).filter(Boolean)
  if (!words.length) return undefined
  return words.every(w => /^\d{1,3}$/.test(w)) ? words.map(Number) : []
}
