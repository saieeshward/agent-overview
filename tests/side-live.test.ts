import type { EngineInterface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Act, AgentNode, Providers, SideLive, Ui } from '../types'
import { watchKey } from '../hooks/graph'
import { opencodeUsage } from '../hooks/providers'
import { refreshSideLive } from '../hooks/register'
import { numstat, sideWindow } from '../hooks/stream'
import { blank } from '../hooks/state'

const side: AgentNode = { id: 'side:1', provider: 'codex', kind: 'Codex', label: 'Fix the parser', model: 'gpt', effort: 'high', state: 'running', steps: 0, startedAt: 10, input: 'codex exec fix', snap: { repo: '/repo', base: 'base', untracked: ['existing.txt'], ignored: ['ignored/'] } }

test('numstat preserves NUL paths, renames and binary files and skips incomplete records', async () => {
  expect(numstat('2\t1\trésumé\tspace\nfile.ts\0-\t-\timage.png\0' + '3\t4\t\0old\tname\0new\nname\0')).toEqual([
    { path: 'résumé\tspace\nfile.ts', added: 2, removed: 1, isNew: false },
    { path: 'image.png', added: 0, removed: 0, isNew: false },
    { path: 'new\nname', added: 3, removed: 4, isNew: false },
  ])
  expect(numstat('2\t1\tpartial')).toEqual([])
  expect(numstat('2\t1\t\0old\0')).toEqual([])
})

test('side windows keep context and line numbers for replacements, insertions and deletions', async () => {
  expect(sideWindow(['a', 'b', 'old', 'd'], ['a', 'b', 'new', 'd'])).toEqual({ startLine: 3, before: ['a', 'b'], old: ['old'], text: 'new', after: ['d'] })
  expect(sideWindow(['a', 'b'], ['a', 'new', 'b'])).toEqual({ startLine: 2, before: ['a'], old: [], text: 'new', after: ['b'] })
  expect(sideWindow(['a', 'old', 'b'], ['a', 'b'])).toEqual({ startLine: 2, before: ['a'], old: ['old'], text: '', after: ['b'] })
})

test('follow chooses Claude work, then the newest side run, including its Bash wrapper', async () => {
  const bash: Act = { key: 'main', tool: 'Bash', toolUseId: side.id, title: 'codex exec fix', state: 'running', at: 20 }
  const scout: Act = { key: 'scout', tool: 'Read', title: 'file', state: 'running', at: 15 }
  const newer = { ...side, id: 'side:2', startedAt: 30 }
  expect(watchKey({ main: bash }, [side, newer])).toBe('node:side:2')
  expect(watchKey({ main: bash, scout }, [side, newer], 'follow')).toBe('scout')
  expect(watchKey({ main: bash }, [side], 'main')).toBe('main')
  expect(watchKey({}, [side], 'node:side:1')).toBe('node:side:1')
  expect(watchKey({ main: { ...bash, state: 'done' } }, [{ ...side, state: 'done' }])).toBe('main')
})

function pollState() {
  const state = { nodes: [{ ...side }], ui: { watch: 'node:side:1' }, guard: { follow: true }, acts: {} as Record<string, Act>, sideLive: null as SideLive | null }
  const poll = { diff: '1\t1\ttracked.ts\0' + '4\t0\texisting.txt\0', others: 'existing.txt\0ignored/file\0new.txt\0', now: 100, calls: 0, writes: 0, truncated: false, exitCode: 0, text: 'a\nnew\nb\n' }
  let version = 0
  const api = {
    process: { run: async (argv: string[]) => {
      poll.calls++
      const stdout = argv.includes('diff') ? poll.diff : argv.includes('ls-files') ? poll.others : argv.includes('show') ? 'a\nold\nb\n' : ''
      return { stdout, exitCode: poll.exitCode, isStdoutTruncated: poll.truncated }
    } },
    fs: {
      read: async (path: string) => path.endsWith('new.txt') ? 'fresh\nfile\n' : poll.text,
      stat: async (path: string) => ({ mtimeMs: path.endsWith('new.txt') ? 50 : 100 }),
      exists: async () => true,
    },
    clock: { now: async () => poll.now },
    state: {
      get: async ({ key }: { key: keyof typeof state }) => ({ value: state[key], version }),
      set: async ({ key }: { key: keyof typeof state }, value: unknown) => {
        if (key === 'sideLive') poll.writes++
        Object.assign(state, { [key]: value })
        return { isSet: true, version: ++version }
      },
    },
  } as unknown as EngineInterface
  return { state, poll, api }
}

test('live polling sorts files, excludes the baseline, keeps an Edit window and skips unchanged state', async () => {
  const { state, poll, api } = pollState()
  await refreshSideLive(api)
  expect(state.sideLive).toEqual({ id: side.id, at: 100, files: [
    { path: 'tracked.ts', added: 1, removed: 1, isNew: false },
    { path: 'new.txt', added: 2, removed: 0, isNew: true },
  ], file: 'tracked.ts', startLine: 2, before: ['a'], old: ['old'], text: 'new', after: ['b'] })
  poll.now++
  await refreshSideLive(api)
  expect(poll.writes).toBe(1)
  poll.text = 'a\nchanged\nb\n'
  await refreshSideLive(api)
  expect(state.sideLive?.text).toBe('changed')
  expect(poll.writes).toBe(2)
  for (const failure of [{ truncated: true }, { exitCode: 1 }]) {
    Object.assign(poll, failure)
    poll.text = 'a\nunreadable\nb\n'
    await refreshSideLive(api)
    expect(state.sideLive?.text).toBe('changed')
    Object.assign(poll, { truncated: false, exitCode: 0 })
  }
  poll.diff = ''
  poll.others = ''
  await refreshSideLive(api)
  expect(state.sideLive?.files).toEqual([])
  state.nodes[0]!.state = 'done'
  const calls = poll.calls
  await refreshSideLive(api)
  expect(state.sideLive).toBeNull()
  expect(poll.calls).toBe(calls)
})

test('live polling does no Git work without a watch or snapshot', async () => {
  const { state, poll, api } = pollState()
  state.ui.watch = 'main'
  await refreshSideLive(api)
  expect(poll.calls).toBe(0)
  state.ui.watch = 'node:side:1'
  state.nodes[0]!.snap = undefined
  await refreshSideLive(api)
  expect(poll.calls).toBe(0)
  expect(poll.writes).toBe(0)
})

test('a foreground run keeps its snapshot before the tool runs', async ($, on) => {
  mock.clock(on)
  let nodes: AgentNode[] = []
  on('state.set', { plugin: 'agent-overview', key: 'nodes' }, (_$, e, next) => { nodes = e.value; return next(e) })
  on('process.run', (_$, e) => {
    const a = e.argv
    const stdout = a.includes('--show-toplevel') ? '/repo\n' : a.includes('stash') ? 'base\n' : a.includes('--numstat') ? '1\t1\tfile.ts\0' : a.includes('show') ? 'old\n' : ''
    return { value: { stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', () => ({ value: 'new\n' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 4, mtimeMs: 1, isLink: false } }))
  on('tool.call', () => {
    expect(nodes[0]?.snap).toEqual({ repo: '/repo', base: 'base', untracked: [], ignored: [] })
    return { result: 'finished' }
  })
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'foreground', command: 'opencode run fix' })
  expect(nodes[0]?.state).toBe('done')
})

test('foreground side runs keep command or redirected prompts, with a command fallback', async ($, on) => {
  mock.clock(on)
  let nodes: AgentNode[] = []
  let expected = ''
  let unreadable = false
  const prompt = '# Task: Fix the parser\n' + 'x'.repeat(25000)
  on('state.set', { plugin: 'agent-overview', key: 'nodes' }, (_$, e, next) => { nodes = e.value; return next(e) })
  on('process.run', (_$, e) => {
    expect(e.argv[0]).toBe('git')
    return { value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: prompt.length, mtimeMs: 1, isLink: false } }))
  on('fs.read', (_$, e) => {
    expect(e.path).toBe('/repo/prompt file.md')
    if (unreadable) throw new Error('unreadable')
    return { value: prompt }
  })
  on('tool.call', () => {
    expect(nodes[nodes.length - 1]?.input).toBe(expected)
    return { result: 'finished' }
  })
  const commands = [
    ['codex exec -m gpt "Fix the parser"', 'Fix the parser'],
    ['cd /repo && codex exec - < "prompt file.md"', prompt.slice(0, 20000)],
    ['cd /repo && opencode run < "prompt file.md"', prompt.slice(0, 20000)],
    ['cd /repo && codex exec --cd /elsewhere - < "prompt file.md"', prompt.slice(0, 20000)],
  ]
  for (const [command, input] of commands) {
    expected = input!
    await ($.tool as any).call({ tool: 'Bash', tool_use_id: `prompt-${nodes.length}`, command })
  }
  unreadable = true
  const command = 'codex exec - < /repo/"prompt file.md"'
  expected = command
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'unreadable', command })
})

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }

test('picking a side-run box makes follow show its live changes, then its output', async ($, on) => {
  mock.clock(on, { now: 100 })
  const node = { ...side }
  let watch = 'main'
  let sel: string | undefined
  let preview: SideLive | null = null
  on('state.get', { plugin: 'agent-overview', key: 'nodes' }, () => ({ value: { value: [node], version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'sideLive' }, () => ({ value: { value: preview, version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'ui' }, async (_$, e, next) => {
    const result = await next(e)
    return { value: { ...result.value!, value: { ...(result.value!.value as Ui), watch, sel } } }
  })
  on('state.set', { plugin: 'agent-overview', key: 'ui' }, async (_$, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) {
      watch = e.value.watch!
      sel = e.value.sel
    }
    return result
  })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  // Only two chips: follow and main.
  expect(await ui.find({ key: 'watch:node:side:1' })).toBeUndefined()
  expect(await ui.find({ key: 'watch:main' })).toBeDefined()
  await ui.press({ key: 'gopen:side:1' })
  expect([watch, sel]).toEqual(['follow', 'node:side:1'])
  expect(await ui.find({ key: 'detail:back' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /no file changes/ }), 'empty live card').toBeDefined()
  expect((await ui.find({ key: 'gbox:side:1' }))?.props.borderStyle).toBe('bold')
  preview = { id: side.id, at: 100, files: [{ path: 'new.txt', added: 1, removed: 1, isNew: true }], file: 'new.txt', startLine: 2, before: ['head'], old: ['old'], text: 'new', after: ['tail'] }
  await ui.redraw()
  await ui.press({ key: 'watch:follow' })
  expect(await ui.find({ type: 'Text', text: 'changed so far: 1 file' }), 'file count').toBeDefined()
  expect(await ui.find({ type: 'Text', text: /new.txt new/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /− old/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+ new/ })).toBeDefined()
  node.snap = undefined
  await ui.redraw()
  await ui.press({ key: 'watch:follow' })
  expect(await ui.find({ type: 'Text', text: 'codex exec fix' })).toBeDefined()
  node.state = 'done'
  node.output = 'run complete'
  await ui.press({ key: 'watch:main' })
  await ui.press({ key: 'watch:follow' })
  expect(sel).toBe('node:side:1')
  expect(await ui.find({ type: 'Text', text: 'run complete' })).toBeDefined()
  // Pressing the picked box again lets follow go back to the newest activity.
  await ui.press({ key: 'gopen:side:1' })
  expect(sel).toBeUndefined()
  await ui.unmount()
})

test('OpenCode meters, chart and Models rows say their figures are estimates', async ($, on) => {
  mock.clock(on)
  let all: Providers = { claude: blank(), codex: blank(), opencode: blank(), commandcode: blank(), antigravity: blank() }
  const saved: Record<string, unknown> = {}
  const api = {
    env: { get: async (name: string) => name === 'HOME' ? '/fake' : undefined },
    session: { id: async () => 'estimate' },
    store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { saved[key] = value } },
    fs: { read: async () => '{}' },
    clock: { now: async () => 100 },
    process: { run: async (argv: string[]) => ({ stdout: argv[argv.length - 1]!.includes('from message') ? '[{"w18000":6,"w604800":15,"w2592000":30}]' : '[]', stderr: '', exitCode: 0 }) },
    state: {
      get: async () => ({ value: all, version: 1 }),
      set: async (_ref: unknown, value: Providers) => { all = value; return { isSet: true, version: 2 } },
    },
  } as unknown as EngineInterface
  await opencodeUsage(api)
  expect(all.opencode.note).toBe('estimates · this Mac only · opencode.ai shows the exact figures')
  expect(all.opencode.meters[0]?.detail).toBe('≈ $6.00 of $12 · this Mac only')
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: all, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  expect(await ui.find({ type: 'Text', text: /≈50%/ })).toBeDefined()
  await ui.press({ key: 'tab:models' })
  expect(await ui.find({ type: 'Text', text: /≈50%/ })).toBeDefined()
  await ui.unmount()
})

for (const provider of ['codex', 'opencode', 'commandcode'] as const) for (const background of [false, true]) test(`wrapped ${provider} ${background ? '&' : 'foreground'} keeps its snapshot and tracks live files`, async ($, on) => {
  mock.clock(on, { now: 10000 }); mock.store(on); mock.env(on, { HOME: '/home/test' })
  let nodes: AgentNode[] = []
  on('state.set', { plugin: 'agent-overview', key: 'nodes' }, (_$, e, next) => { nodes = e.value; return next(e) })
  on('ui.invalidate', () => ({ value: undefined }))
  const cli = provider === 'codex' ? 'codex exec "fix"' : provider === 'opencode' ? 'opencode run "fix"' : 'cmd -p "fix"'
  on('process.run', (_$, e) => {
    const a = e.argv
    if (a.includes('--show-toplevel')) { expect(e.init?.cwd).toBe('/repo'); return { value: { stdout: '/repo\n', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } } }
    const stdout = a.includes('-E') ? `42 00:00 ${cli} AO_RUN=wrapped\n` : a[0] === '/bin/sh' ? '100\n' : a[2] === 'pid=,ppid=' ? '42 1\n' : a[0] === '/bin/ps' ? `42 00:00 ${cli}\n` : a.includes('stash') ? 'base\n' : a.includes('--numstat') ? '1\t1\tfile.ts\0' : a.includes('show') ? 'old\n' : ''
    return { value: { stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', () => ({ value: 'new\n' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 4, mtimeMs: 1, isLink: false } }))
  on('tool.call', async () => {
    expect(nodes[0]?.snap).toEqual({ repo: '/repo', base: 'base', untracked: [], ignored: [] })
    const polled = pollState()
    polled.state.nodes = nodes
    polled.state.ui.watch = 'node:wrapped'
    await refreshSideLive(polled.api)
    expect(polled.state.sideLive?.file).toBe('tracked.ts')
    return { result: 'shell returned' }
  })
  const command = `nohup timeout 90 env X=yes sh -c 'cd /repo && ${cli}' > log 2>&1${background ? ' &' : ''}`
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'wrapped', command })
  expect(nodes[0]?.dir).toBe('/repo')
  expect(nodes[0]?.startedAt).toBe(10000)
  expect(nodes[0]?.state).toBe(background ? 'running' : 'done')
})

for (const surface of ['terminal', 'desktop'] as const) test(`stale Command Code percentages show their age in Usage, Models and both Vibe HUDs (${surface})`, async ($, on) => {
  mock.clock(on, { now: 3 * 3600000 }); mock.store(on)
  on('session.id', () => ({ value: 'stale-usage' }))
  const all: Providers = { claude: blank(), codex: blank(), opencode: blank(), antigravity: blank(), commandcode: { ...blank(), status: 'ok', usageAt: 0, meters: [{ label: 'Monthly', percent: 62 }] } }
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: all, version: 0 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props })
  {
    const chart = await ui.find({ type: 'Svg' })
    const text = chart ? String(chart.props.alt) : (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
    expect(text).toContain('38% left')
    expect(text).toContain('3h old')
  }
  await ui.press({ key: 'tab:models' })
  const meter = (await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('Command Code '))
  const quota = meter ? String(meter.props.alt) : (await ui.find({ key: 'pcol:usage:commandcode' }))?.text ?? ''
  expect(quota).toContain('38%')
  expect(quota).toContain('3h old')
  await ui.press({ key: 'open:commandcode' })
  {
    const chart = await ui.find({ type: 'Svg' })
    const text = chart ? String(chart.props.alt) : (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
    expect(text).toContain('38% left')
    expect(text).toContain('3h old')
  }
  await ui.press({ key: 'area:vibe' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
  expect(await ui.find({ type: 'Text', text: /38% left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /usage 3h old/ })).toBeDefined()
  await ui.press({ key: 'vibe:style' })
  expect(await ui.find({ type: 'Text', text: /38% left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /usage 3h old/ })).toBeDefined()
  await ui.unmount()
})
