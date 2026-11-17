import type { EngineInterface, HttpInit, HttpResponse } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { AdversarialRun, Finding, Guard, Policy, Providers, RouteLogItem, Routing } from '../hooks/../types'
import { ADVERSARY, parseArgs } from '../hooks/adversarial'
import { failure } from '../hooks/escalate'
import { ollamaBody, ollamaGenerate } from '../hooks/providers'
import { defaultPolicy } from '../hooks/policy'
import { PROVIDERS, blank, defaultRouting, normalGuard } from '../hooks/state'

// Adversarial review round 1: findings 6, 12, 13, 14, 15.
const P = '/Users/sai/repo'
const DIFF = 'diff --git a/src/parse.ts b/src/parse.ts\n--- a/src/parse.ts\n+++ b/src/parse.ts\n@@ -1 +1 @@\n-old\n+new\n'

function held(on: any, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

// ---------- 6. the reviewer's privileged spawn ----------

function review($: any, on: any, initial: Partial<AdversarialRun> | undefined) {
  mock.clock(on); mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'r1adv' }))
  on('session.cwd', () => ({ value: P }))
  on('process.run', (_$: any, e: any) => {
    const a = e.argv.join(' ')
    const out = a.includes('--show-toplevel') ? P : a.includes('rev-parse --verify') ? 'abc123' : a.includes('diff --name-only') ? 'src/parse.ts\n' : a.includes('diff --no-color') ? DIFF : ''
    return { value: { stdout: out, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const state: Record<string, any> = { routing: defaultRouting() as Routing, findings: [] as Finding[], nodes: [] }
  if (initial) state.adversarial = { status: 'confirm', base: 'HEAD', goal: 'g', model: 'claude-opus-5-5', round: 0, rounds: 2, diffChars: 100, files: 1, found: 0, at: 0, ...initial } as AdversarialRun
  held(on, state)
  const spawned: any[] = []
  on('agent.spawn', (_$: any, e: any) => { spawned.push(e); return { model: e.model, agentId: `rev${spawned.length}` } })
  on('agent.list', () => ({ value: spawned.map((x, i) => ({ id: `rev${i + 1}`, description: x.description, status: 'completed' })) as any }))
  const cmd = async (args: string) => (await ($.command as any).run({ command: 'review-adversarial', args })).text as string
  const spawn = (description?: string) => ($.agent as any).spawn({ tool_use_id: 'model-call', subagentType: ADVERSARY, model: 'claude-opus-5-5', description, prompt: 'review it' })
  return { state, spawned, cmd, spawn }
}

test('6: a model that names the reviewer type itself is refused unless the owner has started a round', async ($, on) => {
  // No run at all: the repro. The branch used to trust the type name and start Opus.
  const h = review($, on, undefined)
  expect((await h.spawn('Adversarial review round 1')).deny).toContain('/review-adversarial go')
  expect(h.spawned).toHaveLength(0)
  // A run awaiting the owner's go, but no claim: still refused.
  h.state.adversarial = { status: 'confirm', base: 'HEAD', goal: 'g', model: 'claude-opus-5-5', round: 0, rounds: 2, diffChars: 100, files: 1, found: 0, at: 0 }
  expect((await h.spawn('Adversarial review round 1')).deny).toContain('/review-adversarial go')
  expect((await h.spawn(undefined)).deny).toContain('/review-adversarial go')
  // Running, done, failed: refused whatever the description.
  for (const status of ['running', 'done', 'failed', 'idle'] as const) {
    h.state.adversarial = { ...h.state.adversarial, status, nonce: 'abc', desc: 'Adversarial review round 1 #abc' }
    expect((await h.spawn('Adversarial review round 1 #abc')).deny).toContain('/review-adversarial go')
  }
  expect(h.spawned).toHaveLength(0)
})

test('6: the owner\'s go gets exactly one reviewer through; the same description a second time is refused', async ($, on) => {
  const h = review($, on, {})
  expect(await h.cmd('go')).toContain('round 1 of 2 started')
  expect(h.spawned).toHaveLength(1)
  const desc = h.spawned[0].description as string
  expect(desc).toMatch(/^Adversarial review round 1 #\w+$/)
  expect(h.state.adversarial).toMatchObject({ status: 'running', round: 1 })
  expect(h.state.adversarial.nonce).toBeUndefined()
  expect(h.state.adversarial.starting).toBeUndefined()
  // Replaying the exact description (or a guess at it) after the run is going is refused.
  expect((await h.spawn(desc)).deny).toContain('/review-adversarial go')
  expect((await h.spawn('Adversarial review round 1')).deny).toContain('/review-adversarial go')
  expect(h.spawned).toHaveLength(1)
})

test('6 and 13: two near-simultaneous starts spawn one reviewer, and a goal that starts with go is a goal', async ($, on) => {
  const h = review($, on, {})
  const [a, b] = await Promise.all([h.cmd('go'), h.cmd('go')])
  expect(h.spawned).toHaveLength(1)
  expect([a, b].filter(t => t.includes('started on')).length).toBe(1)
  expect([a, b].some(t => t.includes('already'))).toBe(true)
  // Arguments: only the whole text is a command.
  for (const goal of ['go through the auth flow', 'status of the parser rewrite', 'stop words must be kept', 'yes or no answers only', 'start with the CLI']) {
    expect(parseArgs(goal)).toMatchObject({ action: 'prepare', goal })
  }
  expect(parseArgs('go')).toMatchObject({ action: 'go' })
  expect(parseArgs('Go.')).toMatchObject({ action: 'go' })
  expect(parseArgs('stop')).toMatchObject({ action: 'cancel' })
  expect(parseArgs('status')).toMatchObject({ action: 'status' })
})

// ---------- 12. Ollama: a cut input and a stuck server ----------

const response = (body: unknown, status = 200): HttpResponse => ({ ok: status >= 200 && status < 300, status, headers: {}, text: JSON.stringify(body) })
function host(answer: (body: any) => HttpResponse | Promise<never>, afterFires = false) {
  const requests: { url: string; body: any }[] = []
  const saved: Record<string, unknown> = {}
  const api = {
    env: { get: async () => undefined },
    clock: { now: async () => 1, after: (_ms: number, fn: () => void) => { if (afterFires) fn(); return { cancel: () => {} } } },
    http: { fetch: async (url: string, init?: HttpInit) => { const body = JSON.parse(String(init?.body ?? '{}')); requests.push({ url, body }); return answer(body) } },
    store: { get: async (k: string) => saved[k], set: async (k: string, v: unknown) => { saved[k] = v } },
    state: { get: async () => ({ value: undefined, version: 1 }), set: async () => ({ isSet: true, version: 2 }) },
    ui: { invalidate: () => {} },
  } as unknown as EngineInterface
  return { api, requests }
}

test('12: an input that fills the context window is reported as cut, so the answer escalates', async () => {
  const h = host(() => response({ response: 'A summary of the end only.', done: true, done_reason: 'stop', prompt_eval_count: 8192, eval_count: 20, eval_duration: 1e9 }))
  const out = await ollamaGenerate(h.api, 'qwen3.5:9b', 'x'.repeat(100))
  expect(out.doneReason).toBe('input-cut')
  expect(failure(out.text, { doneReason: out.doneReason })).toContain('did not fit the context window')
  // A prompt well inside the window is unaffected, and long prompts get the 16K window to compare against.
  const fine = host(() => response({ response: 'ok', done: true, done_reason: 'stop', prompt_eval_count: 900, eval_count: 5, eval_duration: 1e9 }))
  expect((await ollamaGenerate(fine.api, 'qwen3.5:9b', 'x'.repeat(100))).doneReason).toBe('stop')
  const long = host(() => response({ response: 'ok', done: true, done_reason: 'stop', prompt_eval_count: 9000, eval_count: 5, eval_duration: 1e9 }))
  expect((await ollamaGenerate(long.api, 'qwen3.5:9b', 'x'.repeat(100), { long: true })).doneReason).toBe('stop')
  const cut16 = host(() => response({ response: 'ok', prompt_eval_count: 16384, eval_count: 5, eval_duration: 1e9 }))
  expect((await ollamaGenerate(cut16.api, 'qwen3.5:9b', 'x'.repeat(100), { long: true })).doneReason).toBe('input-cut')
  expect(failure('fine', { doneReason: 'stop' })).toBeUndefined()
})

test('12: the answer is capped, and a timeout asks the server to unload the busy model', async () => {
  expect(ollamaBody('m', 'hi').options).toEqual({ num_ctx: 8192, num_predict: 3000 })
  expect(ollamaBody('m', 'hi', { long: true }).options).toEqual({ num_ctx: 16384, num_predict: 6000 })
  // The first request never answers and the deadline fires; the unload request goes out and the error still reaches the caller.
  let n = 0
  const h = host(() => (++n === 1 ? new Promise<never>(() => {}) : response({})), true)
  await expect(ollamaGenerate(h.api, 'qwen3.5:9b', 'hi')).rejects.toThrow('no answer from Ollama')
  await new Promise(done => setTimeout(done, 20))
  expect(h.requests).toHaveLength(2)
  expect(h.requests[1]!.body).toEqual({ model: 'qwen3.5:9b', keep_alive: 0 })
})

// ---------- 14 and 15. a spawn with no description; declarations off change nothing ----------

const everyone = () => Object.fromEntries(PROVIDERS.map(p => [p.id, blank()])) as Providers
function agents($: any, on: any, policy: Partial<Policy>) {
  mock.clock(on); mock.store(on)
  const state: Record<string, any> = {
    nodes: [], decisions: [], routing: { ...defaultRouting(), on: { ...defaultRouting().on, ollama: true } }, guard: normalGuard(undefined) as Guard,
    policy: { ...defaultPolicy(), ...policy }, routeLog: [] as RouteLogItem[], providers: { ...everyone(), ollama: { ...blank(), status: 'ok', models: [{ id: 'qwen3.5:9b' }] } },
  }
  held(on, state)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'r1agents' }))
  const spawned: any[] = []
  const efforts: (string | undefined)[] = []
  on('agent.spawn', (_$: any, e: any) => { spawned.push(e); return { model: e.model ?? 'inherit', agentId: `a${spawned.length}` } })
  on('tool.call', async (_$: any, e: any) => {
    efforts.push(e.effort)
    const ran = await ($.agent as any).spawn({ tool_use_id: e.tool_use_id, prompt: e.prompt, description: e.description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5' })
    return ran.deny ? { deny: ran.deny } : { result: { status: 'completed', agentId: ran.agentId, usage: { input_tokens: 1, output_tokens: 1 }, totalDurationMs: 1 } }
  })
  const call = (id: string, input: Record<string, unknown>) => ($.tool as any).call({ tool: 'Agent', tool_use_id: id, prompt: 'Do it', ...input })
  return { state, spawned, efforts, call }
}

test('14: an Agent spawn with no description does not throw, in warn and block', async ($, on) => {
  const h = agents($, on, {})
  const ran = await h.call('d1', {})
  expect(ran.deny).toBeUndefined()
  expect(h.state.routeLog.find((x: RouteLogItem) => x.id === 'd1')).toMatchObject({ declared: 'missing', outcome: 'warned' })
  h.state.policy = { ...h.state.policy, declare: 'block' }
  const blocked = await h.call('d2', {})
  expect(blocked.deny ?? blocked.text).toContain('task:<type> sensitivity:')
})

test('15: with declarations off, a declared spawn keeps its own model and effort', async ($, on) => {
  const h = agents($, on, { declare: 'off' })
  const ran = await h.call('o1', { description: 'task:build sensitivity:internal Add the parser', model: 'claude-opus-5-5', effort: 'max' })
  expect(ran.deny).toBeUndefined()
  // The table would give build Sonnet at medium; with declare off the call goes through as made (no model of the mod's choosing).
  expect(h.spawned.at(-1).model).toBeUndefined()
  expect(h.efforts.at(-1)).toBe('max')
  // The declaration is still recorded, so side-lane calls can inherit its sensitivity.
  expect(h.state.routeLog.find((x: RouteLogItem) => x.id === 'o1')).toMatchObject({ sensitivity: 'internal', type: 'build' })
  // Warn mode on the same call does rewrite it: the contrast.
  h.state.policy = { ...h.state.policy, declare: 'warn' }
  await h.call('o2', { description: 'task:build sensitivity:internal Add the parser', model: 'claude-opus-5-5', effort: 'max' })
  expect(h.spawned.at(-1).model).toBe('claude-sonnet-5-5')
  expect(h.efforts.at(-1)).toBe('medium')
})
