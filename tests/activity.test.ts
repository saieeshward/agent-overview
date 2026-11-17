import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Act, LiveEdit } from '../types'

function activityState(on: On, initial: Record<string, Act> = {}) {
  const state = { acts: initial, live: null as LiveEdit | null, lastLive: null as LiveEdit | null }
  let version = 0
  on('state.get', { plugin: 'agent-overview' }, (_$, e, next) => {
    if (e.key === 'acts' || e.key === 'live' || e.key === 'lastLive') return { value: { value: state[e.key], version } }
    return next(e)
  })
  on('state.set', { plugin: 'agent-overview' }, (_$, e, next) => {
    if (e.key !== 'acts' && e.key !== 'live' && e.key !== 'lastLive') return next(e)
    Object.assign(state, { [e.key]: e.value })
    return { value: { isSet: true, version: ++version } }
  })
  return state
}

test('activity records running tools, result tails and failed calls, excluding its own logs', async ($, on) => {
  mock.clock(on, { now: 1234 })
  const state = activityState(on)
  on('tool.call', async (_$, e) => {
    expect(state.acts.main?.state).toBe('running')
    if ((e as { tool_use_id?: string }).tool_use_id === 'error') return { result: 'bad', isError: true }
    if ((e as { tool_use_id?: string }).tool_use_id === 'deny') return { deny: 'refused' }
    return { result: 'fallback', text: Array.from({ length: 18 }, (_, i) => `line ${i}`).join('\n\n') }
  })
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'tail', command: `${'x'.repeat(210)}\nsecond line` })
  expect(state.acts.main).toMatchObject({ title: 'x'.repeat(200), state: 'done', at: 1234, endedAt: 1234, output: Array.from({ length: 14 }, (_, i) => `line ${i + 4}`) })
  await ($.tool as any).call({ tool: 'Read', tool_use_id: 'error', file_path: '/x/file.ts' })
  expect(state.acts.main).toMatchObject({ title: '/x/file.ts', state: 'failed' })
  await ($.tool as any).call({ tool: 'Grep', tool_use_id: 'deny', pattern: 'needle', path: '/x' })
  expect(state.acts.main).toMatchObject({ title: 'needle · /x', state: 'failed' })
  const previous = { ...state.acts }
  await ($.tool as any).call({ tool: 'mcp__agent-overview__decision_log', tool_use_id: 'log', decision: 'Keep it', why: 'Useful' })
  expect(state.acts).toEqual(previous)
})

test('activity trims the oldest finished agent and preserves running work', async ($, on) => {
  mock.clock(on, { now: 100 })
  const state = activityState(on, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), {
    key: String(i), tool: 'Read', title: 'file', state: i === 0 ? 'running' : 'done', at: i,
  } as Act])))
  on('tool.call', () => ({ result: { ok: true } }))
  await ($.tool as any).call({ tool: 'mcp__my-server__search', tool_use_id: 'search', query: 'needle' })
  const all = state.acts
  expect(Object.keys(all).length).toBe(12)
  expect(all['0']?.state).toBe('running')
  expect(all['1']).toBeUndefined()
  expect(all.main).toMatchObject({ title: 'search · needle', output: ['{"ok":true}'] })
})

test('an older parallel tool finishing cannot replace the newest activity', async ($, on) => {
  mock.clock(on)
  const state = activityState(on)
  let started!: () => void
  let finish!: (value: { result: string }) => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const result = new Promise<{ result: string }>(resolve => { finish = resolve })
  on('tool.call', (_$, e) => {
    if ((e as { tool_use_id?: string }).tool_use_id === 'slow') { started(); return result }
    return { result: 'fast' }
  })
  const slow = ($.tool as any).call({ tool: 'Bash', tool_use_id: 'slow', command: 'slow command' })
  await ready
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'fast', command: 'fast command' })
  finish({ result: 'slow' })
  await slow
  expect(state.acts.main).toMatchObject({ title: 'fast command', state: 'done', output: ['fast'] })
})

test('streamed edits read context once, retain it on completion and preserve the prompt band state', async ($, on) => {
  mock.clock(on, { now: 100 })
  const state = activityState(on)
  let reads = 0
  on('fs.read', () => { reads++; return { value: 'head\nold\ntail' } })
  on('turn.step', async function* () {
    yield { kind: 'tool', index: 0, id: 'stream-edit', name: 'Edit' }
    yield { kind: 'input', index: 0, json: '{"file_path":"/x/file.ts","old_string":"old","new_string":"' + 'a'.repeat(100) }
    yield { kind: 'input', index: 0, json: 'b'.repeat(100) + '"}' }
    return { turnId: 'stream', index: 0, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('tool.call', () => ({ result: 'ok' }))
  for await (const _ of ($.turn as any).step({ turnId: 'stream', index: 0, model: 'claude', messageCount: 0 })) { /* drain */ }
  const text = 'a'.repeat(100) + 'b'.repeat(100)
  expect(state.acts.main).toMatchObject({ tool: 'Edit', state: 'running', file: '/x/file.ts', startLine: 2, before: ['head'], old: ['old'], text, after: ['tail'] })
  expect(state.live?.text).toBe(text)
  await ($.tool as any).call({ tool: 'Edit', tool_use_id: 'stream-edit', file_path: '/x/file.ts', old_string: 'old', new_string: text })
  expect(reads).toBe(1)
  expect(state.acts.main).toMatchObject({ state: 'done', startLine: 2, before: ['head'], old: ['old'], text, after: ['tail'] })
  expect(state.live).toBeNull()
  expect(state.lastLive?.text).toBe(text)
})
