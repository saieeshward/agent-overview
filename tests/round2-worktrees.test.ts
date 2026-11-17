import { expect, mock, test } from 'claude-code/testing'
import { ignoredEntries, ignoredTarScript, isRegenerable } from '../hooks/worktrees'

// Adversarial review round 2: findings F and G (/clean-worktrees backups).
const R = '/Users/sai/repo'
const HOME = '/home/t'

test('F: venvs are regenerable only at the top of a worktree (or inside a regenerable folder); node_modules and caches anywhere', () => {
  for (const e of ['venv/', '.venv/', 'node_modules/', 'pkg/node_modules/', '__pycache__/', 'src/__pycache__/', '.next/', 'node_modules/.venv/', 'pkg/node_modules/x/venv/', '.pytest_cache/', '.ruff_cache/'])
    expect(isRegenerable(e), e).toBe(true)
  for (const e of ['docs/venv/', 'tools/.venv/', 'a/b/venv/', '.env', 'venv-notes.txt', 'venvx/', 'local/index.db', 'my_venv/'])
    expect(isRegenerable(e), e).toBe(false)
  expect(ignoredEntries('.env\nvenv/\ndocs/venv/\npkg/node_modules/\n.venv/\ntools/.venv/\n')).toEqual(['.env', 'docs/venv/', 'tools/.venv/'])
  expect(ignoredTarScript()).toContain("'--exclude=^venv$'")
  expect(ignoredTarScript()).toContain('--exclude=node_modules')
})

test('F: a second removal of the same branch on the same day keeps the first ignored-files backup', async ($, on) => {
  const clock = mock.clock(on); mock.store(on)
  mock.env(on, { HOME })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: R }))
  const files = new Set<string>()
  const igns: string[] = []
  on('fs.stat', (_$: any, e: any) => { if (files.has(e.path)) return { value: { kind: 'file', size: 100, mtimeMs: 0, isLink: false } }; throw new Error('ENOENT') })
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv, cwd: string | undefined = e.init?.cwd, env = e.init?.env
    const a = argv.join(' ')
    let out = ''
    if (argv[0] === '/bin/sh') { if (env?.IGN) { igns.push(env.IGN); files.add(`${env.OUT}/${env.IGN}`) } }
    else if (a.includes('--git-common-dir')) out = `${R}/.git`
    else if (a.includes('--show-toplevel')) out = R
    else if (a.includes('worktree list --porcelain')) out = `worktree ${R}\nHEAD aaa\nbranch refs/heads/main\n\nworktree ${R}-env\nHEAD bbb\nbranch refs/heads/env\n`
    else if (a.includes('symbolic-ref')) out = 'origin/main'
    else if (a.includes('log -1 --format=%ct')) out = '1762300000'
    else if (a.includes('--git-dir')) out = `${cwd}/.git`
    else if (a.includes('ls-files -o -i')) out = '.env\n'
    else if (a.includes('rev-list --count')) out = '0'
    return { value: { stdout: out, stderr: '', exitCode: argv[1] === 'gh' ? 1 : 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const cmd = async (args: string) => (await ($.command as any).run({ command: 'clean-worktrees', args })).text as string
  await cmd(''); await cmd('1')
  await cmd(''); await cmd('1')
  expect(igns).toHaveLength(2)
  expect(igns[0]).toMatch(/^env-ignored-\d{6}\.tgz$/)
  expect(new Set(igns).size).toBe(2)
  await clock.advance(0)
})

// ---------- G. one real tar round trip ----------

test('G: the real ignored-files tar keeps .env and local files, and leaves out regenerable folders (bsdtar)', async ($) => {
  const run = (argv: string[], cwd?: string, env?: Record<string, string>) => $.process.run(argv, { cwd, env, timeoutMs: 20000 })
  let dir = ''
  try { dir = (await run(['/usr/bin/mktemp', '-d', '/tmp/ao-r2-tar.XXXXXX'])).stdout.trim() } catch { return }
  if (!dir.startsWith('/tmp/ao-r2-tar.')) return // no real process in this host: skipped
  try {
    const wt = `${dir}/wt`, out = `${dir}/out`
    const sh = (script: string, env?: Record<string, string>) => run(['/bin/sh', '-c', script], dir, env)
    await sh('mkdir -p wt/venv wt/docs/venv wt/pkg/node_modules wt/local out && cd wt && git init -q . && printf ".env\\nvenv/\\ndocs/venv/\\nnode_modules/\\npkg/node_modules/\\nlocal/\\n" > .gitignore && echo secret > .env && echo a > venv/a && echo b > docs/venv/b && echo c > pkg/node_modules/c && echo d > local/index.db')
    const r = await run(['/bin/sh', '-c', ignoredTarScript()], dir, { WT: wt, OUT: out, IGN: 'x-ignored-010203.tgz' })
    if (r.exitCode !== 0 && /not found|No such file/.test(r.stderr)) return // no git or tar on this host: skipped
    expect(r.exitCode, r.stderr).toBe(0)
    const listing = (await run(['/usr/bin/tar', '-tzf', `${out}/x-ignored-010203.tgz`])).stdout.split('\n').filter(Boolean)
    expect(listing).toEqual(expect.arrayContaining(['.env', 'docs/venv/b', 'local/index.db']))
    expect(listing.some(l => l.startsWith('venv/'))).toBe(false)
    expect(listing.some(l => l.includes('node_modules'))).toBe(false)
  } finally {
    if (dir.startsWith('/tmp/ao-r2-tar.')) await run(['/bin/rm', '-rf', '--', dir]).catch(() => undefined)
  }
})
