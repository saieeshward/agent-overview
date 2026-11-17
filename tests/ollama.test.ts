import type { EngineInterface, HttpInit, HttpResponse } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { babysitting } from '../hooks/babysitter'
import { usageLines } from '../hooks/chat-surfaces'
import { spendBy } from '../hooks/cost'
import { externalOf, taskOf, usageTail } from '../hooks/graph'
import { OLLAMA_DOWN, OLLAMA_URL, ollamaBody, ollamaCheck, ollamaGenerate, parseOllamaList } from '../hooks/providers'
import { ollamaPick } from '../hooks/register'
import { BUILT_IN, OLLAMA_JOBS, PROVIDERS, allOf, blank, defaultRouting, handoffText, lead, normalGuard, normalRouting, offlineOf, providerOf, routingText, subagentRoute, withPicks } from '../hooks/state'
import type { Providers, Routing } from '../types'

const BIN = '/usr/local/bin/ollama'
const LIST = [
  'NAME                      ID              SIZE      MODIFIED',
  'qwen2.5:7b                845dbda0ea48    4.7 GB    6 days ago',
  'llama3.2:3b               a80c4f17acd5    2.0 GB    2 weeks ago',
  'nomic-embed-text:latest   0a109f422b47    274 MB    3 weeks ago',
].join('\n')
const response = (body: unknown, status = 200): HttpResponse => ({ ok: status >= 200 && status < 300, status, headers: {}, text: JSON.stringify(body) })
let serial = 0
const everyone = () => Object.fromEntries(PROVIDERS.map(p => [p.id, blank()])) as Providers

// A host whose disk holds exactly `files`; `ollama list` answers `list`, or fails when it is null (the server is down).
function fixture(files: string[], list: string | null = LIST) {
  const state: Record<string, any> = { providers: everyone(), routing: defaultRouting(), modelSpeeds: {} }
  const saved: Record<string, unknown> = {}
  const commands: string[][] = []
  const requests: { url: string; init?: HttpInit }[] = []
  const invalidated: string[] = []
  // Each host has its own time: the CLI finder remembers a miss for a minute.
  let version = 0, now = 1_000_000 + ++serial * 1e9, reply = (_body: any): HttpResponse => response({})
  const api = {
    env: { get: async (name: string) => name === 'HOME' ? '/home/test' : name === 'PATH' ? '/usr/bin:/bin' : undefined },
    clock: { now: async () => (now += 100000), after: () => ({ cancel: () => {} }) },
    fs: {
      stat: async (path: string) => { if (!files.includes(path)) throw new Error(`ENOENT: no such file or directory, stat '${path}'`); return { kind: 'file', size: 1, mtimeMs: 0, isLink: false } },
      list: async () => [],
      read: async () => { throw new Error('ENOENT: no such file or directory') },
    },
    tool: { list: async () => [] },
    process: { run: async (argv: string[]) => { commands.push(argv); return list === null ? { exitCode: 1, stdout: '', stderr: 'Error: could not connect to ollama server' } : { exitCode: 0, stdout: list, stderr: '' } } },
    http: { fetch: async (url: string, init?: HttpInit) => { requests.push({ url, init }); return reply(JSON.parse(String(init?.body ?? '{}'))) } },
    store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { saved[key] = value } },
    ui: { invalidate: (what: string) => { invalidated.push(what) } },
    state: {
      get: async ({ key }: { key: string }) => ({ value: state[key], version }),
      set: async ({ key }: { key: string }, value: unknown) => { state[key] = value; return { isSet: true, version: ++version } },
    },
  } as unknown as EngineInterface
  return { api, state, saved, commands, requests, invalidated, answer: (fn: (body: any) => HttpResponse) => { reply = fn } }
}

const on = (r: Routing, models: string[] = []): Routing => withPicks({ ...r, on: { ...r.on, ollama: true } }, [...r.picks, ...models.map(model => ({ provider: 'ollama' as const, model }))])

test('detection: no CLI marks Ollama missing and runs nothing', async () => {
  const f = fixture([])
  await ollamaCheck(f.api)
  expect(f.state.providers.ollama.status).toBe('missing')
  expect(f.commands).toEqual([])
  expect(f.requests).toEqual([])
})

test('detection: a CLI whose server answers lists its chat models and never its embedding models', async () => {
  const f = fixture([BIN])
  await ollamaCheck(f.api)
  const info = f.state.providers.ollama
  expect(f.commands).toEqual([[BIN, 'list']])
  expect(info.status).toBe('ok')
  expect(info.offline).toBeUndefined()
  expect(info.models.map((m: { id: string }) => m.id)).toEqual(['qwen2.5:7b', 'llama3.2:3b'])
  expect(info.models[0].info).toContain('4.7 GB')
  expect(info.facts).toContain('1 embedding model not offered for tasks')
  expect(info.facts).toContain('free · no quota')
  expect(offlineOf(f.state.providers)).toEqual([])
  expect(f.invalidated).toContain('prompt.section')
})

test('detection: an installed CLI whose server is down is present but offline, and keeps its last models', async () => {
  const f = fixture([BIN], null)
  f.state.providers.ollama = { ...blank(), status: 'ok', models: [{ id: 'qwen2.5:7b' }] }
  await ollamaCheck(f.api)
  const info = f.state.providers.ollama
  expect(info.status).toBe('ok')
  expect(info.offline).toBe(OLLAMA_DOWN)
  expect(info.note).toContain('open the Ollama app')
  expect(info.models.map((m: { id: string }) => m.id)).toEqual(['qwen2.5:7b'])
  expect(offlineOf(f.state.providers)).toEqual(['ollama'])
  expect(f.invalidated).toContain('prompt.section')
})

test('the model list parser reads names and sizes and drops embedders, whatever is installed', () => {
  expect(parseOllamaList(LIST)).toEqual({ models: [{ id: 'qwen2.5:7b', info: '4.7 GB · free · local' }, { id: 'llama3.2:3b', info: '2.0 GB · free · local' }], embedders: 1 })
  expect(parseOllamaList('NAME    ID    SIZE    MODIFIED\n')).toEqual({ models: [], embedders: 0 })
  expect(providerOf('qwen2.5:7b')).toBe('ollama')
  expect(providerOf('opencode-go/qwen3-coder')).toBe('opencode')
})

test('Ollama is off by default, and Cheap ranks it first while Max quality ranks it last', () => {
  const r = defaultRouting()
  expect(r.on.ollama).toBe(false)
  expect(r.order.at(-1)).toBe('ollama')
  expect(normalRouting({ on: { codex: true } }).on.ollama).toBe(false)
  const both = withPicks(r, [{ provider: 'codex', model: 'gpt' }, { provider: 'ollama', model: 'qwen2.5:7b' }])
  expect(BUILT_IN.find(p => p.name === 'Cheap')!.apply(both).order[0]).toBe('ollama')
  expect(BUILT_IN.find(p => p.name === 'Cheap')!.apply(both).picks[0]!.provider).toBe('ollama')
  expect(BUILT_IN.find(p => p.name === 'Max quality')!.apply(both).order.at(-1)).toBe('ollama')
})

test('routing text names Ollama only when it is on and its server is up, and says why when it is down', () => {
  const off = routingText(defaultRouting(), {}, [], { ollamaModels: ['qwen2.5:7b'] })
  expect(off).not.toContain('ollama_run')
  expect(off).toContain('Turned off, never use:')
  expect(off).toContain('Ollama (local)')

  const r = on(defaultRouting())
  const up = routingText(r, {}, [], { ollamaModels: ['qwen2.5:7b', 'nomic-embed-text:latest'] }, { 'qwen2.5:7b': [{ outputTokens: 400, milliseconds: 20000 }] })
  expect(up).toContain(OLLAMA_JOBS)
  expect(up).toContain('Models: qwen2.5:7b, 20 tok/s.')
  expect(up).toContain('mcp__agent-overview__ollama_run')
  expect(up).not.toContain('nomic-embed')
  expect(up).not.toMatch(/Turned off, never use:[^\n]*Ollama/)

  const picked = routingText(on(defaultRouting(), ['llama3.2:3b']), {}, [], { ollamaModels: ['qwen2.5:7b', 'llama3.2:3b'] })
  expect(picked).toContain('Models: llama3.2:3b.')
  expect(picked).not.toContain('Models: qwen2.5:7b')

  const down = routingText(r, {}, [], { down: ['ollama'], ollamaModels: ['qwen2.5:7b'] })
  expect(down).not.toContain('ollama_run')
  expect(down).toContain("Ollama's local server is not answering")
  expect(down).not.toMatch(/Turned off, never use:[^\n]*Ollama/)

  const missing = routingText(r, {}, [], { missing: ['ollama'], ollamaModels: ['qwen2.5:7b'] })
  expect(missing).not.toContain('ollama_run')
  expect(missing).toContain('Not installed or not set up on this machine, never use: Ollama (local)')
  expect(routingText({ ...r, role: 'claude' }, {}, [], { ollamaModels: ['qwen2.5:7b'] })).not.toContain('ollama_run')
})

test('Ollama never becomes the main model by rank, and a refused Claude subagent is not sent to it', () => {
  const r = on(normalRouting({ role: 'plan' }), ['qwen2.5:7b'])
  const mixed = withPicks(r, [{ provider: 'ollama', model: 'qwen2.5:7b' }, { provider: 'codex', model: 'gpt' }])
  expect(lead(mixed)?.provider).toBe('codex')
  expect(lead(withPicks(r, [{ provider: 'ollama', model: 'qwen2.5:7b' }]))).toBeUndefined()
  expect(handoffText(withPicks(r, [{ provider: 'ollama', model: 'qwen2.5:7b' }]))).toContain('(small text jobs only)')
  const auto = { ...mixed, role: 'auto' as const, tags: { claude: 'saver' as const } }
  expect(subagentRoute(withPicks(auto, [{ provider: 'ollama', model: 'qwen2.5:7b' }]), { ...normalGuard(undefined), routingGuard: 'enforce' }, { prompt: 'build it' }, false)).toEqual({})
})

test('cost is always $0 and the usage lines say so, with no quota to watch', () => {
  const spent = spendBy({ rows: [], claude: {}, agy: {} }, { catalog: {}, overrides: {} })
  expect(spent.ollama).toBe(0)
  const ps = everyone()
  ps.ollama = { ...blank(), status: 'ok' }
  const r = on(defaultRouting())
  expect(usageLines(ps, r).split('\n')).toContain('Ollama (local): free · no quota')
  expect(usageLines({ ...ps, ollama: { ...ps.ollama, offline: OLLAMA_DOWN } }, r)).toContain(`Ollama (local): free · no quota · ${OLLAMA_DOWN}`)
  expect(usageTail(ps, r)).not.toContain('Ollama')
  expect(usageTail({ ...ps, ollama: { ...ps.ollama, offline: OLLAMA_DOWN } }, r)).toContain('Ollama (local) down')
  // Older state without an Ollama entry still reads.
  const { ollama: _gone, ...older } = ps
  expect(allOf(older).ollama).toEqual(blank())
})

test('a run picks an allowed, installed chat model and refuses embedders', () => {
  const r = on(defaultRouting())
  const installed = ['qwen2.5:7b', 'nomic-embed-text:latest']
  expect(ollamaPick(r, installed)).toEqual({ model: 'qwen2.5:7b' })
  expect('deny' in ollamaPick(r, installed, 'nomic-embed-text:latest')).toBe(true)
  expect('deny' in ollamaPick(r, installed, 'mistral:7b')).toBe(true)
  expect('deny' in ollamaPick(on(defaultRouting(), ['llama3.2:3b']), ['qwen2.5:7b', 'llama3.2:3b'], 'qwen2.5:7b')).toBe(true)
  expect(ollamaPick(on(defaultRouting(), ['llama3.2:3b']), ['qwen2.5:7b', 'llama3.2:3b'])).toEqual({ model: 'llama3.2:3b' })
  expect('deny' in ollamaPick(r, [])).toBe(true)
})

test('the request asks for one non-streamed answer, keeps the model loaded and sizes its context', () => {
  expect(ollamaBody('qwen2.5:7b', 'hi', { think: false })).toEqual({ model: 'qwen2.5:7b', prompt: 'hi', stream: false, keep_alive: '10m', options: { num_ctx: 8192 }, think: false })
  expect(ollamaBody('qwen2.5:7b', 'hi', { long: true }).options.num_ctx).toBe(16384)
  expect(ollamaBody('qwen2.5:7b', 'x'.repeat(30000)).options.num_ctx).toBe(16384)
  expect(ollamaBody('qwen2.5:7b', 'hi', { system: 'JSON only' })).toMatchObject({ system: 'JSON only' })
})

test('a generation returns the text and records tokens per second from eval_count over eval_duration', async () => {
  const f = fixture([BIN])
  f.answer(body => response({ model: body.model, response: 'A short summary.', done: true, eval_count: 300, eval_duration: 15e9 }))
  const out = await ollamaGenerate(f.api, 'qwen2.5:7b', 'Summarise this.')
  expect(out).toMatchObject({ text: 'A short summary.', outputTokens: 300, ms: 15000 })
  expect(f.requests[0]!.url).toBe(`${OLLAMA_URL}/api/generate`)
  expect(f.requests[0]!.init?.method).toBe('POST')
  expect(JSON.parse(String(f.requests[0]!.init?.body))).toMatchObject({ model: 'qwen2.5:7b', stream: false, keep_alive: '10m', think: false, options: { num_ctx: 8192 } })
  expect((f.saved.modelSpeeds2 as Record<string, unknown[]>)['qwen2.5:7b']).toEqual([{ outputTokens: 300, milliseconds: 15000 }])

  // Short answers add up until they make one sample the speed store keeps.
  f.answer(() => response({ response: 'ok', eval_count: 120, eval_duration: 6e9 }))
  await ollamaGenerate(f.api, 'llama3.2:3b', 'One line.')
  expect((f.saved.modelSpeeds2 as Record<string, unknown[]>)['llama3.2:3b']).toBeUndefined()
  await ollamaGenerate(f.api, 'llama3.2:3b', 'One line.')
  expect((f.saved.modelSpeeds2 as Record<string, unknown[]>)['llama3.2:3b']).toEqual([{ outputTokens: 240, milliseconds: 12000 }])

  // A server that refuses the thinking switch is asked again without it; other errors are thrown.
  let calls = 0
  f.answer(body => (calls++, 'think' in body ? response({ error: '"m" does not support thinking' }, 400) : response({ response: 'fine' })))
  expect((await ollamaGenerate(f.api, 'm:1b', 'hi')).text).toBe('fine')
  expect(calls).toBe(2)
  f.answer(() => response({ error: 'model "x:1b" not found' }, 404))
  await expect(ollamaGenerate(f.api, 'x:1b', 'hi')).rejects.toThrow('not found')
})

test('Bash `ollama run` is seen as an Ollama run, and handing one off counts as babysitting', () => {
  expect(externalOf('ollama run qwen2.5:7b "Summarise the log"')).toMatchObject({ provider: 'ollama', model: 'qwen2.5:7b' })
  expect(externalOf('ollama run --keepalive 10m --nowordwrap qwen2.5:7b < prompt.txt')).toMatchObject({ provider: 'ollama', model: 'qwen2.5:7b' })
  expect(taskOf('ollama run qwen2.5:7b "Summarise the log"')).toBe('Summarise the log')
  expect(taskOf('ollama run qwen2.5:7b < prompt.txt')).toBeUndefined()
  expect(externalOf('ollama list')).toBeUndefined()
  expect(externalOf('ollama run --help')).toBeUndefined()
  expect(babysitting('Call the ollama_run tool with the diff below and return its answer.')).toBe(true)
})

test('the ollama_run tool answers through the local server, and refuses while Ollama is off or down', async ($, hooks) => {
  mock.clock(hooks)
  mock.store(hooks)
  let r = defaultRouting()
  let all: Providers = { ...everyone(), ollama: { ...blank(), status: 'ok', models: [{ id: 'qwen2.5:7b' }] } }
  const sent: any[] = []
  hooks('session.id', () => ({ value: 'ollama-tool' }))
  hooks('state.get', { plugin: 'agent-overview', key: 'routing' }, () => ({ value: { value: r, version: 1 } }))
  hooks('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: all, version: 1 } }))
  hooks('state.set', { plugin: 'agent-overview', key: 'providers' }, (_$, e) => { all = e.value as Providers; return { value: { isSet: true, version: 2 } } })
  hooks('http.fetch', (_$, e) => { sent.push(JSON.parse(String(e.init?.body ?? '{}'))); return { value: response({ response: 'feat: add the parser', eval_count: 12, eval_duration: 5e8 }) } })
  hooks('ui.toast', () => ({ value: undefined }))
  hooks('ui.invalidate', () => ({ value: undefined }))
  const call = (input: Record<string, unknown>) => ($.tool as any).call({ tool: 'mcp__agent-overview__ollama_run', tool_use_id: `o:${sent.length}:${Object.keys(input).join()}`, ...input })

  expect((await call({ prompt: 'Write a commit message.' })).deny).toContain('turned off')
  expect(sent).toEqual([])
  r = on(defaultRouting())
  const ran = await call({ prompt: 'Write a commit message.' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toBe('feat: add the parser')
  expect(sent[0]).toMatchObject({ model: 'qwen2.5:7b', prompt: 'Write a commit message.', stream: false, keep_alive: '10m', think: false })
  expect((await call({ prompt: 'x', model: 'nomic-embed-text:latest' })).deny).toContain('embedding model')
  all = { ...all, ollama: { ...all.ollama, offline: OLLAMA_DOWN } }
  expect((await call({ prompt: 'Write a commit message.' })).deny).toContain(OLLAMA_DOWN)
  expect(sent).toHaveLength(1)
})
