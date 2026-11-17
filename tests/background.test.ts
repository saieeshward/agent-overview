import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { AgentNode, EditItem, History, ModelSpeeds, SideLive } from '../types'
import { refreshSideRuns } from '../hooks/register'
import { defaultRouting, normalGuard } from '../hooks/state'
import { CODEX_FILE, CODEX_OUTPUT, CODEX_ROLLOUT } from './speed-fixtures'

function backgroundState(initial: AgentNode[] = []) {
  const state = { nodes: initial, history: { since: 1, items: [] } as History, routing: defaultRouting(), sideLive: null as SideLive | null, guard: normalGuard({ review: true }), edits: [] as EditItem[] }
  const saved: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  let version = 0
  const poll = { text: '', exitCode: 0, truncated: false, throws: false, calls: 0, writes: 0, snapshots: 0, now: 200000, stdoutFile: '', output: '', stdin: '', task: '', kind: 'file', unreadable: false, reads: 0, lsof: 0, engine: '', tree: '', changed: false, envText: '', envExitCode: 0, envTruncated: false }
  const api = {
    process: { run: async (argv: string[]) => {
      if (argv[0] === 'git') {
        if (argv.includes('--show-toplevel')) { poll.snapshots++; return { stdout: '/repo\n', exitCode: 0 } }
        if (poll.changed && argv.includes('--name-only')) return { stdout: 'changed.ts\0', exitCode: 0 }
        if (argv.includes('show')) return { stdout: 'old\n', exitCode: 0 }
        return { stdout: argv.includes('stash') ? 'base\n' : '', exitCode: 0 }
      }
      if (argv[0] === '/usr/sbin/lsof') {
        if (argv.includes('1,2')) return { stdout: poll.stdoutFile, exitCode: 0 }
        expect(argv.slice(1)).toEqual(['-a', '-p', '42', '-d', '0', '-Fn'])
        poll.lsof++
        return { stdout: poll.stdin, exitCode: 0 }
      }
      if (argv[0] === '/bin/sh') return { stdout: poll.engine, exitCode: 0 }
      if (argv[2] === 'pid=,ppid=') return { stdout: poll.tree, exitCode: 0 }
      if (argv.includes('-E')) {
        expect(argv).toEqual(['/bin/ps', '-E', '-ww', '-axo', 'pid=,etime=,command='])
        return { stdout: poll.envText, exitCode: poll.envExitCode, isStdoutTruncated: poll.envTruncated }
      }
      expect(argv).toEqual(['/bin/ps', '-axo', 'pid=,etime=,command='])
      poll.calls++
      if (poll.throws) throw new Error('ps unavailable')
      return { stdout: poll.text, exitCode: poll.exitCode, isStdoutTruncated: poll.truncated }
    } },
    fs: {
      list: async (dir: string) => Object.keys(files).filter(path => path.slice(0, path.lastIndexOf('/')) === dir).map(path => ({ name: path.split('/').pop()!, kind: 'file' })),
      exists: async () => true,
      stat: async () => ({ kind: poll.kind }),
      read: async (path: string) => {
        if (path in files) return files[path]
        if (path === '/repo/output.log') return poll.output
        if (path === '/repo/changed.ts') return 'new\n'
        expect(path).toBe('/repo/prompt.md')
        poll.reads++
        if (poll.unreadable) throw new Error('unreadable')
        return poll.task
      },
    },
    clock: { now: async () => poll.now },
    env: { get: async (name: string) => name === 'CODEX_HOME' ? '/background-test/.codex' : '/background-test' },
    session: { id: async () => 'chat' },
    ui: { toast: () => {}, invalidate: () => {} },
    store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { saved[key] = value } },
    state: {
      get: async ({ key }: { key: keyof typeof state }) => ({ value: state[key], version }),
      set: async ({ key }: { key: keyof typeof state }, value: unknown) => {
        if (key === 'nodes') poll.writes++
        Object.assign(state, { [key]: value })
        return { isSet: true, version: ++version }
      },
    },
  } as unknown as EngineInterface
  return { state, saved, poll, api, files }
}

test('background prompts mentioning vendor directories stay visible without double counting native Codex', async () => {
  const { state, poll, api } = backgroundState()
  poll.text = [
    '201 00:01 opencode run -m opencode-go/m "review src/vendor/three"',
    '202 00:02 node /opt/homebrew/bin/codex exec -m gpt "see src/vendor/x"',
    '203 00:03 node /Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs -p "review src/vendor/three" --model m',
    '204 00:04 /opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex exec task',
  ].join('\n')
  await refreshSideRuns(api)
  expect(state.nodes.map(n => [n.id, n.provider, n.input])).toEqual([
    ['bg:201', 'opencode', 'review src/vendor/three'], ['bg:202', 'codex', 'see src/vendor/x'], ['bg:203', 'commandcode', 'review src/vendor/three'],
  ])
})

test('polling attaches foreground pids, adds background runs once and remembers their end once', async () => {
  const foreground: AgentNode = { id: 'tool:1', provider: 'codex', kind: 'Codex', label: 'Fix it', model: 'gpt', state: 'running', steps: 0 }
  const { state, poll, api } = backgroundState([foreground])
  state.routing.models.codex = ['fallback']
  poll.text = '11 00:10 codex exec -m gpt task\n12 00:05 codex e --cd /repo/background/ task\n13 00:02 opencode run -m opencode-go/m --variant high task'
  await refreshSideRuns(api)
  expect(state.nodes.length).toBe(3)
  expect(state.nodes[0]).toMatchObject({ id: 'tool:1', pid: 11, state: 'running' })
  expect(state.nodes[1]).toMatchObject({ id: 'bg:12', pid: 12, provider: 'codex', model: 'fallback', label: 'task', dir: '/repo/background/', state: 'running', startedAt: 195000, run: 'turn' })
  expect(state.nodes[2]).toMatchObject({ id: 'bg:13', provider: 'opencode', model: 'opencode-go/m', effort: 'high', startedAt: 198000 })
  expect(state.nodes[1]?.snap).toEqual({ repo: '/repo', base: 'base', untracked: [], ignored: [] })
  expect(state.nodes[1]?.input).toBe('task')
  expect(poll.lsof).toBe(0)
  expect(poll.snapshots).toBe(2)
  await refreshSideRuns(api)
  expect(poll.writes).toBe(1)
  expect(poll.calls).toBe(2)
  expect(poll.snapshots).toBe(2)
  poll.now += 5000
  poll.text = '11 00:15 codex exec -m gpt task\n13 00:07 opencode run -m opencode-go/m task'
  await refreshSideRuns(api)
  expect(state.nodes[1]).toMatchObject({ state: 'done', endedAt: 205000 })
  expect(state.history.items).toEqual([{ at: 195000, label: 'task', model: 'fallback', provider: 'codex', state: 'done', ms: 10000, session: 'chat' }])
  await refreshSideRuns(api)
  expect(poll.writes).toBe(2)
  expect(state.history.items.length).toBe(1)
})

test('background stdin labels use regular files and retain at most 20000 prompt characters', async () => {
  const { state, poll, api } = backgroundState()
  poll.text = '42 00:10 codex exec -m gpt -'
  poll.stdin = 'p42\nf0\nn/repo/prompt.md\n'
  poll.task = `# Context\n${'x'.repeat(21000)}\n# Task: Fix stdin labels\nDetails`
  await refreshSideRuns(api)
  expect(state.nodes[0]?.label).toBe('Fix stdin labels')
  expect(state.nodes[0]?.input).toBe(poll.task.slice(0, 20000))
  await refreshSideRuns(api)
  expect(poll.reads).toBe(1)
})

test('unavailable stdin falls back without reading pipes, devices or directories', async () => {
  for (const failure of [{ stdin: 'npipe\n' }, { stdin: 'n/dev/null\n', kind: 'other' }, { stdin: 'n/repo/prompt.md\n', kind: 'dir' }, { stdin: 'n/repo/prompt.md\n', unreadable: true }]) {
    const { state, poll, api } = backgroundState()
    poll.text = '42 00:10 codex exec -m gpt'
    Object.assign(poll, failure)
    await refreshSideRuns(api)
    expect(state.nodes[0]?.label).toBe('Codex run')
    expect(state.nodes[0]?.input).toBeUndefined()
    expect(poll.reads).toBe(poll.unreadable ? 1 : 0)
  }
})

test('a restored background node settles only after a complete successful process listing', async () => {
  const { state, saved, poll, api } = backgroundState([{ id: 'bg:42', pid: 42, provider: 'codex', kind: 'Codex', label: 'Restored', model: 'gpt', state: 'running', steps: 0, startedAt: 10000 }])
  poll.now = 30000
  poll.text = '42 00:20 codex exec task'
  await refreshSideRuns(api)
  poll.text = ''
  for (const failure of [{ throws: true }, { exitCode: 1 }, { truncated: true }]) {
    Object.assign(poll, failure)
    await refreshSideRuns(api)
    expect(state.nodes[0]?.state).toBe('running')
    expect(poll.writes).toBe(0)
    Object.assign(poll, { throws: false, exitCode: 0, truncated: false })
  }
  await refreshSideRuns(api)
  expect(state.nodes[0]).toMatchObject({ state: 'done', endedAt: 30000 })
  expect(state.history.items.length).toBe(1)
  expect(saved.history).toEqual(state.history.items)
})

test('finished background changes reach Activity and append to the latest shared history', async () => {
  const { api, poll, state, saved } = backgroundState()
  poll.text = '42 00:10 codex exec Fix the files'
  await refreshSideRuns(api)
  expect(state.nodes[0]?.label).toBe('Fix the files')
  saved.history = [{ at: 1, model: 'other', label: 'Another chat', state: 'done', ms: 10 }]
  poll.changed = true
  poll.text = ''
  await refreshSideRuns(api)
  expect(state.edits[0]).toMatchObject({ file: '/repo/changed.ts', provider: 'codex', review: 'pending', before: ['old'], after: ['new'] })
  expect(state.history.items.map(h => h.label)).toEqual(['Another chat', 'Fix the files'])
  await refreshSideRuns(api)
  expect(state.edits.length).toBe(1)
  expect(state.history.items.length).toBe(2)
})

// Kept last: the engine pid is found once per module load.
test("another chat's side runs on this machine are left out", async () => {
  const { state, poll, api } = backgroundState()
  poll.text = '21 00:10 codex exec -m gpt mine\n31 00:10 codex exec -m gpt theirs'
  poll.engine = '100\n'
  poll.tree = '100 1\n20 100\n21 20\n30 200\n31 30\n'
  await refreshSideRuns(api)
  expect(state.nodes.map(n => n.pid)).toEqual([21])
})

test('detached launches use exact environment tokens despite late polls and lossy ps prompts', async () => {
  const launch: AgentNode = { id: 'tool:detached', detached: true, dir: '/repo', provider: 'codex', kind: 'Codex', label: 'Detached', model: 'gpt', state: 'running', steps: 0, startedAt: 1000, snap: { repo: '/repo', base: 'base', untracked: [], ignored: [] } }
  const { api, poll, state } = backgroundState([launch])
  poll.engine = '100\n'; poll.tree = '41 1\n42 1\n43 1\n'
  for (const prompt of ['fix; the (file)', 'M-bM-^@M-^T unicode\\012next line', '$(cat f)', '$P'.repeat(10000)]) {
    poll.text = `41 00:20 codex exec -m gpt ${prompt}\n42 00:05 codex exec -m gpt ${prompt}\n43 00:05 codex exec -m gpt ${prompt}`
    poll.envText = `${poll.text.split('\n')[0]} AO_RUN=tool:detached-extra\n${poll.text.split('\n')[1]} AO_RUN=tool:detached\n${poll.text.split('\n')[2]} OTHER=AO_RUN=tool:detached`
    await refreshSideRuns(api)
    expect(state.nodes).toHaveLength(1)
    expect(state.nodes[0]).toMatchObject({ id: launch.id, pid: 42, state: 'running', dir: '/repo', snap: launch.snap })
    poll.now += 60000
  }
  expect(poll.snapshots).toBe(0)
  poll.text = ''; poll.envText = ''; poll.changed = true
  await Promise.all([refreshSideRuns(api), refreshSideRuns(api)])
  expect(state.nodes[0]?.state).toBe('done')
  expect(state.edits).toHaveLength(1)
  expect(state.history.items).toHaveLength(1)
  await refreshSideRuns(api)
  expect(state.edits).toHaveLength(1)
  expect(state.history.items).toHaveLength(1)
})

test('engine descendants claim by provider even when prompts, start times and quoting differ', async () => {
  const launch: AgentNode = { id: 'tool:foreground', provider: 'codex', kind: 'Codex', label: 'Foreground', model: 'gpt', state: 'running', steps: 0, startedAt: 1000 }
  const { api, poll, state } = backgroundState([launch])
  poll.engine = '100\n'; poll.tree = '42 100\n'
  poll.text = '42 00:01 codex exec -m gpt changed; (prompt) M-b\\012$(cat f)'
  await refreshSideRuns(api)
  expect(state.nodes).toHaveLength(1)
  expect(state.nodes[0]).toMatchObject({ id: launch.id, pid: 42, state: 'running' })
  state.nodes[0]!.state = 'done'
  await refreshSideRuns(api)
  expect(state.nodes).toHaveLength(1)
})

test('unbound detached nodes survive unavailable environment listings and claim on a later poll', async () => {
  const launch: AgentNode = { id: 'tool:late', detached: true, provider: 'opencode', kind: 'OpenCode', label: 'Late', model: 'm', state: 'running', steps: 0, startedAt: 1 }
  const { api, poll, state } = backgroundState([launch])
  poll.text = '42 00:01 opencode run prompt'
  poll.tree = '42 1\n'; poll.envText = `${poll.text} AO_RUN=tool:late`
  for (const failure of [{ envExitCode: 1 }, { envTruncated: true }]) {
    Object.assign(poll, failure)
    await refreshSideRuns(api)
    expect(state.nodes).toHaveLength(1)
    expect(state.nodes[0]?.state).toBe('running')
    Object.assign(poll, { envExitCode: 0, envTruncated: false })
  }
  await refreshSideRuns(api)
  expect(state.nodes[0]?.pid).toBe(42)
})


test('background speed reads the run output file once when its node ends', async () => {
  const { state, saved, poll, api, files } = backgroundState()
  poll.text = '42 00:05 codex exec -m gpt-6.1-sol task'
  poll.engine = '100\n'; poll.tree = '42 100\n'
  poll.stdoutFile = 'p42\nf1\nn/repo/output.log\n'
  await refreshSideRuns(api)
  expect(state.nodes[0]?.outputFile).toBe('/repo/output.log')
  poll.text = ''
  poll.now += 5000
  poll.output = CODEX_OUTPUT
  files[`/background-test/.codex/sessions/1970/01/01/${CODEX_FILE}`] = CODEX_ROLLOUT
  await refreshSideRuns(api)
  expect((saved.modelSpeeds2 as ModelSpeeds)['gpt-6.1-sol']).toEqual([{ outputTokens: 1400, milliseconds: 10000 }])
  await refreshSideRuns(api)
  expect((saved.modelSpeeds2 as ModelSpeeds)['gpt-6.1-sol']).toHaveLength(1)
})
