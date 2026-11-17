import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

test('lines written and deleted keep growing after the recent edits list is trimmed', { timeoutMs: 60000 }, async ($, on) => {
  mock.clock(on, { now: 1000 }); mock.store(on)
  const state: Record<string, any> = {}
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  for (let i = 0; i < 45; i++) await ($.tool.call as any)({ tool: 'Edit', tool_use_id: `e${i}`, file_path: `/x/f${i % 3}.ts`, old_string: 'a', new_string: 'b\nc' })
  expect(state.edits).toHaveLength(40)
  expect(state.written).toEqual({ added: 90, removed: 45, files: ['/x/f0.ts', '/x/f1.ts', '/x/f2.ts'] })

  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', ...PANE, props })
  expect(await ui.find({ key: 'tile:lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+90' })).toMatchObject({ props: { color: 'success' } })
  expect(await ui.find({ type: 'Text', text: '−45' })).toMatchObject({ props: { color: 'error' } })
  expect(await ui.find({ type: 'Text', text: 'lines written / deleted' })).toBeDefined()
  await ui.unmount()
  const term = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  expect(await term.find({ type: 'Text', text: 'lines written / deleted' })).toBeDefined()
  await term.unmount()
})
