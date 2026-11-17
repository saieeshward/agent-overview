import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { fixture, NOW } from '../tools/pane-fixtures'
import { routingText, withPicks, withTag } from '../hooks/state'
import { workText } from '../hooks/work/stage'

function setup(on: On) {
  const state = fixture({ area: 'vibe', tab: 'crew', scenario: 'delivery' })
  const store: Record<string, any> = {}
  let id = 'delivery', drop = false
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: id }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => { store[e.key] = e.value; return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', (_$, e) => drop ? { drop: 'blocked' } : { text: e.text, context: e.context })
  on('tool.call', () => ({ result: 'ok' }))
  return { state, store, resume: () => { state.deliveredPrompt = null }, session: (value: string) => { id = value }, drop: (value: boolean) => { drop = value } }
}

const compose = { model: 'claude', promptModel: 'claude', surfaces: [], tools: [], outputStyle: null, traits: [] }
const user = { origin: { kind: 'composer' as const }, wait: false }
const props = { title: 'Agent panel', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

test('Crew routing changes reach the next user turn, match the gate, and stop when unchanged', async ($, on) => {
  const { state, store } = setup(on)
  state.routing.on.commandcode = false
  state.routing.paused = { commandcode: { why: 'quota', at: NOW - 1000, until: NOW + 10000 } }
  await $.prompt.compose(compose)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props })
  expect(await ui.find({ type: 'Text', text: 'this chat' })).toBeDefined()
  await ui.press({ key: 'preset:save' })
  await ui.input({ key: 'preset:name', text: 'Crew' })
  const submit = () => $.prompt.submit({ text: 'continue', ...user })
  expect((await submit()).context).toBeUndefined()
  for (const on of [true, false]) {
    await ui.press({ key: 'crew:on:commandcode' })
    expect(store.presets.find((p: any) => p.name === 'Crew').routing.on.commandcode).toBe(on)
    const result = await submit()
    expect(result.text).toBe('continue')
    expect(result.context).toEqual([`Delegation routing changed (overrides the earlier routing section):\n${routingText(state.routing, {}, [], state.guard)}`])
    expect(result.context![0]!.includes('Paused automatically')).toBe(false)
    const gate = await ($.tool as any).call({ tool: 'Bash', tool_use_id: `cc:${on}`, command: 'cmd -p "review"' })
    expect(!!gate.deny).toBe(!on)
    expect(store['deliveredPrompt:delivery'].routing).toBe(routingText(state.routing, {}, [], state.guard))
    expect((await submit()).context).toBeUndefined()
  }
  await ui.unmount()
})

test('resumes compare the last delivered text, preserve other context and retry blocked updates', async ($, on) => {
  const ctx = setup(on), { state, store } = ctx
  await $.prompt.compose(compose)
  const original = store['deliveredPrompt:delivery']
  state.routing = withTag(state.routing, 'commandcode', 'saver')
  ctx.resume()
  // A compose after resuming must not overwrite the last text the model received.
  await $.prompt.compose(compose)
  expect(store['deliveredPrompt:delivery']).toEqual(original)
  ctx.drop(true)
  expect((await $.prompt.submit({ text: 'continue', ...user })).drop).toBe('blocked')
  expect(store['deliveredPrompt:delivery']).toEqual(original)
  ctx.drop(false)
  const result = await $.prompt.submit({ text: 'continue', context: ['other plugin'], ...user })
  expect(result.context).toContain('other plugin')
  expect(result.context!.join('\n')).toContain('Command Code')
  expect(result.context!.join('\n')).toContain('Saver providers')
  ctx.resume()
  const same = await $.prompt.submit({ text: 'continue', context: ['other plugin'], ...user })
  expect(same.context).toEqual(['other plugin'])
  ctx.session('other-chat')
  expect((await $.prompt.submit({ text: 'continue', ...user })).context!.some(t => t.startsWith('Delegation routing changed'))).toBe(true)
})

test('Work stages, Vibe and Default changes override the mode section on the next user turn', async ($, on) => {
  const { state, store } = setup(on)
  await $.prompt.compose(compose)
  for (const [area, at] of [['work', 'plan'], ['work', 'implement'], ['work', 'review'], ['vibe', 'review'], ['overview', 'review']] as const) {
    state.ui.area = area
    state.stage = { at, reached: [at], round: 1 }
    const mode = workText(area, state.stage, state.guard.work, state.impl)
    const result = await $.prompt.submit({ text: 'continue', ...user })
    expect(result.context).toEqual([`Mode instructions changed (overrides the earlier Work/Vibe mode section):\n${mode || 'Default mode. No Work stages or Vibe instructions apply.'}`])
    const gate = await ($.tool as any).call({ tool: 'Edit', tool_use_id: `${area}:${at}` })
    expect(!!gate.deny).toBe(area === 'work' && at !== 'implement')
    expect(store['deliveredPrompt:delivery'].work).toBe(mode)
    expect((await $.prompt.submit({ text: 'continue', ...user })).context).toBeUndefined()
  }
})

test('background notifications do not consume an update needed by the next owner or Work button turn', async ($, on) => {
  const { state, store } = setup(on)
  await $.prompt.compose(compose)
  const before = store['deliveredPrompt:delivery']
  state.routing.on.commandcode = false
  const note = await $.prompt.submit({ text: 'background finished', wait: false, origin: { kind: 'task-notification' } })
  expect(note.context).toBeUndefined()
  expect(store['deliveredPrompt:delivery']).toEqual(before)
  const button = await $.prompt.submit({ text: 'Implement', wait: false, origin: { kind: 'plugin', name: 'agent-overview' } })
  expect(button.context!.join('\n')).toContain('Turned off, never use: Command Code')
  expect((await $.prompt.submit({ text: 'continue', ...user })).context).toBeUndefined()
})

test('live model speeds alone never re-send the routing; a routing change sends it with the speeds', async ($, on) => {
  const { state, store } = setup(on)
  state.routing = withPicks(state.routing, [{ provider: 'codex', model: 'gpt-6.1-sol' }])
  state.modelSpeeds = { 'gpt-6.1-sol': [{ outputTokens: 400, milliseconds: 10000 }] }
  await $.prompt.compose(compose)
  const submit = () => $.prompt.submit({ text: 'continue', ...user })
  expect((await submit()).context).toBeUndefined()
  for (const outputTokens of [900, 250]) {
    state.modelSpeeds = { 'gpt-6.1-sol': [{ outputTokens, milliseconds: 10000 }] }
    expect((await submit()).context).toBeUndefined()
  }
  state.modelSpeeds = {}
  expect((await submit()).context).toBeUndefined()
  state.modelSpeeds = { 'gpt-6.1-sol': [{ outputTokens: 600, milliseconds: 10000 }] }
  state.routing = { ...state.routing, on: { ...state.routing.on, commandcode: false } }
  const sent = (await submit()).context!.join('\n')
  expect(sent).toContain('Turned off, never use: Command Code')
  expect(sent).toContain('gpt-6.1-sol on Codex, 60 tok/s')
  expect(store['deliveredPrompt:delivery'].routing).not.toContain('tok/s')
  expect((await submit()).context).toBeUndefined()
})
