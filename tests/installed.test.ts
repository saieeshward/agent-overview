import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { usageLines } from '../hooks/chat-surfaces'
import { NOT_INSTALLED, codex, locate, opencodeModels, opencodeUsage } from '../hooks/providers'
import { blank, defaultRouting, missingOf, routingText, without } from '../hooks/state'
import type { Providers } from '../types'

// A host whose disk holds exactly `files`: everything else is ENOENT.
function fixture(files: string[], dirs: Record<string, string[]> = {}) {
  const state = { providers: Object.fromEntries(['claude', 'codex', 'opencode', 'commandcode', 'antigravity'].map(p => [p, blank()])) as Providers, routing: defaultRouting() }
  const commands: { argv: string[]; env?: Record<string, string> }[] = []
  const invalidated: string[] = []
  let version = 0, now = 1_000_000
  const api = {
    env: { get: async (name: string) => name === 'HOME' ? '/home/test' : name === 'PATH' ? '/usr/bin:/bin' : undefined },
    clock: { now: async () => (now += 100000) },
    fs: {
      stat: async (path: string) => { if (!files.includes(path)) throw new Error(`ENOENT: no such file or directory, stat '${path}'`); return { kind: 'file', size: 1, mtimeMs: 0, isLink: false } },
      list: async (path: string) => (dirs[path] ?? []).map(name => ({ name, kind: 'dir' })),
      read: async () => { throw new Error('ENOENT: no such file or directory') },
    },
    tool: { list: async () => [] },
    process: { run: async (argv: string[], init?: { env?: Record<string, string> }) => { commands.push({ argv, env: init?.env }); return { exitCode: 0, stdout: '', stderr: '' } } },
    store: { get: async () => undefined, set: async () => {} },
    ui: { invalidate: (what: string) => { invalidated.push(what) } },
    state: {
      get: async ({ key }: { key: keyof typeof state }) => ({ value: state[key], version }),
      set: async ({ key }: { key: keyof typeof state }, value: unknown) => { Object.assign(state, { [key]: value }); return { isSet: true, version: ++version } },
    },
  } as unknown as EngineInterface
  return { api, state, commands, invalidated }
}

test('a CLI that is not on this machine marks its provider missing and runs nothing', async () => {
  const { api, state, commands, invalidated } = fixture([])
  expect(await locate(api, 'codex')).toBeUndefined()
  await codex(api)
  expect(state.providers.codex.status).toBe('missing')
  expect(state.providers.codex.error).toBe(NOT_INSTALLED)
  expect(commands).toEqual([])
  expect(invalidated).toContain('prompt.section')
})

test('a CLI installed outside the usual folder is found and run with its folder on PATH', async () => {
  const bin = '/home/test/.nvm/versions/node/v22.1.0/bin'
  const { api, state, commands } = fixture([`${bin}/opencode`], { '/home/test/.nvm/versions/node': ['v22.1.0'] })
  expect(await locate(api, 'opencode')).toBe(`${bin}/opencode`)
  await opencodeModels(api)
  const call = commands.find(c => c.argv[0] === `${bin}/opencode`)
  expect(call?.argv.slice(1)).toEqual(['models', 'opencode-go', '--verbose'])
  expect(call?.env?.PATH?.split(':')[0]).toBe(bin)
  await opencodeUsage(api)
  expect(state.providers.opencode.status).not.toBe('missing')
})

test('a host that cannot look at the disk is taken to have the usual install', async () => {
  const api = { env: { get: async () => '/home/test' }, clock: { now: async () => 1 }, fs: { list: async () => [] } } as unknown as EngineInterface
  expect(await locate(api, 'agy')).toBe('/home/test/.local/bin/agy')
})

test('routing leaves out providers that are not installed, and the saved choices stay', () => {
  const ps = Object.fromEntries(['claude', 'codex', 'opencode', 'commandcode', 'antigravity'].map(p => [p, { ...blank(), status: 'ok' }])) as Providers
  ps.codex = { ...blank(), status: 'missing' }
  ps.commandcode = { ...blank(), status: 'missing' }
  const saved = { ...defaultRouting(), on: { claude: true, codex: true, opencode: true, commandcode: true, antigravity: true, ollama: false }, tags: { codex: 'main' as const } }
  const gone = missingOf(ps)
  expect(gone.sort()).toEqual(['codex', 'commandcode'])
  const live = without(saved, gone)
  expect(live.on.codex).toBe(false)
  expect(live.on.opencode).toBe(true)
  expect(live.picks.some(x => x.provider === 'codex')).toBe(false)
  expect(live.tags?.codex).toBeUndefined()
  expect(saved.on.codex).toBe(true)
  expect(without(saved, [])).toBe(saved)
  const text = routingText(saved, {}, [], { missing: gone })
  expect(text).toContain('Not installed or not set up on this machine, never use: ')
  const told = text.split('\n').filter(l => !l.startsWith('Not installed') && !l.startsWith('Do not use Codex') && !l.startsWith('Delegation routing')).join('\n')
  expect(told).not.toContain('Codex')
  expect(told).not.toContain('Command Code')
  expect(told).toContain('OpenCode')
  expect(routingText(saved)).not.toContain('Not installed')
})

test('with no model picked, routing still offers Claude\'s own models and efforts', () => {
  const claudeModels = [{ id: 'claude-opus-5-5', efforts: ['low', 'medium', 'high'] }, { id: 'claude-fable-5-2', efforts: ['low', 'high', 'max'] }, { id: 'claude-haiku-5-5' }]
  const text = routingText(defaultRouting(), {}, [], { claudeModels })
  expect(text).toContain('smartest first: 1. claude-fable-5-2 (effort low/high/max), 2. claude-opus-5-5 (effort low/medium/high), 3. claude-haiku-5-5.')
  expect(routingText(defaultRouting())).not.toContain('no model picked')
  // The owner's own Claude picks, or Plans only, take its place.
  const picked = { ...defaultRouting(), picks: [{ provider: 'claude' as const, model: 'claude-sonnet-5-5', effort: 'high' }] }
  expect(routingText(picked, {}, [], { claudeModels })).not.toContain('no model picked')
  expect(routingText({ ...defaultRouting(), role: 'plan' }, {}, [], { claudeModels })).not.toContain('no model picked')
  expect(routingText({ ...defaultRouting(), role: 'claude' }, {}, [], { claudeModels })).toContain('no model picked')
})

test('/usage says a provider is not installed instead of "quota not reported"', () => {
  const ps = Object.fromEntries(['claude', 'codex', 'opencode', 'commandcode', 'antigravity'].map(p => [p, { ...blank(), status: 'ok' }])) as Providers
  ps.codex = { ...blank(), status: 'missing' }
  const lines = usageLines(ps, defaultRouting()).split('\n')
  expect(lines.find(l => l.startsWith('Codex:'))).toBe('Codex: not installed on this Mac')
  expect(lines.find(l => l.startsWith('OpenCode:'))).toContain('quota not reported')
})
