import type { On } from 'claude-code'
import { effortsOf } from '../hooks/providers'
import { expect, mock, test } from 'claude-code/testing'

import type { AgentNode, Provider, Routing } from '../types'
import { externalOf } from '../hooks/register'
import { HOW, blank, defaultRouting, handoffList, handoffText, normalRouting, routingText, withFlags, withPicks, withTag } from '../hooks/state'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }
const routingState = (on: On, initial: Routing) => {
  let r = initial
  on('state.get', { plugin: 'agent-overview', key: 'routing' }, async (_$, e, next) => {
    const result = await next(e)
    if (!result.value) return result
    return { value: { ...result.value, value: r } }
  })
  on('state.set', { plugin: 'agent-overview', key: 'routing' }, async (_$, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) r = e.value
    return result
  })
  return () => r
}

test('saved picks keep short efforts and withPicks preserves them', async () => {
  for (const effort of ['high', 'abcdefghijkl', '', undefined, 3, 'abcdefghijklm']) {
    const r = normalRouting({ picks: [{ provider: 'codex', model: 'gpt', effort }] })
    expect(r.picks[0]!.effort).toBe(typeof effort === 'string' && effort.length <= 12 ? effort : undefined)
    expect(withPicks(defaultRouting(), r.picks).picks).toEqual(r.picks)
  }
})

test('routing and Plans-only handoffs carry the effort and CLI flags', async () => {
  const r = withPicks(defaultRouting(), [{ provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' }])
  expect(routingText(r)).toContain('1. gpt-6.1-sol (high) on Codex')
  const list = '1. gpt-6.1-sol (high) on Codex via `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high "<task>" < /dev/null`'
  expect(handoffList(r)).toBe(list)
  expect(handoffText({ ...r, role: 'plan' })).toContain(list)
  expect(HOW.opencode('p/m', 'max')).toContain('opencode run -m p/m --variant max "<task>"')
  expect(HOW.commandcode('p/m', 'low')).toContain('--model p/m --effort low')
  expect(HOW.codex('gpt')).toBe('`codex exec -m gpt "<task>" < /dev/null`')
  expect(HOW.opencode('p/m')).toContain('opencode run -m p/m "<task>"')
  expect(HOW.commandcode('p/m')).toContain('with --model p/m (see')
  expect(HOW.claude('claude', 'high')).toBe('the Agent tool with model "claude" and effort "high"')
  expect(HOW.antigravity('gemini-high', 'high')).toBe(HOW.antigravity('gemini-high'))
})

test('the Main provider gets most tasks in auto and plan, with its live rank and effort', async () => {
  const r = withPicks(withTag(defaultRouting(), 'codex', 'main'), [
    { provider: 'claude', model: 'opus' },
    { provider: 'opencode', model: 'strong' },
    { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
    { provider: 'opencode', model: 'small' },
  ])
  for (const role of ['auto', 'plan'] as const) {
    const text = routingText({ ...r, role })
    expect(text).toContain(`Main provider: Codex. It takes most delegated tasks through gpt-6.1-sol (high) on Codex, #${role === 'auto' ? 3 : 2} in the list, run with ${HOW.codex('gpt-6.1-sol', 'high')}. Give each task to it by default, in one complete run with the context it needs, then check the result.`)
    expect(text).toContain('use as you see fit for any task they suit')
  }
  expect(routingText({ ...r, role: 'claude' }).includes('Main provider:')).toBe(false)
  expect(routingText({ ...r, on: { ...r.on, codex: false } }).includes('Main provider:')).toBe(false)
  expect(handoffText({ ...r, role: 'plan' })).toContain('Implementation work goes to the main model, gpt-6.1-sol (high) on Codex, #2 in the list above')
})

test('a Claude Main is used in auto and falls back to the first live side model in plan', async () => {
  const r = normalRouting({ ...defaultRouting(), tags: { claude: 'main' }, on: { ...defaultRouting().on, codex: false }, picks: [
    { provider: 'claude', model: 'opus' },
    { provider: 'codex', model: 'off' },
    { provider: 'opencode', model: 'p/m', effort: 'max' },
  ] })
  expect(r.worker).toEqual({ provider: 'claude', model: 'opus' })
  expect(routingText(r)).toContain('Main provider: Claude. It takes most delegated tasks through opus on Claude, #1 in the list, run with the Agent tool with model "opus"')
  const plan = { ...r, role: 'plan' as const }
  expect(routingText(plan)).toContain(`p/m (max) on OpenCode (#1), takes most delegated tasks, run with ${HOW.opencode('p/m', 'max')}`)
  expect(handoffText(plan)).toContain('Implementation work goes to the default model, p/m (max) on OpenCode, #1 in the list above')
  const off = { ...plan, on: { ...plan.on, opencode: false } }
  expect(routingText(off).includes('takes most delegated tasks')).toBe(false)
  expect(handoffText(off)?.includes('Implementation work goes')).toBe(false)
})

test('withFlags fills each missing flag without replacing explicit choices', async () => {
  const cases: [Provider, string, string, string][] = [
    ['codex', 'codex exec', '-m gpt', '-c model_reasoning_effort=high'],
    ['codex', 'codex e', '-m gpt', '-c model_reasoning_effort=high'],
    ['opencode', 'opencode run', '-m gpt', '--variant high'],
    ['commandcode', 'command-code', '--model gpt', '--effort high'],
    ['commandcode', 'cmd', '--model gpt', '--effort high'],
  ]
  for (const [p, program, model, effort] of cases) {
    const pick = { model: 'gpt', effort: 'high' }
    const stdin = p === 'codex' ? ' < /dev/null' : ''
    expect(withFlags(`${program} "task"`, p, pick)).toBe(`${program} ${model} ${effort}${stdin} "task"`)
    expect(withFlags(`${program} ${model} "task"`, p, pick)).toBe(`${program} ${effort}${stdin} ${model} "task"`)
    expect(withFlags(`${program} ${effort} "task"`, p, pick)).toBe(`${program} ${model}${stdin} ${effort} "task"`)
    const explicit = `${program}${stdin} ${model.replace('gpt', 'other')} ${effort.replace('high', 'low')} "task"`
    expect(withFlags(explicit, p, pick)).toBe(explicit)
    expect(withFlags(`${program} "task"`, p, {})).toBe(`${program}${stdin} "task"`)
  }
  const pick = { model: 'gpt', effort: 'high' }
  expect(withFlags('cd x && codex exec "task"', 'codex', pick)).toBe('cd x && codex exec -m gpt -c model_reasoning_effort=high < /dev/null "task"')
  expect(withFlags('codex --cd "x y" exec "task"', 'codex', pick)).toBe('codex --cd "x y" exec -m gpt -c model_reasoning_effort=high < /dev/null "task"')
  expect(withFlags('codex exec --model=other --config="model_reasoning_effort=low" "task"', 'codex', pick)).toBe('codex exec < /dev/null --model=other --config="model_reasoning_effort=low" "task"')
  expect(withFlags('opencode run --model=other --variant=low "task"', 'opencode', pick)).toBe('opencode run --model=other --variant=low "task"')
  expect(withFlags('cmd --model=other --effort=low "task"', 'commandcode', pick)).toBe('cmd --model=other --effort=low "task"')
  expect(withFlags('codex exec "explain -m other and -c model_reasoning_effort=low"', 'codex', pick)).toBe('codex exec -m gpt -c model_reasoning_effort=high < /dev/null "explain -m other and -c model_reasoning_effort=low"')
  expect(withFlags('codex exec "task" && echo --model other', 'codex', pick)).toBe('codex exec -m gpt -c model_reasoning_effort=high < /dev/null "task" && echo --model other')
  const wrapper = 'CC="/Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs"; node "$CC"'
  expect(withFlags(`${wrapper} -p hi`, 'commandcode', pick)).toBe(`${wrapper} --model gpt --effort high -p hi`)
  expect(withFlags('echo "codex exec task"', 'codex', pick)).toBe('echo "codex exec task"')
  expect(withFlags('codex exec "task"', 'antigravity', pick)).toBe('codex exec "task"')
  expect(externalOf('cd x && codex exec -m gpt -c model_reasoning_effort=high "task"')).toEqual({ provider: 'codex', model: 'gpt', effort: 'high' })
})

test('effort dropdowns select model-specific and fallback levels and clear to default', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const getRouting = routingState(on, withPicks(defaultRouting(), [
    { provider: 'codex', model: 'custom' },
    { provider: 'codex', model: 'fallback' },
    { provider: 'opencode', model: 'p/m' },
    { provider: 'commandcode', model: 'p/m' },
    { provider: 'claude', model: 'claude' },
    { provider: 'antigravity', model: 'gemini-high' },
  ]))
  const all = { claude: { ...blank(), models: [{ id: 'claude', efforts: ['medium', 'max'] }] }, codex: { ...blank(), models: [{ id: 'custom', efforts: ['medium', 'xhigh'] }] }, commandcode: blank(), opencode: blank(), antigravity: blank() }
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: all, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'tab:models' })
  for (const [key, levels] of [
    ['codex/custom', ['medium', 'xhigh']],
    ['codex/fallback', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['opencode/p/m', ['minimal', 'low', 'medium', 'high', 'max']],
    ['commandcode/p/m', ['low', 'medium', 'high']],
    ['claude/claude', ['medium', 'max']],
  ] as [string, string[]][]) {
    for (const level of [...levels, undefined]) {
      await ui.select({ key: `effort:${key}`, value: level ?? 'default' })
      expect(getRouting().picks.find(x => `${x.provider}/${x.model}` === key)!.effort).toBe(level)
      expect((await ui.find({ key: `effort:${key}` }))?.props.value).toBe(level ?? 'default')
    }
  }
  await ui.select({ key: 'effort:claude/claude', value: 'max' })
  expect(routingText(getRouting())).toContain('Agent tool with model "claude" and effort "max"')
  expect(await ui.find({ key: 'effort:antigravity/gemini-high' })).toBeUndefined()
  await ui.unmount()
})

test('provider tags keep role and can clear Main in every role', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const getRouting = routingState(on, withPicks(defaultRouting(), [{ provider: 'codex', model: 'gpt' }]))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'tab:models' })
  for (const role of ['auto', 'plan', 'claude'] as const) {
    await ui.press({ key: `seg:CLAUDE:${role}` })
    await ui.press({ key: 'open:codex' })
    await ui.select({ key: 'tag:codex', value: 'main' })
    expect(getRouting().worker).toEqual({ provider: 'codex', model: 'gpt' })
    expect(getRouting().role).toBe(role)
    await ui.select({ key: 'tag:codex', value: 'normal' })
    expect(getRouting().worker).toBe(null)
    expect(getRouting().role).toBe(role)
    await ui.press({ key: 'edit:back' })
    expect(await ui.find({ key: 'tag:codex' })).toBeDefined()
    expect(await ui.find({ key: 'main:clear' })).toBeUndefined()
  }
  await ui.unmount()
})

test('provider tags preserve roles, title uses derived Main, and removal clears it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const getRouting = routingState(on, withPicks(defaultRouting(), [
    { provider: 'claude', model: 'opus' },
    { provider: 'codex', model: 'gpt' },
  ]))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'tab:models' })
  for (const role of ['auto', 'plan', 'claude'] as const) {
    await ui.press({ key: `seg:CLAUDE:${role}` })
    await ui.select({ key: 'tag:codex', value: 'main' })
    expect(getRouting().worker).toEqual({ provider: 'codex', model: 'gpt' })
    expect(getRouting().role).toBe(role)
    expect((await ui.find({ key: 'tag:codex' }))?.props.value).toBe('main')
    if (role === 'claude') expect(await ui.find({ type: 'Text', text: /⇢ gpt/ })).toBeUndefined()
    else expect(await ui.find({ type: 'Text', text: /⇢ gpt/ })).toBeDefined()
    await ui.select({ key: 'tag:codex', value: 'normal' })
    expect(getRouting().worker).toBe(null)
    expect(getRouting().role).toBe(role)
    expect((await ui.find({ key: 'tag:codex' }))?.props.value).toBe('normal')
  }
  await ui.press({ key: 'seg:CLAUDE:plan' })
  await ui.select({ key: 'tag:claude', value: 'main' })
  expect(getRouting().worker).toEqual({ provider: 'claude', model: 'opus' })
  expect(getRouting().role).toBe('plan')
  expect(await ui.find({ type: 'Text', text: /⇢ opus/ })).toBeUndefined()
  await ui.press({ key: 'seg:CLAUDE:auto' })
  expect(await ui.find({ type: 'Text', text: /⇢ opus/ })).toBeDefined()
  await ui.select({ key: 'tag:codex', value: 'main' })
  await ui.press({ key: 'open:codex' })
  await ui.press({ key: 'pon:codex' })
  expect(await ui.find({ type: 'Text', text: /⇢ gpt/ })).toBeUndefined()
  await ui.press({ key: 'pon:codex' })
  await ui.press({ key: 'edit:back' })
  await ui.press({ key: 'del:codex/gpt' })
  expect(getRouting().worker).toBe(null)
  expect(getRouting().picks.map(x => x.model)).toEqual(['opus'])
  await ui.select({ key: 'tag:claude', value: 'main' })
  await ui.press({ key: 'open:claude' })
  await ui.press({ key: 'mdel:opus' })
  expect(getRouting().worker).toBe(null)
  expect(getRouting().picks.length).toBe(0)
  await ui.unmount()
})

test('Bash enforces the matching pick or first live pick and draws the actual effort', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  routingState(on, withPicks(defaultRouting(), [
    { provider: 'codex', model: 'first', effort: 'low' },
    { provider: 'codex', model: 'second', effort: 'high' },
    { provider: 'opencode', model: 'p/m', effort: 'max' },
    { provider: 'commandcode', model: 'p/m', effort: 'medium' },
  ]))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  let seen = ''
  let nodes: AgentNode[] = []
  on('state.set', { plugin: 'agent-overview', key: 'nodes' }, (_$, e, next) => { nodes = e.value; return next(e) })
  on('tool.call', (_$, e) => { seen = String((e as any).command); return { result: 'ok' } })
  const cases = [
    ['codex exec "task"', 'codex exec -m first -c model_reasoning_effort=low < /dev/null "task"', 'first', 'low'],
    ['cd x && codex exec -m second "task"', 'cd x && codex exec -c model_reasoning_effort=high < /dev/null -m second "task"', 'second', 'high'],
    ['codex exec -m other "task"', 'codex exec -c model_reasoning_effort=low < /dev/null -m other "task"', 'other', 'low'],
    ['codex exec -m second -c model_reasoning_effort=xhigh "task"', 'codex exec < /dev/null -m second -c model_reasoning_effort=xhigh "task"', 'second', 'xhigh'],
    ["nohup sh -c 'codex exec -m second \"task\"' > log 2>&1 &", "nohup sh -c 'codex exec -c model_reasoning_effort=high < /dev/null -m second \"task\"' > log 2>&1 &", 'second', 'high'],
    ['opencode run "task"', 'opencode run -m p/m --variant max "task"', 'p/m', 'max'],
    ['cmd -p "task"', 'cmd --model p/m --effort medium -p "task"', 'p/m', 'medium'],
  ]
  for (const [command, sent, model, effort] of cases) {
    await ($.tool as any).call({ tool: 'Bash', tool_use_id: `run:${model}:${effort}`, command })
    expect(seen).toBe(command!.endsWith('&') ? sent!.replace('codex exec', `env AO_RUN=run:${model}:${effort} codex exec`) : sent)
    expect(nodes[nodes.length - 1]).toMatchObject({ model, effort })
  }
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'gopen:run:p/m:medium' })
  expect(await ui.find({ type: 'Text', text: /p\/m · medium/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● p\/m · medium/ })).toBeDefined()
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'chip:list' })
  expect(await ui.find({ type: 'Text', text: /p\/m · medium/ })).toBeDefined()
  await ui.unmount()
})

test('Codex effort levels come from the app-server list, in either shape', async () => {
  expect(effortsOf([{ reasoningEffort: 'low' }, { reasoningEffort: 'max' }, 'ultra'])).toEqual(['low', 'max', 'ultra'])
  expect(effortsOf([{}])).toBeUndefined()
  expect(effortsOf(undefined)).toBeUndefined()
})

test('withFlags inserts into the original -c shell word without changing expansion or quoting', () => {
  const command = String.raw`P=$(cat prompt.md); nohup sh -c "codex exec \"$P\"" > log 2>&1 &`
  expect(withFlags(command, 'codex', { model: 'gpt', effort: 'high' })).toBe(String.raw`P=$(cat prompt.md); nohup sh -c "codex exec -m gpt -c model_reasoning_effort=high < /dev/null \"$P\"" > log 2>&1 &`)
  const literal = String.raw`nohup sh -c "codex exec \"\$LITERAL $EXPAND\"" &`
  expect(withFlags(literal, 'codex', { model: 'gpt' })).toBe(String.raw`nohup sh -c "codex exec -m gpt < /dev/null \"\$LITERAL $EXPAND\"" &`)
  const nested = String.raw`bash -c 'nohup sh -c "codex exec \"$P\""' &`
  expect(withFlags(nested, 'codex', { model: 'gpt' })).toBe(String.raw`bash -c 'nohup sh -c "codex exec -m gpt < /dev/null \"$P\""' &`)
})


test('run markers prefix the actual CLI inside wrappers while preserving shell quoting and flags', () => {
  const pick = { model: 'gpt', effort: 'high', run: 'tool:marker' }
  const commands = [
    ['codex exec "task; (résumé)" & echo $!', 'env AO_RUN=tool:marker codex exec -m gpt -c model_reasoning_effort=high < /dev/null "task; (résumé)" & echo $!'],
    [String.raw`P=$(cat f); nohup sh -c "codex exec \"$P\"" & disown`, String.raw`P=$(cat f); nohup sh -c "env AO_RUN=tool:marker codex exec -m gpt -c model_reasoning_effort=high < /dev/null \"$P\"" & disown`],
    [String.raw`bash -c 'nohup sh -c "codex exec \"$P\""' &`, String.raw`bash -c 'nohup sh -c "env AO_RUN=tool:marker codex exec -m gpt -c model_reasoning_effort=high < /dev/null \"$P\""' &`],
    ['nohup codex exec "task" &', 'nohup env AO_RUN=tool:marker codex exec -m gpt -c model_reasoning_effort=high < /dev/null "task" &'],
  ]
  for (const [command, expected] of commands) {
    const got = withFlags(command!, 'codex', pick)
    expect(got).toBe(expected)
    expect(withFlags(got, 'codex', pick)).toBe(got)
  }
  expect(withFlags('opencode run "task"', 'opencode', { run: 'tool:marker' })).toBe('env AO_RUN=tool:marker opencode run "task"')
  expect(withFlags('cmd -p "task"', 'commandcode', { run: 'tool:marker' })).toBe('env AO_RUN=tool:marker cmd -p "task"')
})
