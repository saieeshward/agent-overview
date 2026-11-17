import type { HttpResponse } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { AgentNode, Policy, Providers, RouteLogItem } from '../types'
import { ESCALATE_TO, escalation, failure } from '../hooks/escalate'
import { ollamaBody } from '../hooks/providers'
import { defaultPolicy } from '../hooks/policy'
import { PROVIDERS, blank, defaultRouting } from '../hooks/state'

const response = (body: unknown, status = 200): HttpResponse => ({ ok: status >= 200 && status < 300, status, headers: {}, text: JSON.stringify(body) })
const P = '/Users/sai/site'

test('an answer fails when empty, cut off, a plan file, or JSON that does not parse or match', () => {
  expect(failure('fine')).toBeUndefined()
  expect(failure('  \n')).toBe('it returned an empty answer')
  expect(failure('half a sent', { doneReason: 'length' })).toContain('cut off')
  expect(failure('I have prepared the plan:\n[plan.md](file:///Users/s/.gemini/antigravity-cli/brain/96/plan.md)')).toContain('plan file')
  expect(failure('{"a": 1}', { format: 'json' })).toBeUndefined()
  expect(failure('```json\n{"a": 1}\n```', { format: 'json' })).toBeUndefined()
  expect(failure('{"a": [1, 2,', { format: 'json' })).toBe('its answer is not valid JSON (cut off)')
  expect(failure('Sure! Here it is', { format: 'json' })).toBe('its answer is not valid JSON')
  const schema = { type: 'object', required: ['brand', 'deliverables'], properties: { brand: { type: 'string' }, deliverables: { type: 'array' } } }
  expect(failure('{"brand": "BK", "deliverables": []}', { format: schema })).toBeUndefined()
  expect(failure('{"brand": "BK"}', { format: schema })).toBe('its JSON lacks deliverables')
  expect(failure('{"brand": 3, "deliverables": []}', { format: schema })).toBe('its JSON has the wrong type for brand')
  expect(failure('[1]', { format: schema })).toBe('its JSON is not object')
})

test('escalation goes once to Claude (Ollama to Haiku, Gemini to Sonnet), never to a cloud side lane', () => {
  expect(ESCALATE_TO.ollama.model).toBe('claude-haiku-5-5')
  expect(ESCALATE_TO.gemini.model).toBe('claude-sonnet-5-5')
  const text = escalation('ollama', 'it returned an empty answer', { type: 'private-extract', sensitivity: 'client' })
  expect(text).toStartWith('ESCALATED:')
  expect(text).toContain('model "haiku"')
  expect(text).toContain('task:private-extract sensitivity:client escalated')
  expect(text).toContain('do not retry ollama_run')
  expect(text).toContain('Never send it to Gemini')
  expect(escalation('gemini', 'x')).toContain('model "sonnet"')
  expect(ollamaBody('m', 'p', { format: 'json', images: ['QUJD'] })).toMatchObject({ format: 'json', images: ['QUJD'] })
})

function held(on: any, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

test('ollama_run escalates a failed answer, and the escalated Claude subagent is let through on Haiku under Block', async ($, on) => {
  mock.clock(on); mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'esc' }))
  on('session.cwd', () => ({ value: P }))
  const everyone = Object.fromEntries(PROVIDERS.map(p => [p.id, blank()])) as Providers
  const state: Record<string, any> = {
    routing: { ...defaultRouting(), on: { ...defaultRouting().on, ollama: true } },
    providers: { ...everyone, ollama: { ...blank(), status: 'ok', models: [{ id: 'qwen3.5:9b' }] } },
    policy: { ...defaultPolicy(), declare: 'block' } as Policy, routeLog: [] as RouteLogItem[], nodes: [] as AgentNode[],
  }
  held(on, state)
  const bodies: any[] = []
  let reply: any = { response: '{"brand": "Burger', done_reason: 'length', eval_count: 4096, eval_duration: 2e10, prompt_eval_count: 900 }
  on('http.fetch', (_$: any, e: any) => { bodies.push(JSON.parse(String(e.init?.body ?? '{}'))); return { value: response(reply) } })
  on('fs.read', (_$: any, e: any) => { if (e.path === '/shots/a.png') return { value: { base64: 'UE5H' } }; throw new Error('ENOENT') })
  const spawned: any[] = []
  on('agent.spawn', (_$: any, e: any) => { spawned.push(e); return { model: e.model, agentId: `s${spawned.length}` } })

  const run = await ($.tool as any).call({ tool: 'mcp__agent-overview__ollama_run', tool_use_id: 'o1', prompt: 'Extract the brief', format: 'json', images: ['/shots/a.png'], description: 'task:private-extract sensitivity:client brief fields' })
  expect(run.deny).toBeUndefined()
  expect(run.result).toContain('ESCALATED')
  expect(run.result).toContain('cut off')
  expect(bodies[0]).toMatchObject({ format: 'json', images: ['UE5H'] })
  expect(state.routeLog.find((x: RouteLogItem) => x.id === 'o1')).toMatchObject({ outcome: 'escalated', type: 'private-extract', sensitivity: 'client', tokens: 4996 })
  expect(state.routeLog.find((x: RouteLogItem) => x.id === 'o1').note).toContain('Claude Haiku')

  // The model follows the instruction: the escalated spawn runs on Haiku even though the table says Ollama and Block is on.
  const spawn = (description: string, id: string) => ($.agent as any).spawn({ tool_use_id: id, prompt: 'Extract', description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  const ok = await spawn('task:private-extract sensitivity:client escalated brief fields', 'e1')
  expect(ok.deny).toBeUndefined()
  expect(spawned.at(-1).model).toBe('claude-haiku-5-5')
  expect(state.routeLog.find((x: RouteLogItem) => x.id === 'e1').note).toContain('escalated from Ollama')
  expect((await spawn('task:private-extract sensitivity:client brief fields', 'e2')).deny).toContain('ollama_run')

  // A good answer is returned as it came.
  reply = { response: '{"brand": "Burger King"}', done_reason: 'stop', eval_count: 10, eval_duration: 1e9 }
  expect((await ($.tool as any).call({ tool: 'mcp__agent-overview__ollama_run', tool_use_id: 'o2', prompt: 'Extract', format: 'json' })).result).toBe('{"brand": "Burger King"}')
  expect(state.routeLog.find((x: RouteLogItem) => x.id === 'o2').outcome).toBe('done')
})

test('gemini_run escalates an empty answer or a plan file to Sonnet', async ($, on) => {
  mock.clock(on); mock.store(on)
  mock.env(on, { HOME: '/home/t', PATH: '/usr/bin:/bin' })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'gesc' }))
  on('session.cwd', () => ({ value: P }))
  on('fs.stat', (_$: any, e: any) => { if (e.path.endsWith('/.local/bin/agy') || e.path === `${P}/sign.png`) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }; throw new Error('ENOENT') })
  let response = ''
  on('process.run', (_$: any, e: any) => {
    const out = e.argv[0] === '/usr/bin/mktemp' ? '/tmp/ao-gemini.Qq11Ww22\n' : e.argv[0] === '/usr/bin/readlink' ? `${e.argv.at(-1)}\n` : e.argv[0] === 'git' ? `${P}\n` : e.argv.includes('--sandbox') ? JSON.stringify({ status: 'SUCCESS', response, usage: { input_tokens: 10, output_tokens: 0 } }) : ''
    return { value: { stdout: out, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const state: Record<string, any> = { routing: defaultRouting(), policy: { ...defaultPolicy(), allow: [P] }, routeLog: [] as RouteLogItem[], confidential: { cwd: P, found: [], sources: [] } }
  held(on, state)
  const call = (id: string, extra: object = {}) => ($.tool as any).call({ tool: 'mcp__agent-overview__gemini_run', tool_use_id: id, prompt: 'What does the sign say?', sensitivity: 'public', images: [`${P}/sign.png`], ...extra })
  const empty = await call('g1')
  expect(empty.result).toContain('ESCALATED')
  expect(empty.result).toContain('model "sonnet"')
  expect(empty.result).toContain('task:visual sensitivity:public escalated')
  response = 'I have prepared the plan: [p.md](file:///Users/s/.gemini/antigravity-cli/brain/1/p.md)'
  expect((await call('g2')).result).toContain('plan file')
  response = 'not json'
  expect((await call('g3', { format: 'json' })).result).toContain('not valid JSON')
  expect(state.routeLog.filter((x: RouteLogItem) => x.outcome === 'escalated').map((x: RouteLogItem) => x.id)).toEqual(['g1', 'g2', 'g3'])
})
