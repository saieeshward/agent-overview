import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import type { Costs, EditItem, Prices, Providers, Stage } from '../types'
import { blank, defaultRouting } from '../hooks/state'
import { commitFiles, fileDiff, hunks, laneSvg, layout, loadSource, parseChanges, parseLog, refSvg, repoRoot } from '../hooks/work/git'
import type { Commit, GraphLine } from '../hooks/work/git'

const hash = (n: number) => n.toString(16).padStart(40, '0')
const logLine = (graph: string, n: number, parents: number[], refs: string, subject: string, when = '5 minutes ago') =>
  `${graph} \x1f${hash(n)}\x1f${parents.map(hash).join(' ')}\x1f${refs}\x1f${subject}\x1fAda\x1f${when}`
const LOG = [
  logLine('*', 1, [3, 2], 'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0', 'Merge <script> & "branch"'),
  '|\\', logLine('| *', 2, [4], 'refs/heads/feature/lanes', 'Branch work', '3 hours ago'),
  logLine('* |', 3, [4], '', 'Main work', '2 days ago'), '|/',
  logLine('*', 4, [5], '', 'Shared base', '1 week ago'),
].join('\n') + '\n'
const ordinary = (xy: string, path: string) => `1 ${xy} N... 100644 100644 100644 aaaa bbbb ${path}\0`
const STATUS = ordinary('M.', 'staged.ts') + ordinary('.M', 'edit file.ts') + ordinary('MM', 'both.ts')
  + '2 R. N... 100644 100644 100644 aaaa bbbb R100 renamed file.ts\0old file.ts\0'
  + 'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.ts\0? new.txt\0'
const UNSTAGED = '6\t2\tedit file.ts\0' + '1\t1\tboth.ts\0-\t-\tconflict.ts\0'
const STAGED = '2\t1\tstaged.ts\0' + '4\t3\tboth.ts\0' + '3\t1\t\0old file.ts\0renamed file.ts\0'
const HUNK = '@@ -1 +1 @@\n-old\n+new'
const DIFF = `diff --git a/edit file.ts b/edit file.ts\nindex aaaa..bbbb 100644\n--- a/edit file.ts\n+++ b/edit file.ts\n${HUNK}\n`
const result = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode, isStdoutTruncated: false, isStderrTruncated: false })
function fixture(argv: readonly string[]) {
  if (argv.includes('--show-toplevel')) return result('/repo\n')
  if (argv.includes('--no-index')) return result(`diff --git a/new.txt b/new.txt\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+brand new\n`, 1)
  if (argv.includes('log')) return result(LOG)
  if (argv.includes('status')) return result(STATUS)
  if (argv.includes('--numstat')) return result(argv.includes('show') ? '1\t1\tedit file.ts\0' : argv.includes('--cached') ? STAGED : UNSTAGED)
  return result(DIFF)
}

test('source log preserves graph connectors, parent hashes, refs and compact dates', () => {
  const lines = parseLog(LOG), commits = lines.flatMap(x => x.commit ? [x.commit] : [])
  expect(lines.length).toBe(6)
  expect(lines[1]).toEqual({ graph: '|\\' })
  expect(lines[2]?.graph).toBe('| *')
  expect(commits.length).toBe(4)
  expect(commits[0]).toMatchObject({ hash: hash(1), parents: [hash(3), hash(2)], author: 'Ada', when: '5m', refs: [
    { kind: 'head', name: 'main' }, { kind: 'remote', name: 'origin/main' }, { kind: 'tag', name: 'v1.0' },
  ] })
  expect(commits.map(c => c.when)).toEqual(['5m', '3h', '2d', '1w'])
  expect(parseLog(logLine('*', 10, [], 'HEAD', 'Detached', '4 months ago'))[0]?.commit).toMatchObject({ parents: [], refs: [{ kind: 'head', name: 'HEAD' }], when: '4mo' })
  expect(parseLog(logLine('*', 11, [], '', 'Old', 'a year ago'))[0]?.commit?.when).toBe('1y')
  expect(commits[1]?.refs).toEqual([{ kind: 'branch', name: 'feature/lanes' }])
  expect(parseLog(logLine('*', 12, [], 'refs/stash', 'WIP'))[0]?.commit?.refs).toEqual([{ kind: 'remote', name: 'stash' }])
  expect(parseLog('')).toEqual([])
})

for (const surface of ['desktop', 'terminal'] as const) test(`narrow history keeps subjects and opens commits with compact refs (${surface})`, async ($, on) => {
  mock.clock(on); mock.store(on)
  on('session.id', () => ({ value: `source-narrow-${surface}` }))
  on('process.run', (_$, e) => ({ value: fixture(e.argv) }))
  on('state.get', { plugin: 'agent-overview', key: 'ui' }, (_$, e, next) => next(e))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
    title: 'Agent panel', isFocused: true, bodyColumns: surface === 'desktop' ? 49 : 64, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {},
  } })
  await ui.press({ key: 'area:work' }); await ui.press({ key: 'area:confirm' }); await ui.press({ key: 'wtab:source' })
  const history = await ui.find({ key: 'src:history' })
  expect(history?.text).not.toContain(hash(1).slice(0, 7))
  expect(history?.text).toContain('Merge <script>')
  expect(history?.text).toContain('+2')
  if (surface === 'desktop') {
    const refs = (await ui.findAll({ type: 'Svg' })).filter(s => /^(head|branch|tag|remote):/.test(String(s.props.alt)))
    expect(refs.length).toBe(2)
  }
  await ui.press({ key: `src:commit:${hash(1)}` })
  expect(await ui.find({ key: 'src:files' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(hash(1).slice(0, 7)) })).toBeDefined()
  await ui.unmount()
})

test('source lanes follow parents through merges, forks and the bottom boundary without column shifts', () => {
  const commits = parseLog(LOG).flatMap(x => x.commit ? [x.commit] : []), g = layout(commits)
  expect(g.dots.map(d => d.col)).toEqual([0, 1, 0, 0])
  expect(g.dots[0]?.color).not.toBe(g.dots[1]?.color)
  expect(g.lanes).toBe(2)
  expect(g.edges.some(e => e.from[0] !== e.to[0])).toBe(true)
  expect(g.edges.some(e => e.from[0] === 1 && e.to[0] === 0 && e.to[1] === 3)).toBe(true)
  expect(g.edges.some(e => e.to[1] === commits.length)).toBe(true)
  expect(g.edges.some(e => e.from[0] === 0 && e.from[1] === 0 && e.to[1] > 1)).toBe(true)
  const roots = layout([0, 1].map(n => ({ ...commits[0]!, hash: hash(n + 90), parents: [] })))
  expect(roots.dots.map(d => d.col)).toEqual([0, 0])
  expect(roots.dots[0]?.color).not.toBe(roots.dots[1]?.color)
})

test('source changes parse both index and worktree edits, NUL renames, conflicts and spaced paths', () => {
  const changes = parseChanges(STATUS, UNSTAGED, STAGED)
  expect(changes.length).toBe(7)
  expect(changes.find(c => c.path === 'edit file.ts')).toEqual({ path: 'edit file.ts', kind: 'unstaged', code: 'M', added: 6, removed: 2 })
  expect(changes.filter(c => c.path === 'both.ts').map(c => [c.kind, c.added, c.removed])).toEqual([['staged', 4, 3], ['unstaged', 1, 1]])
  expect(changes.find(c => c.code === 'R')).toEqual({ path: 'renamed file.ts', orig: 'old file.ts', kind: 'staged', code: 'R', added: 3, removed: 1 })
  expect(changes.find(c => c.code === 'U')).toMatchObject({ path: 'conflict.ts', kind: 'unstaged', added: 0, removed: 0 })
  expect(changes.find(c => c.kind === 'untracked')).toEqual({ path: 'new.txt', kind: 'untracked', code: '?' })
  const odd = ' leading\tname\n.ts'
  expect(parseChanges(ordinary('.M', odd), `1\t0\t${odd}\0`, '')[0]?.path).toBe(odd)
})

test('source hunks strip every file header, retain complete hunks and report omitted lines', () => {
  const second = '@@ -0,0 +1,2 @@\n+one\n+two', both = DIFF + `diff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n${second}\n`
  expect(hunks(both)).toEqual({ text: `${HUNK}\n${second}`, more: 0 })
  expect(hunks(both, HUNK.length)).toEqual({ text: HUNK, more: 3 })
  expect(hunks(both, 1)).toEqual({ text: '', more: 6 })
  expect(hunks('Binary files a/a and b/a differ\n')).toEqual({ text: '', more: 0 })
  expect(hunks('@@ -1 +1,2 @@\n-old\n+incomplete\n')).toEqual({ text: '', more: 3 })
  expect(hunks(`${DIFF}\\ No newline at end of file\n`).text).toContain('\\ No newline at end of file')
  expect(hunks('@@ -0,0 +1 @@\n+bad\x1btext\n').text).not.toContain('\x1b')
  expect(hunks('@@ -1 +1 @@\r\n-a\r\n+b\r\n').text).toBe('@@ -1 +1 @@\n-a\n+b')
})

test('source git reads use argv and timeouts, cache by session and signature, and accept untracked exit 1', async () => {
  let now = 1000, fail = false, calls: { argv: string[]; timeout?: number }[] = []
  const api = { session: { id: async () => 'source-cache-unit' }, clock: { now: async () => now }, process: { run: async (argv: string[], init: { timeoutMs?: number }) => {
    calls.push({ argv, timeout: init.timeoutMs })
    if (fail) throw new Error('git unavailable')
    return fixture(argv)
  } } } as unknown as EngineInterface
  expect((await loadSource(api, 'first'))?.changes.length).toBe(7)
  expect(calls.length).toBe(5)
  await loadSource(api, 'first')
  expect(calls.length).toBe(5)
  await loadSource(api, 'next')
  expect(calls.length).toBe(10)
  now += 2001
  await loadSource(api, 'next')
  expect(calls.length).toBe(15)
  expect((await commitFiles(api, '/repo', hash(1)))[0]).toEqual({ path: 'edit file.ts', added: 1, removed: 1 })
  expect(await fileDiff(api, '/repo', { kind: 'untracked', path: 'new.txt' })).toContain('+brand new')
  await fileDiff(api, '/repo', { kind: 'staged', orig: 'old file.ts', path: 'renamed file.ts' })
  expect(calls[calls.length - 1]?.argv).toEqual(['git', '-C', '/repo', 'diff', '--cached', '--no-color', '-M', '--', 'old file.ts', 'renamed file.ts'])
  await fileDiff(api, '/repo', { commit: hash(1), path: 'edit file.ts' })
  expect(calls[calls.length - 1]?.argv).toEqual(['git', '-C', '/repo', 'show', '--no-color', '--format=', '--diff-merges=first-parent', hash(1), '--', 'edit file.ts'])
  expect(calls.every(c => c.timeout === 8000)).toBe(true)
  expect(calls.filter(c => !c.argv.includes('--show-toplevel')).every(c => c.argv[1] === '-C' && c.argv[2] === '/repo')).toBe(true)
  fail = true
  expect(await repoRoot(api)).toBeUndefined()
  expect(await fileDiff(api, '/repo', { path: 'edit file.ts' }, 'failure')).toBeUndefined()
  expect(await commitFiles(api, '/repo', hash(1), 'failure')).toEqual([])
  expect(await loadSource(api, 'failure')).toBeUndefined()
  fail = false
  const before = calls.length
  await commitFiles(api, '/repo', hash(1), 'failure')
  expect(calls.length).toBe(before)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`source navigation, stage rail and session usage render on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.id', () => ({ value: `source-navigation-${surface}` }))
    let ticks = 0, stageVersion = 0, stage: Stage = { at: 'implement', reached: ['plan', 'implement'], round: 1, since: hash(1) }
    const commands: string[][] = []
    on('process.run', (_$, e) => { commands.push([...e.argv]); return { value: fixture(e.argv) } })
    on('state.get', { plugin: 'agent-overview', key: 'tick' }, (_$, e, next) => { ticks++; return next(e) })
    on('state.get', { plugin: 'agent-overview', key: 'stage' }, () => ({ value: { value: stage, version: stageVersion } }))
    on('state.set', { plugin: 'agent-overview', key: 'stage' }, (_$, e) => {
      stage = e.value ?? stage
      return { value: { isSet: true, version: ++stageVersion } }
    })
    const providers: Providers = {
      claude: { ...blank(), status: 'ok', meters: [{ label: '5-hour', percent: 25 }, { label: 'Context', percent: 72 }] },
      codex: { ...blank(), status: 'ok', meters: [{ label: 'Weekly', percent: 40 }] },
      opencode: { ...blank(), status: 'missing' }, commandcode: { ...blank(), status: 'ok' }, antigravity: { ...blank(), status: 'ok', facts: ['90 monthly credits left'] }, ollama: blank(),
    }
    on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: providers, version: 1 } }))
    const routing = defaultRouting()
    routing.order = ['codex', 'opencode', 'commandcode', 'antigravity']; routing.on.commandcode = false
    on('state.get', { plugin: 'agent-overview', key: 'routing' }, () => ({ value: { value: routing, version: 1 } }))
    on('state.get', { plugin: 'agent-overview', key: 'git' }, () => ({ value: { value: { branch: 'main', commit: hash(1), dirty: 6, ahead: '↑2 ↓1' }, version: 1 } }))
    const edits: EditItem[] = [
      { file: '/repo/edit file.ts', model: 'claude-old', lines: [] },
      { file: '/elsewhere', repo: '/repo', path: 'edit file.ts', model: 'gpt-6.1-sol', provider: 'codex', agent: 'worker', lines: [] },
    ]
    on('state.get', { plugin: 'agent-overview', key: 'edits' }, () => ({ value: { value: edits, version: 1 } }))
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const costs: Costs = { engineUsd: 3.2, claude: { 'claude-opus-5-5': { ...tokens, input: 2000000 } }, agy: { 'gemini-4': { ...tokens, input: 1000000 } }, rows: [
      { ...tokens, provider: 'codex', model: 'gpt-6.1-sol', period: 'today', reported: 8 },
      { ...tokens, provider: 'commandcode', model: 'credits', period: 'period', reported: 100, credits: true },
    ], base: [{ ...tokens, provider: 'codex', model: 'gpt-6.1-sol', period: 'today', reported: 5 }] }
    const prices: Prices = { catalog: {}, overrides: { 'claude-opus-5-5': { input: 1, output: 1 }, 'gemini-4': { input: .5, output: .5 } } }
    on('state.get', { plugin: 'agent-overview', key: 'costs' }, () => ({ value: { value: costs, version: 1 } }))
    on('state.get', { plugin: 'agent-overview', key: 'prices' }, () => ({ value: { value: prices, version: 1 } }))
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
      title: 'Overview', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {},
    } })
    const has = async (query: Parameters<typeof ui.find>[0]) => {
      const element = await ui.find(query)
      if (!element) throw new Error(`Missing element: ${JSON.stringify(query)}`)
      return element
    }
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    await has({ key: 'work:implement' })
    await ui.press({ key: 'wtab:source' })
    await has({ key: 'work:source' })
    await has({ type: 'Text', text: '$6.70 session' })
    expect((await ui.find({ type: 'Text', text: 'ctx 72%' }))?.props.color).toBe('warning')
    if (surface === 'terminal') for (const p of ['Claude', 'Codex', 'Antigravity']) await has({ type: 'Text', text: new RegExp(`^${p} `) })
    for (const p of ['OpenCode', 'Command Code']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${p} `) })).toBeUndefined()
    if (surface === 'terminal') await has({ type: 'Text', text: /75%.*left/ })
    await has({ type: 'Text', text: /gpt-6.1-sol/ })
    await has({ type: 'Text', text: /subagent/ })
    await has({ key: 'src:file:unstaged:edit file.ts' })
    if (surface === 'desktop') {
      const svgs = await ui.findAll({ type: 'Svg' })
      expect(svgs.some(s => String(s.props.source).includes('PLAN'))).toBe(true)
      const usage = svgs.find(s => String(s.props.alt).startsWith('Usage:'))
      expect(usage?.props.alt).toBe('Usage: Claude, Codex, Antigravity')
      for (const name of ['Claude', 'Codex', 'Antigravity', '75% left']) expect(String(usage?.props.source)).toContain(name)
      for (const name of ['OpenCode', 'Command Code', 'Agy', 'Cmd']) expect(String(usage?.props.source)).not.toContain(name)
      expect(svgs.some(s => String(s.props.source).includes('head-halo') && !s.props.isInteractive)).toBe(true)
      expect(await ui.find({ key: 'src:commit' })).toBeUndefined()
      await has({ key: `src:commit:${hash(1)}` })
    } else {
      await has({ type: 'Text', text: /IMPLEMENT/ })
      await has({ type: 'Text', text: /●/ })
      await has({ type: 'Text', text: /[╲╱]/ })
    }
    await ui.press({ key: 'src:file:unstaged:edit file.ts' })
    expect((await has({ type: 'Code' })).props).toMatchObject({ format: 'diff', path: 'edit file.ts', source: HUNK, wrap: 'truncate-end' })
    await ui.press({ key: 'src:back' })
    await has({ key: 'src:changes' })
    await ui.press({ key: 'src:file:untracked:new.txt' })
    expect(String((await has({ type: 'Code' })).props.source)).toContain('+brand new')
    await has({ type: 'Text', text: '+1' })
    await ui.press({ key: 'src:back' })
    await ui.press({ key: 'src:file:staged:renamed file.ts' })
    expect(commands.some(a => a.includes('--cached') && a.includes('-M') && a.includes('old file.ts') && a.includes('renamed file.ts'))).toBe(true)
    await ui.press({ key: 'src:back' })
    await ui.press({ key: `src:commit:${hash(1)}` })
    await has({ key: 'src:files' })
    expect(await ui.find({ type: 'Text', text: /gpt-6.1-sol/ })).toBeUndefined()
    await has({ type: 'Text', text: /parents:/ })
    await ui.press({ key: 'src:cfile:edit file.ts' })
    expect((await has({ type: 'Code' })).props.source).toBe(HUNK)
    expect(await ui.find({ type: 'Text', text: /gpt-6.1-sol/ })).toBeUndefined()
    await ui.press({ key: 'src:back' })
    await has({ key: 'src:files' })
    await ui.press({ key: 'src:back' })
    await has({ key: 'src:changes' })
    stage = { ...stage, at: 'review', reached: ['plan', 'implement', 'review'], round: 2 }
    stageVersion++
    await ui.redraw()
    await has({ type: 'Text', text: '↺ round 2' })
    expect(await ui.find({ type: 'Text', text: `since ${hash(1).slice(0, 7)}` })).toBeUndefined()
    if (surface === 'desktop') expect(ticks).toBe(0)
    await ui.unmount()
  })

  test(`source handles missing repos, empty history, binary and failed diffs on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.id', () => ({ value: `source-errors-${surface}` }))
    let mode = 'missing', version = 0
    on('state.get', { plugin: 'agent-overview', key: 'git' }, () => ({ value: { value: { error: mode }, version } }))
    on('process.run', (_$, e) => ({ value: mode === 'missing' ? result('', 1)
      : e.argv.includes('--show-toplevel') ? result('/repo\n')
        : e.argv.includes('status') ? result(mode === 'empty' ? '' : ordinary('.M', 'binary.dat'))
          : e.argv.includes('log') || e.argv.includes('--numstat') ? result('')
            : mode === 'failed' ? result('', 1) : result('Binary files differ\n') }))
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
      title: 'Overview', isFocused: true, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {},
    } })
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(await ui.find({ key: 'work:plan' })).toBeDefined()
    await ui.press({ key: 'wtab:source' })
    expect(await ui.find({ key: 'work:source' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'not a git repository' })).toBeDefined()
    mode = 'empty'; version++
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: '✓ working tree clean' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'no commits yet' })).toBeDefined()
    expect(await ui.find({ key: 'src:commit' })).toBeUndefined()
    mode = 'binary'; version++
    await ui.redraw()
    await ui.press({ key: 'src:file:unstaged:binary.dat' })
    expect(await ui.find({ type: 'Text', text: 'no text changes to show (binary or mode change)' })).toBeDefined()
    mode = 'failed'; version++
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'could not read the diff' })).toBeDefined()
    await ui.unmount()
  })
}


test('slow source and diff requests share in-flight loads even after the cache TTL', async () => {
  let now = 100, calls = 0, release: () => void = () => {}
  let barrier = new Promise<void>(resolve => { release = resolve })
  const api = { session: { id: async () => 'slow-source-regression' }, clock: { now: async () => now },
    process: { run: async (argv: string[]) => { calls++; await barrier; return fixture(argv) } },
  } as unknown as EngineInterface
  const first = loadSource(api, 'slow')
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(calls).toBe(1)
  now = 5000
  const second = loadSource(api, 'slow')
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(calls).toBe(1)
  release()
  expect(await first).toEqual(await second); expect(calls).toBe(5)
  calls = 0; barrier = new Promise<void>(resolve => { release = resolve })
  const diff = fileDiff(api, '/repo', { path: 'slow.ts' }, 'slow')
  await Promise.resolve(); await Promise.resolve()
  now += 5000
  const again = fileDiff(api, '/repo', { path: 'slow.ts' }, 'slow')
  await Promise.resolve(); await Promise.resolve()
  expect(calls).toBe(1)
  release(); expect(await diff).toBe(await again)
})


test('history lane slices have compact 30px rows and a HEAD halo', () => {
  const graph = layout(parseLog(LOG).flatMap(x => x.commit ? [x.commit] : []))
  const svg = laneSvg(graph, 0, true)
  expect(svg).toContain('height="30"')
  expect(svg).toContain('cy="15"')
  expect(svg).toContain('head-halo')
  expect(svg).toContain(' C ')
})

test('desktop ref badges distinguish HEAD, branches, tags and dashed remotes, escaping labels', () => {
  expect(refSvg({ kind: 'head', name: 'main' }, '#10A37F')).toContain('fill="#D97757" fill-opacity="1"')
  expect(refSvg({ kind: 'branch', name: 'topic' }, '#10A37F')).toContain('stroke="#10A37F"')
  expect(refSvg({ kind: 'tag', name: 'v1' }, '#10A37F')).toContain('stroke="#F59E0B"')
  expect(refSvg({ kind: 'remote', name: 'origin/main' }, '#10A37F')).toContain('stroke-dasharray="3 2"')
  expect(refSvg({ kind: 'branch', name: '<script>&' }, '#10A37F')).not.toContain('<script>')
})
