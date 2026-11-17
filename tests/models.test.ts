import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { HOW, OTHERS, blank, defaultRouting, handoffText, lead, mainOf, normalGuard, normalRouting, presetKey, routingText, tagOf, withPicks, withTag } from '../hooks/state'
import type { Costs, Guard, Providers, Routing } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = (bodyColumns: number) => ({ title: 'Overview', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} })
const routingState = (on: On, initial: Routing) => {
  let r = initial
  on('ui.invalidate', () => ({ value: undefined }))
  on('state.get', { plugin: 'agent-overview', key: 'routing' }, async (_$, e, next) => {
    const result = await next(e)
    return result.value ? { value: { ...result.value, value: r } } : result
  })
  on('state.set', { plugin: 'agent-overview', key: 'routing' }, async (_$, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) r = e.value
    return result
  })
  return () => r
}
const legacy = {
  mode: 'split', weights: { codex: 40, opencode: 60 }, worker: { provider: 'codex', model: 'old-worker' },
  picks: [
    { provider: 'codex', model: 'small', weight: 10 },
    { provider: 'opencode', model: 'smart', weight: 30, effort: 'max', note: '  hard tasks  ' },
    { provider: 'codex', model: 'builder', weight: 20 },
  ],
}
const ownerPicks: Routing['picks'] = [
  { provider: 'claude', model: 'claude-opus-5-5' },
  { provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' },
  { provider: 'opencode', model: 'opencode-go/kimi-k3' },
]
function walk(n: any): any[] {
  if (Array.isArray(n)) return n.flatMap(walk)
  return n && typeof n === 'object' ? [n, ...walk(n.children ?? [])] : []
}
const keyOf = (n: any): string => n.key ?? n.props?.key ?? ''
const textOf = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : n?.children ? textOf(n.children) : ''

test('old percentage saves migrate to stable ranks, valid tags, order defaults and a derived worker', async () => {
  const r = normalRouting(legacy)
  expect(r.picks).toEqual([
    { provider: 'opencode', model: 'smart', effort: 'max', note: 'hard tasks' },
    { provider: 'codex', model: 'builder' },
    { provider: 'codex', model: 'small' },
  ])
  expect(r.tags).toEqual({ codex: 'main' })
  expect(r.useOrder).toBe(true)
  expect(r.worker).toEqual({ provider: 'codex', model: 'builder' })
  expect(r.models.codex).toEqual(['builder', 'small'])
  expect(r.models.opencode).toEqual(['smart'])
  expect(Object.keys(r).includes('mode')).toBe(false)
  expect(Object.keys(r).includes('weights')).toBe(false)
  expect(r.picks.some(x => 'weight' in x)).toBe(false)
  expect(legacy.picks.map(x => x.model)).toEqual(['small', 'smart', 'builder'])
  expect(normalRouting({ ...legacy, picks: legacy.picks.map(x => ({ ...x, weight: 10 })) }).picks.map(x => x.model)).toEqual(['small', 'smart', 'builder'])
  const tags = normalRouting({ tags: { claude: 'main', antigravity: 'main', codex: 'main', opencode: 'saver', commandcode: 'invalid', unknown: 'main' }, useOrder: false })
  expect(tags.tags).toEqual({ claude: 'main', antigravity: 'normal', codex: 'normal', opencode: 'saver' })
  expect(tags.useOrder).toBe(false)
  expect(tags.worker).toBe(null)
  expect(normalRouting({ ...legacy, tags: {} }).tags).toEqual({})
  expect(normalRouting({ ...legacy, worker: { provider: 'unknown', model: 'x' } }).worker).toBe(null)
  expect(normalRouting(normalRouting(legacy))).toEqual(r)
  expect(defaultRouting().tags).toEqual({})
  expect(defaultRouting().useOrder).toBe(true)
  for (const saved of [null, undefined, 0, 2, 'invalid', false]) expect(normalRouting(saved)).toEqual(normalRouting(undefined))
})

test('Main moves between providers, enables work, clears its pause and follows model rank', async () => {
  const r = withPicks(withTag(defaultRouting(), 'claude', 'main'), [
    ...ownerPicks, { provider: 'codex', model: 'second' }, { provider: 'antigravity', model: 'gemini' },
  ])
  const paused = { ...r, on: { ...r.on, codex: false }, paused: { codex: { at: 1, until: 9, why: 'quota' } } }
  const codex = withTag(paused, 'codex', 'main')
  expect(tagOf(codex, 'claude')).toBe('normal')
  expect(tagOf(codex, 'codex')).toBe('main')
  expect(codex.on.codex).toBe(true)
  expect(codex.paused?.codex).toBeUndefined()
  expect(codex.worker).toEqual({ provider: 'codex', model: 'gpt-6.1-sol' })
  const ranked = withPicks(codex, [...codex.picks].reverse())
  expect(ranked.worker).toEqual({ provider: 'codex', model: 'second' })
  expect(mainOf(ranked)).toEqual(ranked.worker)
  expect(withPicks(ranked, ranked.picks.filter(x => x.provider !== 'codex')).worker).toBe(null)
  const agy = withTag({ ...codex, agyVisual: false, agyCoding: false }, 'antigravity', 'main')
  expect(agy.agyCoding).toBe(true)
  expect(agy.on.antigravity).toBe(true)
  expect(tagOf(agy, 'codex')).toBe('normal')
  expect(agy.worker).toEqual({ provider: 'antigravity', model: 'gemini' })
  expect(withTag(agy, 'antigravity', 'saver').worker).toBe(null)
  expect(tagOf(defaultRouting(), 'opencode')).toBe('normal')
  expect(presetKey({ ...ranked, worker: null })).toBe(presetKey(ranked))
  expect(presetKey(withTag(ranked, 'codex', 'saver')) === presetKey(ranked)).toBe(false)
  expect(presetKey({ ...ranked, useOrder: false }) === presetKey(ranked)).toBe(false)
})

test('owner example: Claude Saver above Sol still gives Sol most tasks', async () => {
  const r = withPicks({ ...defaultRouting(), tags: { claude: 'saver' } }, ownerPicks)
  const text = routingText(r)
  expect(text).toContain('Allowed models, smartest first: 1. claude-opus-5-5 on Claude (saver), 2. gpt-6.1-sol (xhigh) on Codex')
  expect(text).toContain('gpt-6.1-sol (xhigh) on Codex (#2), takes most delegated tasks')
  expect(text).toContain('Saver providers, conserve their usage: Claude.')
  expect(text).toContain("only when a task needs that model's ability or the others failed or ran out")
  expect(text).not.toContain('is a small side task a Normal provider can take')
  expect(text).toContain("Claude is Saver: hand work to the other models rather than doing it yourself or in Claude subagents, unless a task needs Claude's ability.")
  expect(text.includes('claude-opus-5-5 on Claude (#1), takes most')).toBe(false)
  expect(/split|share|%/i.test(text)).toBe(false)
  expect(lead(r)).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol', main: false })
})

test('owner example: Codex Main gets Sol while Normal providers remain available', async () => {
  const r = withPicks({ ...defaultRouting(), tags: { codex: 'main', claude: 'normal' }, on: { ...defaultRouting().on, antigravity: false } }, [...ownerPicks, { provider: 'commandcode', model: 'moonshotai/kimi-k3' }])
  const text = routingText(r)
  expect(text).toContain('Main provider: Codex. It takes most delegated tasks through gpt-6.1-sol (xhigh) on Codex, #2 in the list')
  expect(text).toContain('Normal providers, use as you see fit for any task they suit: Claude, OpenCode, Command Code.')
  expect(text.includes('Saver providers')).toBe(false)
  expect(text).toContain('gpt-6.1-sol (xhigh) on Codex (main)')
  expect(text).toContain('Delegate only to these. Match the model to how hard the task is')
  expect(text).toContain('Provider order, for ties between models that can do a task')
  expect(text).toContain('OpenCode > Command Code > Codex.')
  expect(routingText({ ...r, useOrder: false })).toContain('Provider order is off: choose by model ability and the tags above only.')
  expect(/split|share|%/i.test(text)).toBe(false)
})

test('unusable Main falls back, cap demotion applies, and all Saver has no lead', async () => {
  const r = withPicks(withTag(defaultRouting(), 'codex', 'main'), ownerPicks)
  const off = { ...r, on: { ...r.on, codex: false } }
  const paused = { ...r, paused: { codex: { at: 1, until: 9, why: 'quota' } } }
  for (const text of [routingText(off), routingText(paused), routingText(r, {}, [{ p: 'codex', spent: 6, cap: 5 }])]) {
    expect(text.includes('Main provider: Codex')).toBe(false)
    expect(text).toContain('The main provider, Codex, is unavailable right now (')
    expect(text).not.toContain('No main provider is set')
    expect(text).toContain('claude-opus-5-5 on Claude (#1), takes most delegated tasks')
  }
  const caps = routingText(r, {}, [{ p: 'codex', spent: 6, cap: 5 }])
  expect(caps).toContain("Over the owner's spend cap, so use them last: Codex ($6.00 of $5).")
  expect(caps).toContain('Antigravity > OpenCode > Command Code > Codex.')
  const allSaver = { ...r, tags: Object.fromEntries(['claude', ...OTHERS].map(p => [p, 'saver'])) } as Routing
  expect(lead(allSaver)).toBeUndefined()
  expect(routingText(allSaver).includes('takes most delegated tasks')).toBe(false)
  expect(handoffText({ ...withTag(allSaver, 'codex', 'normal'), role: 'plan' })).toContain('Implementation work goes to the default model, gpt-6.1-sol (xhigh) on Codex')
  expect(lead({ ...r, role: 'claude' })).toBeUndefined()
  const noPicks = withTag(defaultRouting(), 'opencode', 'main')
  expect(noPicks.worker).toBe(null)
  expect(lead(noPicks)).toBeUndefined()
  expect(routingText(noPicks)).not.toContain('Main provider: OpenCode')
  expect(lead({ ...r, picks: r.picks.filter(p => p.provider !== 'codex') })).toMatchObject({ provider: 'claude', main: false })
  const agy = withPicks(withTag(defaultRouting(), 'antigravity', 'main'), [{ provider: 'antigravity', model: 'gemini' }, ...ownerPicks])
  expect(lead({ ...agy, agyCoding: false, agyVisual: false })).toMatchObject({ provider: 'claude', main: false })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`saved presets migrate legacy routing on ${surface}`, { timeoutMs: 15000 }, async ($, on) => {
    mock.clock(on)
    let persisted: unknown
    on('store.set', { key: 'routing' }, (_$, e, next) => { persisted = e.value; return next(e) })
    mock.store(on, { presets: [{ name: 'Legacy', routing: legacy }] })
    const getRouting = routingState(on, defaultRouting())
    on('state.get', { plugin: 'agent-overview', key: 'presets' }, () => ({ value: { value: [{ name: 'Legacy', routing: legacy }], version: 0 } }))
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props: props(110) })
    await ui.press({ key: 'tab:models' })
    await ui.redraw()
    await ui.press({ key: 'preset:saved:Legacy' })
    expect(getRouting()).toEqual(normalRouting(legacy))
    expect(persisted).toEqual(normalRouting(legacy))
    await ui.unmount()
  })

  for (const width of [110, 64]) {
    test(`Models columns and controls on ${surface} at ${width} columns`, { timeoutMs: 15000 }, async ($, on) => {
      mock.clock(on)
      mock.store(on)
      const getRouting = routingState(on, withPicks(defaultRouting(), [
        ...ownerPicks, { provider: 'codex', model: 'fallback' }, { provider: 'commandcode', model: 'moonshotai/kimi-k3' }, { provider: 'antigravity', model: 'gemini' },
      ]))
      const all: Providers = {
        claude: { ...blank(), meters: [{ label: 'Context', percent: 100 }, { label: 'Weekly', percent: 40, detail: 'resets in 3h' }] },
        codex: { ...blank(), models: [{ id: 'gpt-6.1-sol', efforts: ['medium', 'xhigh'] }] },
        opencode: { ...blank(), models: [{ id: 'opencode-go/kimi-k3', efforts: ['low', 'max'] }], facts: ['$2 spent in 7 days'] },
        commandcode: { ...blank(), facts: ['54 monthly credits left'] }, antigravity: { ...blank(), alert: 'quota hit' }, ollama: blank(),
      }
      on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: all, version: 1 } }))
      const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props: props(width) })
      await ui.press({ key: 'tab:models' })
      for (const title of ['CHAT', 'PRESETS', 'MODELS', 'PROVIDERS']) expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
      const tree = walk(await ui.drawn())
      expect(tree.some(n => /^seg:SEND:|^main:/.test(keyOf(n)))).toBe(false)
      const narrow = width < 80
      const mcols = narrow ? ['rank', 'model', 'effort', 'act'] : ['rank', 'model', 'prov', 'effort', 'act']
      const pcols = ['rank', 'on', 'name', 'usage', 'tag', 'act']
      for (const [prefix, cols, rows] of [['mcol', mcols, getRouting().picks.length], ['pcol', pcols, 6]] as const) {
        for (const col of cols) {
          const boxes = tree.filter(n => keyOf(n).startsWith(`${prefix}:${col}:`))
          expect(boxes.length).toBe(rows)
          expect(boxes.every(n => n.type === 'Box' && typeof n.props.width === 'number' && n.props.flexShrink === 0)).toBe(true)
          expect(new Set(boxes.map(n => n.props.width)).size).toBe(1)
        }
      }
      for (const [prefix, cols] of [['mcol', mcols], ['pcol', pcols]] as const) {
        const total = cols.reduce((n, col) => n + tree.find(n => keyOf(n).startsWith(`${prefix}:${col}:`)).props.width, cols.length - 1)
        expect(total <= width - 4).toBe(true)
      }
      expect(tree.filter(n => keyOf(n).startsWith('pick:')).every(n => !walk(n).some(x => x.props?.flexWrap === 'wrap'))).toBe(true)
      for (const [key, levels] of [
        ['claude/claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
        ['codex/gpt-6.1-sol', ['medium', 'xhigh']], ['codex/fallback', ['low', 'medium', 'high', 'xhigh', 'max']],
        ['opencode/opencode-go/kimi-k3', ['low', 'max']], ['commandcode/moonshotai/kimi-k3', ['low', 'medium', 'high']],
      ] as [string, string[]][]) {
        const effort = await ui.find({ key: `effort:${key}` })
        expect(effort?.type).toBe('Select')
        expect(effort?.props.options).toEqual(['default', ...levels].map(value => ({ value })))
        expect(walk(tree.find(n => keyOf(n) === `mcol:effort:${key}`)).some(n => keyOf(n) === `effort:${key}`)).toBe(true)
        await ui.select({ key: `effort:${key}`, value: levels[0]! })
        expect(getRouting().picks.find(x => `${x.provider}/${x.model}` === key)?.effort).toBe(levels[0])
        await ui.select({ key: `effort:${key}`, value: 'default' })
        expect(getRouting().picks.find(x => `${x.provider}/${x.model}` === key)?.effort).toBeUndefined()
      }
      expect(await ui.find({ key: 'effort:antigravity/gemini' })).toBeUndefined()
      const quota = surface === 'desktop' && !narrow ? String((await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('Claude '))?.props.alt) : textOf(await ui.find({ key: 'pcol:usage:claude' }))
      expect(quota).toContain('60%')
      expect(quota).not.toContain('resets in 3h')
      expect(textOf(await ui.find({ key: 'pcol:usage:commandcode' }))).toContain('54 credits left')
      expect(textOf(await ui.find({ key: 'pcol:usage:opencode' }))).toContain('$2 this week')
      expect(textOf(await ui.find({ key: 'pcol:usage:antigravity' }))).toContain(narrow ? 'out' : 'quota hit')
      if (narrow) expect(await ui.find({ type: 'Text', text: 'Antigravity · quota hit' })).toBeDefined()
      await ui.select({ key: 'tag:claude', value: 'main' })
      await ui.select({ key: 'tag:codex', value: 'main' })
      expect(getRouting().tags).toMatchObject({ claude: 'normal', codex: 'main' })
      expect(getRouting().worker).toEqual({ provider: 'codex', model: 'gpt-6.1-sol' })
      if (narrow) await ui.press({ key: 'open:codex' })
      await ui.press({ key: 'up:codex/fallback' })
      await ui.press({ key: 'up:codex/fallback' })
      expect(getRouting().worker).toEqual({ provider: 'codex', model: 'fallback' })
      if (narrow) await ui.press({ key: 'edit:back' })
      const order = [...getRouting().order]
      if (narrow) await ui.press({ key: `open:${order[0]}` })
      await ui.press({ key: `pdown:${order[0]}` })
      expect(getRouting().order.slice(0, 2)).toEqual([order[1], order[0]])
      await ui.press({ key: `pup:${order[0]}` })
      expect(getRouting().order).toEqual(order)
      if (narrow) await ui.press({ key: 'edit:back' })
      await ui.press({ key: 'useOrder' })
      expect(getRouting().useOrder).toBe(false)
      expect(textOf(await ui.find({ key: 'pcol:rank:codex' }))).toBe('')
      await ui.press({ key: 'useOrder' })
      expect(getRouting().useOrder).toBe(true)
      expect(await ui.find({ key: 'pup:claude' })).toBeUndefined()
      expect(await ui.find({ key: 'on:claude' })).toBeUndefined()
      await ui.unmount()
    })
  }

  for (const [label, caps, expected] of [
    ['no caps', {}, undefined],
    ['Codex cap', { codex: 5 }, '$1.20 / $5 a day'],
    ['cap without a cost block', { claude: 3 }, '$0 / $3 per chat'],
  ] as [string, Guard['caps'], string | undefined][]) {
    test(`Cost shows only ${label} as plain text on ${surface}`, async ($, on) => {
      mock.clock(on)
      mock.store(on)
      const g = normalGuard({ caps })
      const c: Costs = { rows: [
        { provider: 'codex', model: 'gpt', period: 'today', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reported: 1.2 },
        { provider: 'opencode', model: 'kimi', period: 'today', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reported: 2 },
      ], base: [], claude: {}, agy: {} }
      on('state.get', { plugin: 'agent-overview', key: 'costs' }, () => ({ value: { value: c, version: 1 } }))
      on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: g, version: 1 } }))
      const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props: props(110) })
      expect(await ui.find({ key: 'cost:codex' })).toBeDefined()
      expect(await ui.find({ key: 'cost:opencode' })).toBeDefined()
      expect(walk(await ui.drawn()).some(n => keyOf(n).startsWith('cap:'))).toBe(false)
      const lines = await ui.findAll({ type: 'Text', text: /^\$[\d.]+ \/ \$[\d.]+ (?:a day|per chat)$/ })
      expect(lines.length).toBe(expected ? 1 : 0)
      if (expected) {
        const cap = lines[0]
        expect(cap?.type).toBe('Text')
        expect(cap?.text).toBe(expected)
      } else expect(await ui.find({ type: 'Text', text: /\$ cap|cap / })).toBeUndefined()
      await ui.unmount()
    })
  }

  test(`Settings adds, edits and clears spend caps on ${surface}`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let g: Guard = normalGuard(undefined)
    const invalidated: string[] = []
    on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: g, version: 1 } }))
    on('state.set', { plugin: 'agent-overview', key: 'guard' }, (_$, e) => { g = e.value; return { value: { isSet: true, version: 2 } } })
    on('ui.invalidate', (_$, e) => { invalidated.push(e.event); return { value: undefined } })
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props: props(64) })
    await ui.press({ key: 'tab:settings' })
    expect(await ui.find({ type: 'Text', text: 'no caps' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'set caps in the Cost card' })).toBeUndefined()
    await ui.press({ key: 'cap:add' })
    expect((await ui.find({ key: 'cap:provider' }))?.type).toBe('Select')
    expect(await ui.find({ key: 'capinput:claude' })).toBeDefined()
    await ui.press({ key: 'cap:add' })
    expect(await ui.find({ key: 'cap:provider' })).toBeUndefined()
    await ui.press({ key: 'cap:add' })
    await ui.select({ key: 'cap:provider', value: 'opencode' })
    await ui.input({ key: 'capinput:opencode', text: '7' })
    expect(g.caps.opencode).toBe(7)
    expect((await ui.find({ key: 'cap:opencode' }))?.text).toBe('OpenCode  $7 a day')
    expect(await ui.find({ key: 'cap:provider' })).toBeUndefined()
    expect(invalidated.includes('prompt.section')).toBe(true)
    await ui.press({ key: 'cap:opencode' })
    expect((await ui.find({ key: 'capinput:opencode' }))?.props.value).toBe('7')
    await ui.input({ key: 'capinput:opencode', text: '' })
    expect(g.caps.opencode).toBeUndefined()
    expect(await ui.find({ key: 'cap:opencode' })).toBeUndefined()
    expect(await ui.find({ key: 'capinput:opencode' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'no caps' })).toBeUndefined()
    await ui.unmount()
  })
}


test('routing without picks respects the disabled provider order', () => {
  const r = { ...defaultRouting(), useOrder: false }
  const text = routingText(r)
  expect(text).toContain('Provider order is off')
  expect(text).not.toContain('first one first')
  expect(text).not.toMatch(/\d+\. (?:Antigravity|Codex|OpenCode|Command Code)/)
})

test('routing names each unavailable Main reason and states Normal guidance once', () => {
  const r = withPicks(withTag(defaultRouting(), 'codex', 'main'), ownerPicks)
  const cases: [Routing, string, { p: 'codex'; spent: number; cap: number }[]][] = [
    [{ ...r, on: { ...r.on, codex: false } }, 'turned off', []],
    [{ ...r, paused: { codex: { at: 1, until: 9, why: 'quota' } } }, 'auto-paused after running out of quota', []],
    [r, 'over its spend cap', [{ p: 'codex', spent: 6, cap: 5 }]],
    [withPicks(r, ownerPicks.filter(p => p.provider !== 'codex')), 'no allowed model', []],
    [{ ...r, tags: { claude: 'main' }, role: 'plan' }, 'Claude is under Plans only', []],
  ]
  for (const [route, reason, cap] of cases) {
    const text = routingText(route, {}, cap), main = reason.startsWith('Claude') ? 'Claude' : 'Codex'
    expect(text).toContain(`The main provider, ${main}, is unavailable right now (${reason}), so `)
    expect(text).not.toContain('No main provider is set')
    expect(text.match(/Normal providers, use as you see fit/g)).toHaveLength(1)
  }
  const noFallback = withPicks(withTag(defaultRouting(), 'codex', 'main'), [])
  expect(routingText(noFallback)).toContain('Codex, is unavailable right now (no allowed model)')
})

for (const surface of ['terminal', 'desktop'] as const) test(`Main without an allowed model keeps the fixed tag column (${surface})`, async ($, on) => {
  mock.clock(on); mock.store(on)
  routingState(on, withTag(defaultRouting(), 'codex', 'main'))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props: props(110) })
  await ui.press({ key: 'tab:models' })
  expect((await ui.find({ key: 'tag:codex' }))?.props.options).toContainEqual({ value: 'main', label: 'Main' })
  for (const p of ['claude', ...OTHERS]) expect((await ui.find({ key: `pcol:tag:${p}` }))?.props.width).toBe(surface === 'desktop' ? 13 : 10)
  expect(await ui.find({ type: 'Text', text: /no allowed model/ })).toBeDefined()
  await ui.unmount()
})


test('owner example (a) with Codex over cap chooses a different Normal provider', () => {
  const r = withPicks({ ...defaultRouting(), tags: { codex: 'main', claude: 'saver' } }, ownerPicks)
  expect(lead(r, ['codex'])).toMatchObject({ provider: 'opencode', model: 'opencode-go/kimi-k3', main: false })
  const text = routingText(r, {}, [{ p: 'codex', spent: 6, cap: 5 }])
  expect(text).toContain('Codex, is unavailable right now (over its spend cap)')
  expect(text).toContain('the smartest allowed model on another provider that is not Saver')
  expect(text).toContain('opencode-go/kimi-k3 on OpenCode (#2), takes most delegated tasks')
  expect(text).not.toContain('gpt-6.1-sol (xhigh) on Codex (#3), takes most delegated tasks')
  const alone = withPicks(r, ownerPicks.filter(x => x.provider !== 'opencode'))
  expect(lead(alone, ['codex'])).toBeUndefined()
})
