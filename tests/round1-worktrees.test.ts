import { expect, mock, test } from 'claude-code/testing'
import { ignoredEntries, verdictOf } from '../hooks/worktrees'

// Adversarial review round 1: findings 5 and 11 (/clean-worktrees).
const R = '/Users/sai/repo'
const HOME = '/home/t'
const BASE = { dirty: 0, unpushed: 0, merged: true, inRemote: true, prMerged: false }

test('5: ignored files are counted, and a worktree that has them is not SAFE', () => {
  // The repro: clean, merged, and holding an ignored .env: it was SAFE and the file was deleted.
  expect(verdictOf({ ...BASE, ignored: 0 }).verdict).toBe('SAFE')
  const v = verdictOf({ ...BASE, ignored: 2 })
  expect(v.verdict).toBe('WIP')
  expect(v.why).toContain('2 ignored files')
  expect(verdictOf({ ...BASE, ignored: 1 }).why).toContain('1 ignored file ')
  expect(verdictOf({ ...BASE, unpushed: 2, merged: false, ignored: 3 }).why).toContain('3 ignored files')
  expect(verdictOf({ ...BASE, dirty: 1, ignored: 3 }).why).toBe('1 uncommitted change and 3 ignored files')
  expect(verdictOf({ ...BASE, ignored: 5, prunable: true }).verdict).toBe('SAFE')
  // Dependency and cache folders a build recreates are not counted.
  expect(ignoredEntries('.env\nnode_modules/\npkg/node_modules/\n.venv/\n__pycache__/\nlocal/index.db\n')).toEqual(['.env', 'local/index.db'])
})

const PORCELAIN = (extra = '') => [
  `worktree ${R}\nHEAD aaa\nbranch refs/heads/main`,
  `worktree ${R}-env\nHEAD bbb\nbranch refs/heads/env`,
  `worktree ${R}-here\nHEAD ccc\nbranch refs/heads/here`,
  `worktree ${R}-clean\nHEAD ddd\nbranch refs/heads/clean`,
  `worktree /Users/sai/old/gone-wt\nHEAD fff\ndetached\nprunable gitdir file points to non-existent location`,
  `worktree /Users/sai/old/other-gone\nHEAD eee\ndetached\nprunable gitdir file points to non-existent location`,
  extra,
].filter(Boolean).join('\n\n') + '\n'

const flags = { noTar: false }
function setup($: any, on: any, session = R) {
  flags.noTar = false
  const clock = mock.clock(on); mock.store(on)
  mock.env(on, { HOME })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: session }))
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
    if (argv[0] === '/bin/sh') {
      const name = env?.NAME
      if (a.includes('-ignored.tgz') && !flags.noTar) files.add(`${env.OUT}/${name}-ignored.tgz`)
    } else if (a.includes('--git-common-dir')) out = `${R}/.git`
    else if (a.includes('--show-toplevel')) out = session
    else if (a.includes('worktree list --porcelain')) out = PORCELAIN()
    else if (a.includes('symbolic-ref')) out = 'origin/main'
    else if (argv[1] === 'gh') code = 1
    else if (a.includes('log -1 --format=%ct')) out = '1762300000'
    else if (a.includes('--git-dir')) out = `${cwd}/.git`
    else if (a.includes('status --porcelain')) out = ''
    else if (a.includes('ls-files -o -i')) out = cwd === `${R}-env` ? '.env\nlocal/index.db\nnode_modules/\n' : cwd === `${R}-here` ? '.env\n' : ''
    else if (a.includes('rev-list --count')) out = '0'
    else if (a.includes('merge-base --is-ancestor')) code = 0
    else if (a.includes('branch -r --contains')) out = 'origin/x'
    return { value: { stdout: out, stderr: '', exitCode: code, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const cmd = async (args: string) => (await ($.command as any).run({ command: 'clean-worktrees', args })).text as string
  return { ran, cmd, clock }
}

test('5 and 11: ignored files are listed, tarred before removal; the session worktree is not offered; backups sit outside every worktree', async ($, on) => {
  const { ran, cmd, clock } = setup($, on, `${R}-here`)
  const list = await cmd('')
  // The worktree this session runs in is not listed at all.
  expect(list).not.toContain(`${R}-here`)
  expect(list).toContain('WIP        env · ')
  expect(list).toContain('2 ignored files (.env, local files) that no remote has')
  expect(list).toContain('SAFE       clean')
  expect(list).toContain('~/.claude/worktree-backups/')
  ran.length = 0
  const done = await cmd('1 2')
  const shells = ran.filter(x => x.argv[0] === '/bin/sh')
  const tar = shells.find(s => s.argv[2]!.includes('ls-files -o -i --exclude-standard -z --directory'))!
  expect(tar).toBeDefined()
  expect(tar.argv[2]).toContain('-ignored.tgz')
  expect(tar.argv[2]).toContain('--exclude=node_modules')
  expect(tar.env?.WT).toBe(`${R}-env`)
  // Outside every worktree: not in the repo folder, not under any listed worktree.
  expect(tar.env?.OUT).toMatch(/^\/home\/t\/\.claude\/worktree-backups\/repo\/\d{4}-\d{2}-\d{2}$/)
  for (const wt of [R, `${R}-env`, `${R}-clean`]) expect(tar.env!.OUT!.startsWith(`${wt}/`)).toBe(false)
  // The tar happens before the removal, and the removal forces only because the backup is on disk.
  const tarAt = ran.findIndex(x => x === tar), rmAt = ran.findIndex(x => x.argv.includes('remove') && x.argv.includes(`${R}-env`))
  expect(tarAt).toBeGreaterThan(-1)
  expect(rmAt).toBeGreaterThan(tarAt)
  expect(done).toContain(`1: removed ${R}-env (saved env-ignored.tgz`)
  expect(done).toContain(`2: removed ${R}-clean`)
  // Every shell step reads its paths from guarded variables.
  for (const s of shells) for (const v of s.argv[2]!.match(/\$\{\w+/g) ?? []) expect(s.argv[2]).toContain(`${v}:?}`)
  await clock.advance(0)
})

test('5: nothing is removed when the ignored-file backup is missing', async ($, on) => {
  const { ran, cmd } = setup($, on)
  await cmd('')
  // The tar step "succeeds" without writing the file.
  flags.noTar = true
  ran.length = 0
  const out = await cmd('1')
  expect(out).toContain('is missing; nothing removed')
  expect(ran.some(x => x.argv.includes('remove'))).toBe(false)
})

test('11: a stale entry is dropped by removing its own entry under the common git dir, never by a global worktree prune', async ($, on) => {
  const { ran, cmd } = setup($, on, `${R}-here`)
  const list = await cmd('')
  expect(list).toContain('(detached fff)')
  ran.length = 0
  const out = await cmd('3')
  expect(ran.some(x => x.argv.join(' ').includes('worktree prune'))).toBe(false)
  const sh = ran.find(x => x.argv[0] === '/bin/sh' && x.argv[2]!.includes('/worktrees/*/'))!
  expect(sh).toBeDefined()
  expect(sh.env?.WT).toBe('/Users/sai/old/gone-wt')
  expect(sh.env?.COMMON).toBe(`${R}/.git`)
  expect(sh.argv[2]).toContain('gitdir')
  expect(sh.argv[2]).not.toContain('/Users/sai/old/gone-wt')
  expect(out).toContain('3: removed /Users/sai/old/gone-wt')
  // The other stale entry is untouched.
  expect(ran.some(x => x.env?.WT === '/Users/sai/old/other-gone')).toBe(false)
})
