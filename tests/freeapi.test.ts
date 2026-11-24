import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { FREE_PROVIDERS, freeBody, freeChain, freePlan, keysOf } from '../hooks/freeapi'

type Reply = { status: number; body: unknown } | Error
// A stand-in engine: replies are given per provider host, in order; every call is recorded.
function fake(replies: Record<string, Reply[]>) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = []
  const $ = {
    clock: { now: async () => 0, after: () => ({ cancel() {} }) },
    http: {
      fetch: async (url: string, init: { headers: Record<string, string>; body: string }) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
        const host = Object.values(FREE_PROVIDERS).find(p => p.url === url)!.name.toLowerCase()
        const next = replies[host]?.shift()
        if (!next) throw new Error('unexpected call')
        if (next instanceof Error) throw next
        return { status: next.status, ok: next.status < 400, text: JSON.stringify(next.body) }
      },
    },
  } as unknown as EngineInterface
  return { $, calls }
}
const ok = (text: string) => ({ status: 200, body: { model: 'm', choices: [{ message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 2 } } })

test('keysOf reads only non-blank string keys', () => {
  expect(keysOf({ groqApiKey: ' k1 ', cerebrasApiKey: '', openrouterApiKey: 5 })).toEqual({ groq: 'k1' })
  expect(keysOf(undefined)).toEqual({})
})

test('freePlan: a named provider alone, else every keyed provider fastest first', () => {
  expect(freePlan({ groq: 'a', openrouter: 'b', cerebras: 'c' })).toEqual(['cerebras', 'groq', 'openrouter'])
  expect(freePlan({ groq: 'a' }, 'groq')).toEqual(['groq'])
  expect(freePlan({ groq: 'a' }, 'cerebras')).toEqual([])
  expect(freePlan({ groq: 'a' }, 'nonsense')).toEqual(['groq'])
})

test('freeBody asks for JSON and carries the system line only when given', () => {
  expect(freeBody('m', 'hi').messages).toEqual([{ role: 'user', content: 'hi' }])
  const b = freeBody('m', 'hi', { system: 's', json: true }) as any
  expect(b.messages[0]).toEqual({ role: 'system', content: 's' })
  expect(b.response_format).toEqual({ type: 'json_object' })
})

test('a rate limit moves on to the next provider; the first keyed one is asked first', async () => {
  const { $, calls } = fake({ cerebras: [{ status: 429, body: { error: { message: 'slow down' } } }], groq: [ok('hello')] })
  const { run, errors } = await freeChain($, { cerebras: 'ck', groq: 'gk' }, 'hi')
  expect(run?.provider).toBe('groq')
  expect(run?.text).toBe('hello')
  expect(run?.outputTokens).toBe(2)
  expect(errors).toEqual(['Cerebras: slow down'])
  expect(calls.map(c => c.headers.authorization)).toEqual(['Bearer ck', 'Bearer gk'])
})

test('a malformed request stops the chain: no other provider would take it either', async () => {
  const { $, calls } = fake({ cerebras: [{ status: 400, body: { error: { message: 'bad request' } } }], groq: [ok('never')] })
  const { run, errors } = await freeChain($, { cerebras: 'ck', groq: 'gk' }, 'hi')
  expect(run).toBeUndefined()
  expect(errors).toHaveLength(1)
  expect(calls).toHaveLength(1)
})

test('a network error and an empty answer both count as retryable', async () => {
  const { $ } = fake({ cerebras: [new Error('socket hang up')], groq: [{ status: 200, body: { choices: [{ message: { content: '  ' } }] } }], openrouter: [ok('last')] })
  const { run, errors } = await freeChain($, { cerebras: 'a', groq: 'b', openrouter: 'c' }, 'hi')
  expect(run?.provider).toBe('openrouter')
  expect(errors).toHaveLength(2)
})

test('no key set says which option to fill; a model name is dropped when several providers are tried', async () => {
  const none = await freeChain(fake({}).$, {}, 'hi')
  expect(none.errors[0]).toContain('groqApiKey')
  const { $, calls } = fake({ cerebras: [{ status: 500, body: {} }], groq: [ok('x')] })
  await freeChain($, { cerebras: 'a', groq: 'b' }, 'hi', { model: 'some-model' })
  expect(calls[0]!.body.model).toBe(FREE_PROVIDERS.cerebras.model)
  const single = fake({ groq: [ok('x')] })
  await freeChain(single.$, { groq: 'b' }, 'hi', { provider: 'groq', model: 'custom' })
  expect(single.calls[0]!.body.model).toBe('custom')
})
