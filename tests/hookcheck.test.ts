import { expect, mock, test } from 'claude-code/testing'

import { hookStatus, hookSummary, isBypassed, parseBypass, TRACKED } from '../hooks/hookcheck'
import type { HookCheck } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const check = (ran: Record<string, number>, bypassed: Record<string, string> = {}): HookCheck => ({ session: 's', ran, bypassed })

test('the debug log names each bypassed hook and the plugin above it', () => {
  const log = [
    '2026-11-17T10:00:00Z [DEBUG] agent-overview: prompt.compose bypassed by cc-plugin-sec-default (tier user); beneath runs',
    '2026-11-17T10:00:01Z [DEBUG] agent-overview: skill.prompt bypassed by cc-plugin-sec-default (tier user) 3 more times in the last 10s',
    '2026-11-17T10:00:02Z [DEBUG] other-mod: tool.call bypassed by cc-plugin-sec-default (tier user); beneath runs',
  ].join('\n')
  expect(parseBypass(log)).toEqual({ 'prompt.compose': 'cc-plugin-sec-default', 'skill.prompt': 'cc-plugin-sec-default' })
})

test('a hook is live once it ran, bypassed when the log says so or its occasion passed without it, else not due', () => {
  const fresh = hookSummary(check({ 'session.start': 1 }))
  expect(fresh.total).toBe(TRACKED.length)
  expect(fresh.live).toBe(1)
  expect(fresh.bypassed).toEqual([])

  // A main request went out and prompt.compose never ran: it was skipped by something above it.
  const asked = check({ 'session.start': 1, 'turn.start:main': 1, 'turn.step:main': 1, 'turn.step': 1, 'turn.start': 1, 'prompt.submit': 1 })
  const byEvent = Object.fromEntries(hookStatus(asked).map(h => [h.event, h.status]))
  expect(byEvent['prompt.compose']).toBe('bypassed')
  expect(byEvent['classic.SessionStart']).toBe('bypassed')
  expect(byEvent['prompt.submit']).toBe('live')
  // One turn is not enough evidence for attachments; a Skill call is the occasion for skill.prompt.
  expect(byEvent['prompt.attachment']).toBe('unseen')
  expect(byEvent['skill.prompt']).toBe('unseen')
  expect(isBypassed(check({ 'tool.call:Skill': 1 }), 'skill.prompt')).toBe(true)
  expect(isBypassed(check({ 'tool.call:Skill': 1, 'skill.prompt': 1 }), 'skill.prompt')).toBe(false)
  expect(isBypassed(check({ 'turn.complete:main': 2 }), 'prompt.attachment')).toBe(true)

  // The log's word stands before any occasion; a run proves it live after all.
  expect(hookStatus(check({}, { 'skill.prompt': 'cc-plugin-sec-default' })).find(h => h.event === 'skill.prompt')).toMatchObject({ status: 'bypassed', by: 'cc-plugin-sec-default' })
  expect(isBypassed(check({ 'prompt.compose': 1 }, { 'prompt.compose': 'cc-plugin-sec-default' }), 'prompt.compose')).toBe(false)
})

test('Settings shows "Hooks: N of M live", names what is bypassed, and the switches say what OFF still does', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  let held: HookCheck = check({ 'session.start': 1, 'tool.call': 1, 'ui.render': 1, 'turn.step:main': 1, 'tool.call:Skill': 1, 'turn.complete:main': 3 }, { 'prompt.compose': 'cc-plugin-sec-default' })
  on('state.get', { plugin: 'agent-overview', key: 'hookcheck' }, () => ({ value: { value: held, version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'hookcheck' }, (_$, e) => { held = e.value as HookCheck; return { value: { isSet: true, version: 2 } } })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props })
    await ui.press({ key: 'tab:settings' })
    expect(await ui.find({ type: 'Text', text: 'HOOKS' })).toBeDefined()
    // The panel adds what ran in this module (ui.render at least) to the saved record.
    expect(await ui.find({ type: 'Text', text: new RegExp(`Hooks: \\d+ of ${TRACKED.length} live`) })).toBeDefined()
    expect(await ui.find({ key: 'hook:prompt.compose' })).toBeDefined()
    expect(await ui.find({ key: 'hook:skill.prompt' })).toBeDefined()
    expect(await ui.find({ key: 'hook:prompt.attachment' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not working: OFF hiding skills and tools/ })).toBeDefined()
    await ui.press({ key: 'tab:plugins' })
    expect(await ui.find({ key: 'switch:note' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /OFF still refuses calls, but cannot hide skills and tools from the listing, or stop a slash-typed skill/ })).toBeDefined()
    await ui.unmount()
  }
})
