import { expect, mock, test } from 'claude-code/testing'

import { catalogFrom, claudeTotal, costOf, matchTurnCost, money, parseAgyUsage, parseCodexTokens, priceKey, priceOf, sessionRows } from '../hooks/cost'
import { fit, marquee } from '../hooks/view'
import { normalGuard } from '../hooks/state'
import type { Costs, TurnCost } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }

test('model ids map to the price list key', async () => {
  expect(priceKey('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  expect(priceKey('opencode-go/kimi-k3')).toBe('kimi-k3')
  expect(priceKey('gemini-3.8-flash-high')).toBe('gemini-3.8-flash')
  expect(priceKey('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
})

test('turn costs match the closest duration within two seconds, newest on a tie', async () => {
  const turns = [
    { durationMs: 10000, usd: 0.4, tokens: 18000, at: 1 },
    { durationMs: 13000, tokens: 2000, at: 2 },
  ]
  expect(matchTurnCost([], 10000)).toBeUndefined()
  expect(matchTurnCost(turns, 10000)).toEqual(turns[0])
  expect(matchTurnCost(turns, 11000)).toEqual(turns[0])
  expect(matchTurnCost(turns, 11500)).toEqual(turns[1])
  expect(matchTurnCost(turns, 8000)).toEqual(turns[0])
  expect(matchTurnCost(turns, 15000)).toEqual(turns[1])
  expect(matchTurnCost(turns, 7999)).toBeUndefined()
  expect(matchTurnCost(turns, 15001)).toBeUndefined()
})

test('Claude totals include cached tokens and leave unpriced totals unknown', async () => {
  const pr = { catalog: {}, overrides: { known: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 } } }
  const t = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }
  expect(claudeTotal({}, pr)).toEqual({ usd: 0, tokens: 0 })
  expect(claudeTotal({ known: t }, pr)).toEqual({ usd: 4.35, tokens: 4e6 })
  expect(claudeTotal({ known: t, unknown: t }, pr)).toEqual({ usd: undefined, tokens: 8e6 })
})

test('a main turn records its own and Claude subagent usage, excluding earlier and side costs', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  let c: Costs = { rows: [{ provider: 'codex', model: 'side', period: 'today', input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0, reported: 100 }], claude: { known: { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 } }, agy: {} }
  let turns: TurnCost[] = Array.from({ length: 50 }, (_, at) => ({ at, durationMs: 1, tokens: 0 }))
  on('state.get', { plugin: 'agent-overview', key: 'costs' }, () => ({ value: { value: c, version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'costs' }, (_$, e) => { c = e.value; return { value: { isSet: true, version: 2 } } })
  on('state.get', { plugin: 'agent-overview', key: 'prices' }, () => ({ value: { value: { catalog: {}, overrides: { known: { input: 1, output: 2 } } }, version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'turnCosts' }, () => ({ value: { value: turns, version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'turnCosts' }, (_$, e) => { turns = e.value; return { value: { isSet: true, version: 2 } } })
  on('state.get', { plugin: 'agent-overview', key: 'nodes' }, () => ({ value: { value: [{ id: 'child', agentId: 'child', label: 'child', model: 'known', kind: 'general-purpose', state: 'done', steps: 0 }], version: 1 } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  await ($.turn as any).start({ text: 'hi', turnId: 'priced' })
  await clock.advance(3000)
  const usage = { model: 'known', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }
  await ($.turn as any).complete({ answer: 'child done', durationMs: 3000, isAborted: false, turnId: 'child-turn', agentId: 'child', reason: 'answer', usage })
  expect(turns.length).toBe(50)
  await clock.advance(1000)
  await ($.turn as any).complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 'priced', reason: 'answer', usage })
  expect(turns.length).toBe(50)
  expect(turns[0]!.at).toBe(1)
  expect(turns[49]).toMatchObject({ at: 5000, durationMs: 4000, tokens: 3200 })
  expect(Math.round(turns[49]!.usd! * 1e6)).toBe(4020)
})

test('turn rules show priced costs and tokens, and gracefully omit missing data', async ($, on) => {
  on('state.get', { plugin: 'agent-overview', key: 'turnCosts' }, () => ({ value: { value: [
    { durationMs: 126000, usd: 0.42, tokens: 18000, at: 1 },
    { durationMs: 30000, tokens: 1500000, at: 2 },
  ], version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 126000 } })
  expect(await ui.find({ type: 'Text', text: /Baked for 2m 6s · ≈\$0.420 · 18k tokens/ })).toBeDefined()
  await ui.unmount()
  const unpriced = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 30000 } })
  expect(await unpriced.find({ type: 'Text', text: /Baked for 30s · 1.5M tokens/ })).toBeDefined()
  await unpriced.unmount()
  const missing = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 60000 } })
  expect(await missing.find({ type: 'Text', text: /tokens|≈/ })).toBeUndefined()
  await missing.unmount()
})

test('logging tools use one quiet chat row and no result row', async ($, on) => {
  let chatLook = true
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: normalGuard({ chatLook }), version: 1 } }))
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text', props: {}, children: ['engine tool'] }))
  on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Text', props: {}, children: ['engine result'] }))
  const row = {
    tool_use_id: 'd1', tool: 'mcp__agent-overview__decision_log', input: { decision: 'Reuse the cache', impact: 'high' }, isRunning: false, isErrored: false, isInterrupted: false,
  }
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'ToolUse', props: row })
  expect(await ui.find({ type: 'Text', text: '▲ decision · Reuse the cache' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '▲ decision · Reuse the cache' }))?.children?.[0]).toMatchObject({ props: { color: 'error' } })
  for (const [tool, kind, text] of [
    ['mcp__agent-overview__qa_log', 'answer', 'Q kept · Colour?'],
    ['mcp__agent-overview__qa_log', 'instruction', 'I kept · Colour?'],
    ['mcp__agent-overview__grill_log', 'answer', 'Q kept · Colour?'],
  ]) {
    await ui.redraw({ ...row, tool: tool!, input: { question: 'Colour?', kind } })
    expect((await ui.find({ type: 'Text', text: text! }))?.text).toBe(text)
  }
  for (const change of [{ tool: 'Read' }, { isErrored: true }, { isInterrupted: true }]) {
    await ui.redraw({ ...row, ...change })
    expect(await ui.find({ type: 'Text', text: 'engine tool' })).toBeDefined()
  }
  chatLook = false
  await ui.redraw(row)
  expect(await ui.find({ type: 'Text', text: 'engine tool' })).toBeDefined()
  await ui.unmount()
  chatLook = true
  const resultRow = { tool_use_id: 'd1', tool: 'mcp__agent-overview__decision_log', output: 'kept', isErrored: false }
  const result = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'ToolResult', props: resultRow })
  expect((await result.findAll({ type: 'Text' })).length).toBe(0)
  await result.redraw({ ...resultRow, isErrored: true })
  expect(await result.find({ type: 'Text', text: 'engine result' })).toBeDefined()
  chatLook = false
  await result.redraw(resultRow)
  expect(await result.find({ type: 'Text', text: 'engine result' })).toBeDefined()
  await result.unmount()
})

test('first-party prices win, and your price beats the catalogue', async () => {
  const json = {
    opencode: { models: { 'kimi-k3': { cost: { input: 9, output: 9 } } } },
    moonshotai: { models: { 'kimi-k3': { cost: { input: 3, output: 15, cache_read: 0.3 } } } },
  }
  const catalog = catalogFrom(json, new Set(['kimi-k3']))
  expect(catalog['kimi-k3']).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: undefined, source: 'moonshotai' })
  const pr = { catalog, overrides: { 'kimi-k3': { input: 1, output: 2 } } }
  expect(priceOf(pr, 'opencode-go/kimi-k3')?.input).toBe(1)
  expect(priceOf(pr, 'opencode-go/kimi-k3')?.edited).toBe(true)
  expect(Math.round(100 * costOf({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 0 }, { input: 3, output: 15, cacheRead: 0.3 })!)).toBe(1830)
  expect(money(18.3)).toBe('$18.30')
  expect(money(0.0042)).toBe('$0.004')
})

test('codex session totals split cached input out', async () => {
  const line = `"model":"gpt-6.1-sol"\t${JSON.stringify({ payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } } } })}`
  expect(parseCodexTokens(`${line}\n${line}\n`)).toEqual([{ provider: 'codex', model: 'gpt-6.1-sol', period: 'today', input: 400, output: 100, cacheRead: 1600, cacheWrite: 0 }])
  expect(parseAgyUsage('{"usage":{"promptTokenCount":120,"candidatesTokenCount":30}}')).toEqual({ input: 120, output: 30, cacheRead: 0 })
  expect(parseAgyUsage('no usage here')).toBeUndefined()
})

test('decisions show on the dashboard without asking anything', async ($, on) => {
  mock.clock(on)
  await ($.tool as any).call({ tool: 'mcp__agent-overview__decision_log', tool_use_id: 'd1', decision: 'Use models.dev for prices', why: 'OpenCode already caches it', impact: 'medium' })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  expect(await ui.find({ type: 'Text', text: /DECISIONS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Use models.dev for prices/ })).toBeDefined()
  expect(await ui.find({ key: 'cost:prices' })).toBeDefined()
  await ui.press({ key: 'cost:prices' })
  expect(await ui.find({ key: 'prices:back' })).toBeDefined()
  await ui.unmount()
})

test('only overflowing decisions have a hidden hover ticker and both lines still fold for why', async ($, on) => {
  mock.clock(on, { now: 2800 })
  const long = 'Use the existing provider cache to avoid repeated network requests for model prices'
  on('state.get', { plugin: 'agent-overview', key: 'decisions' }, () => ({ value: { value: [
    { decision: 'Fits here', why: 'Short reason', impact: 'low', at: 10 },
    { decision: long, why: 'Reuse cached data', impact: 'medium', at: 10 },
  ], version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  // Dashboard half-card: 50 inner columns, leaving 38 for the decision text.
  expect((await ui.find({ key: 'fold:dec:10' }))?.text).toBe('▸')
  expect(await ui.find({ type: 'Text', text: fit(long, 38) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fits here' })).toBeDefined()
  expect(await ui.find({ key: 'hover:fold:dec:10:1' })).toBeUndefined()
  expect((await ui.find({ key: 'hover:fold:dec:10' }))?.text).toBe(marquee(long, 38, 2800))
  const overlays = (await ui.findAll({ type: 'Box' })).filter(x => x.props.position === 'absolute')
  expect(overlays.length).toBe(1)
  expect(overlays[0]?.props).toMatchObject({ top: 0, left: 2, width: 38, height: 1, display: 'none', backgroundColor: 'inverseText' })
  expect(JSON.stringify(await ui.drawn())).toContain('"hover":{"display":"flex"}')
  await ui.press({ key: 'hover:fold:dec:10' })
  expect(await ui.find({ type: 'Text', text: /Reuse cached data/ })).toBeDefined()
  await ui.press({ key: 'fold:dec:10' })
  expect(await ui.find({ type: 'Text', text: /Reuse cached data/ })).toBeUndefined()
  await ui.unmount()
})

test('side-provider cost is what was added since the session began', async () => {
  const row = (model: string, input: number, reported?: number) => ({ provider: 'codex' as const, model, period: 'today' as const, input, output: 0, cacheRead: 0, cacheWrite: 0, reported })
  const base = [row('a', 100, 1), row('same', 50)]
  const now = [row('a', 160, 1.5), row('same', 50), row('new', 20), row('rolled', 5)]
  const got = sessionRows(now, [...base, row('rolled', 900)])
  expect(got.map(r => [r.model, r.input, r.reported, r.period])).toEqual([['a', 60, 0.5, 'session'], ['new', 20, undefined, 'session'], ['rolled', 5, undefined, 'session']])
})
