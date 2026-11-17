import { expect, mock, test } from 'claude-code/testing'
import type { WorktreeList } from '../types'
import { listingText, parsePicks, parsePorcelain, removable, verdictOf } from '../hooks/worktrees'

const R = '/Users/sai/repo'
const PORCELAIN = [
  `worktree ${R}\nHEAD aaa\nbranch refs/heads/main`,
  `worktree ${R}-wip\nHEAD bbb\nbranch refs/heads/wip`,
  `worktree ${R}-push\nHEAD ccc\nbranch refs/heads/push`,
  `worktree ${R}-pr\nHEAD ddd\nbranch refs/heads/pr`,
  `worktree ${R}-done\nHEAD eee\nbranch refs/heads/done`,
  `worktree /tmp/gone-wt\nHEAD fff\ndetached\nprunable gitdir file points to non-existent location`,
].join('\n\n') + '\n'

test('worktree listing, verdicts and picks', () => {
  const all = parsePorcelain(PORCELAIN)
  expect(all.map(w => w.path)).toEqual([R, `${R}-wip`, `${R}-push`, `${R}-pr`, `${R}-done`, '/tmp/gone-wt'])
  expect(all[1]).toMatchObject({ head: 'bbb', branch: 'wip' })
  expect(all[5]).toMatchObject({ branch: undefined, prunable: true })
  const base = { dirty: 0, unpushed: 0, merged: false, inRemote: false, prMerged: false }
  expect(verdictOf({ ...base, dirty: 3, unpushed: 2 })).toEqual({ verdict: 'WIP', why: '3 uncommitted changes' })
  expect(verdictOf({ ...base, unpushed: 1, openPr: 9 }).verdict).toBe('PUSH-FIRST')
  expect(verdictOf({ ...base, openPr: 9, inRemote: true })).toEqual({ verdict: 'OPEN-PR', why: 'PR #9 is open' })
  expect(verdictOf({ ...base, merged: true, unpushed: 4 }).verdict).toBe('SAFE')
  expect(verdictOf({ ...base, prMerged: true }).why).toBe('its PR was merged')
  expect(verdictOf({ ...base, inRemote: true }).why).toBe('contained in a remote branch')
  expect(verdictOf({ ...base }).verdict).toBe('PUSH-FIRST')
  expect(verdictOf({ ...base, dirty: 1, prunable: true }).verdict).toBe('SAFE')
  expect(parsePicks('')).toBeUndefined()
  expect(parsePicks('2 5,7')).toEqual([2, 5, 7])
  expect(parsePicks('all')).toEqual([])
  expect(removable(`${R}-wip`, R)).toBe(true)
  for (const bad of [R, '/', '/Users/sai', 'rel/path/x', `${R}/../../etc`]) expect(removable(bad, R)).toBe(false)
  const l: WorktreeList = { repo: R, at: 1, rows: [{ n: 1, path: `${R}-wip`, branch: 'wip', head: 'bbb', verdict: 'WIP', why: '2 uncommitted changes', dirty: 2, unpushed: 0, last: Date.UTC(2026, 10, 3) }] }
  const text = listingText(l)
  expect(text).toContain(' 1. WIP        wip · last activity 2026-11-03 · 2 uncommitted changes')
  expect(text).toContain('Nothing is removed unless you name it.')
})

test('/clean-worktrees lists with numbers, removes only the picked ones after backing them up, through guarded paths', async ($, on) => {
  const clock = mock.clock(on); mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: R }))
  const ran: { argv: string[]; cwd?: string; env?: Record<string, string> }[] = []
  const files = new Set<string>()
  on('fs.stat', (_$: any, e: any) => {
    if (files.has(e.path)) return { value: { kind: 'file', size: 100, mtimeMs: 0, isLink: false } }
    throw new Error('ENOENT')
  })
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv, cwd: string | undefined = e.init?.cwd, env = e.init?.env
    ran.push({ argv, cwd, env })
    const a = argv.join(' ')
    let out = '', code = 0
    if (a.includes('--git-common-dir')) out = `${R}/.git`
    else if (a.includes('worktree list --porcelain')) out = PORCELAIN
    else if (a.includes('symbolic-ref')) out = 'origin/main'
    else if (argv[1] === 'gh' && argv[2] === '--version') out = 'gh 2.0'
    else if (argv[1] === 'gh') out = '[{"number":12,"state":"OPEN","headRefName":"pr"},{"number":3,"state":"MERGED","headRefName":"done"},{"number":2,"state":"CLOSED","headRefName":"push"}]'
    else if (a.includes('log -1 --format=%ct')) out = '1762300000'
    else if (a.includes('--git-dir')) out = `${cwd}/.git`
    else if (a.includes('status --porcelain')) out = cwd === `${R}-wip` ? ' M a.ts\n?? b.ts' : ''
    else if (a.includes('rev-list --count')) out = a.includes(' bbb ') || a.includes(' ccc ') ? '2' : '0'
    else if (a.includes('merge-base --is-ancestor')) code = 1
    else if (a.includes('branch -r --contains')) out = a.includes('ddd') || a.includes('eee') ? 'origin/x' : ''
    else if (argv[0] === '/bin/sh') {
      const name = env?.NAME
      if (a.includes('bundle create')) files.add(`${env.OUT}/${name}.bundle`)
      if (a.includes('diff HEAD --binary')) { files.add(`${env.OUT}/${name}.patch`); files.add(`${env.OUT}/${name}-untracked.tgz`) }
    }
    return { value: { stdout: out, stderr: '', exitCode: code, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const cmd = async (args: string) => (await ($.command as any).run({ command: 'clean-worktrees', args })).text as string

  expect(await cmd('2')).toContain('run /clean-worktrees to see the current numbers first')
  const list = await cmd('')
  for (const line of ['1. WIP        wip', '2. PUSH-FIRST push', '3. OPEN-PR    pr', '4. SAFE       done', '5. SAFE       (detached fff)']) expect(list).toContain(line)
  expect(list).toContain('its PR was merged')
  expect(ran.some(x => x.argv.includes('remove'))).toBe(false)

  ran.length = 0
  const done = await cmd('1 2 4')
  const removed = ran.filter(x => x.argv.includes('remove')).map(x => x.argv)
  expect(removed).toEqual([
    ['git', '-C', R, 'worktree', 'remove', '--force', `${R}-wip`],
    ['git', '-C', R, 'worktree', 'remove', `${R}-push`],
    ['git', '-C', R, 'worktree', 'remove', `${R}-done`],
  ])
  // Shell steps read every path from guarded variables, never from the command text.
  const shells = ran.filter(x => x.argv[0] === '/bin/sh')
  for (const s of shells) {
    expect(s.argv[2]).not.toContain(R)
    for (const v of s.argv[2]!.match(/\$\{\w+/g) ?? []) expect(s.argv[2]).toContain(`${v}:?}`)
  }
  const archive = new RegExp(`^${R}/archive/\\d{4}-\\d{2}-\\d{2}-worktrees$`)
  expect(shells.some(s => s.argv[2]!.includes('bundle create') && s.env?.WT === `${R}-push` && archive.test(s.env?.OUT ?? ''))).toBe(true)
  expect(shells.some(s => s.argv[2]!.includes('diff HEAD --binary') && s.env?.WT === `${R}-wip`)).toBe(true)
  expect(done).toContain(`1: removed ${R}-wip (saved wip.bundle, wip.patch, wip-untracked.tgz`)
  expect(done).toContain(`2: removed ${R}-push (saved push.bundle`)
  expect(done).toContain(`4: removed ${R}-done`)
  // Numbers come from a fresh list only: after a removal the owner lists again.
  expect(await cmd('3')).toContain('run /clean-worktrees')
  await clock.advance(0)
})
