import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { defaultPolicy } from '../hooks/policy'
import type { Providers, Routing } from '../types'
import { agyJobOn, agyModelNotice, agyQuotaLine, blank, defaultRouting, handoffText, normalGuard, normalRouting, presetKey, routingText, withPicks } from '../hooks/state'
import { antigravityUsage, parseAgyModels, parseAgyQuota, watchQuota } from '../hooks/providers'
import { agentBlock, reviewerBlock, reviewerWarning } from '../hooks/work/stage'
import { presetRouting, presetSnapshot } from '../hooks/preset-state'
import { fixture, NOW } from '../tools/pane-fixtures'
import { AGY_USAGE } from './agy-usage-fixture'

const now = Date.parse('2026-10-22T09:00:00Z')
const route = (): Routing => withPicks({ ...defaultRouting(), agyCoding: true }, [{ provider: 'antigravity', model: 'gemini-4-argon-high' }])
const quota = () => parseAgyQuota(JSON.stringify(AGY_USAGE), route(), now)
function setup() {
  const state = { routing: route(), guard: normalGuard(undefined), providers: Object.fromEntries(['claude', 'codex', 'opencode', 'commandcode', 'antigravity'].map(p => [p, blank()])) as Providers }
  const calls: { argv: string[]; opts: any }[] = []
  let fail = false, version = 0
  const saved: Record<string, unknown> = {}
  const api = {
    env: { get: async () => '/home/test' }, clock: { now: async () => now }, session: { id: async () => 'agy' },
    process: { run: async (argv: string[], opts: any) => {
      calls.push({ argv, opts })
      return argv.includes('/usage') ? { exitCode: fail ? 1 : 0, stdout: JSON.stringify(AGY_USAGE), stderr: 'unavailable' }
        : { exitCode: 0, stdout: JSON.stringify([{ d: '2026-10-22', n: 4, steps: 20 }]), stderr: '' }
    } },
    fs: { list: async () => [], read: async () => '{}' },
    store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { saved[key] = value } },
    ui: { invalidate: () => {}, toast: () => {} },
    state: { get: async ({ key }: { key: keyof typeof state }) => ({ value: state[key], version }),
      set: async ({ key }: { key: keyof typeof state }, value: unknown) => { Object.assign(state, { [key]: value }); return { isSet: true, version: ++version } } },
  } as unknown as EngineInterface
  return { api, state, calls, saved, fail: () => { fail = true } }
}

test('Antigravity job defaults and normalization keep known models and reject empty or unknown ids', () => {
  expect(defaultRouting()).toMatchObject({ agyCodingModel: 'gemini-4-argon-high', agyVisualModel: 'gemini-3.8-flash-high' })
  for (const value of ['', 'unknown', 'gemini-4-fiction-high', null, 42]) {
    expect(normalRouting({ agyCodingModel: value, agyVisualModel: value })).toMatchObject({ agyCodingModel: 'gemini-4-argon-high', agyVisualModel: 'gemini-3.8-flash-high' })
  }
  expect(normalRouting({ agyCodingModel: 'claude-opus-5-5-high', agyVisualModel: 'gpt-oss-120b-medium' })).toMatchObject({ agyCodingModel: 'claude-opus-5-5-high', agyVisualModel: 'gpt-oss-120b-medium' })
  expect(presetKey(route())).not.toBe(presetKey({ ...route(), agyCodingModel: 'gemini-4-argon-low' }))
  expect(presetKey(route())).not.toBe(presetKey({ ...route(), agyVisualModel: 'gemini-3.8-flash-low' }))
})

test('routing and planner handoffs name only enabled jobs with their selected tools and models', () => {
  for (const agyCoding of [true, false]) for (const agyVisual of [true, false]) {
    const r = { ...route(), agyCoding, agyVisual, agyCodingModel: 'gemini-4-argon-low', agyVisualModel: 'gemini-3.8-flash-medium' }
    for (const text of [routingText(r), handoffText({ ...r, role: 'plan' }) ?? '']) {
      expect(text.includes('gemini_bounded_task')).toBe(agyCoding)
      expect(text.includes('gemini_visual_qa')).toBe(agyVisual)
      expect(text.includes('gemini_media_task')).toBe(agyVisual)
      if (agyCoding) expect(text).toContain('coding: gemini_bounded_task with model "gemini-4-argon-low"')
      if (agyVisual) expect(text).toContain('visual checks: gemini_visual_qa (and gemini_media_task) with model "gemini-3.8-flash-medium"')
    }
  }
})

test('live usage preserves fractional quota and resets, with third-party meters only for selected models', () => {
  const info = quota()
  expect(info.usageSource).toBe('live')
  expect(info.meters?.map(m => m.label)).toEqual(['Gemini 5h', 'Gemini wk', 'Argon wk'])
  expect(info.meters?.[0]).toEqual({ label: 'Gemini 5h', percent: (1 - 0.9900830388069153) * 100, resetAt: Date.parse('2026-10-22T13:35:47Z'), detail: 'resets in 4h 36m' })
  expect(info.meters?.[1]?.percent).toBe((1 - 0.9536621570587158) * 100)
  expect(info.meters?.[2]?.resetAt).toBe(Date.parse('2026-10-26T15:41:55Z'))
  for (const field of ['agyCodingModel', 'agyVisualModel'] as const) {
    const third = parseAgyQuota(JSON.stringify(AGY_USAGE), { ...route(), [field]: 'claude-sonnet-5-5-low' }, now)
    expect(third.meters?.map(m => m.label)).toEqual(['Gemini 5h', 'Gemini wk', 'Argon wk', 'Claude/GPT 5h', 'Claude/GPT wk'])
  }
  const invalid = JSON.parse(JSON.stringify(AGY_USAGE))
  invalid.command.data.groups[0].buckets[0].remaining_fraction = '0.5'
  expect(() => parseAgyQuota(JSON.stringify(invalid), route(), now)).toThrow()
  invalid.command.data.groups[0].buckets[0].remaining_fraction = 0
  expect(parseAgyQuota(JSON.stringify(invalid), route(), now).meters?.find(m => m.label === 'Gemini wk')?.percent).toBe(100)
  expect(parseAgyModels('gemini-4-argon-high\tGemini 4 Argon (High)\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)').map(m => m.id)).toEqual(['gemini-4-argon-high', 'gemini-3.8-flash-high'])
})

test('usage runs a bounded command with closed stdin and falls back to local facts on failure', async () => {
  const f = setup()
  await antigravityUsage(f.api)
  expect(f.state.providers.antigravity).toMatchObject({ usageSource: 'live', meters: quota().meters })
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0]?.argv.slice(1)).toEqual(['-p', '/usage', '--output-format', 'json', '--print-timeout', '30s'])
  expect(f.calls[0]?.opts).toMatchObject({ stdin: '', timeoutMs: 35000 })
  f.fail()
  await antigravityUsage(f.api)
  expect(f.state.providers.antigravity).toMatchObject({ usageSource: 'estimate', meters: [], facts: ['4 conversations, 20 steps in the last 5 hours', '4 conversations, 20 steps on 2026-10-22', '4 conversations on the last 1 active days'] })
  expect(f.state.providers.antigravity.agyQuota).toBeUndefined()
})

test('each job follows its model bucket; only all exhausted jobs pause Antigravity', async () => {
  for (const label of ['Argon wk', 'Gemini wk', 'Gemini 5h']) {
    const f = setup(), codingOut = label.startsWith('Argon')
    f.state.providers.antigravity = { ...blank(), ...quota() }
    f.state.providers.antigravity.agyQuota = quota().agyQuota!.map(m => ({ ...m, percent: m.label === label ? 100 : m.percent }))
    await watchQuota(f.api)
    const r = f.state.routing, text = routingText(r)
    expect(r.on.antigravity).toBe(true)
    expect(r.paused?.antigravity).toBeUndefined()
    expect(agyJobOn(r, 'coding')).toBe(!codingOut)
    expect(agyJobOn(r, 'visual')).toBe(codingOut)
    expect(text.includes('gemini_bounded_task')).toBe(!codingOut)
    expect(text.includes('gemini_visual_qa')).toBe(codingOut)
    expect(agyQuotaLine(r)).toBe(codingOut ? 'Coding out of quota' : 'Visual checks out of quota')
    expect(agentBlock(r, 'antigravity', [], !codingOut)).toContain('out of quota')
    expect(agentBlock(r, 'antigravity', [], codingOut)).toBeUndefined()
    expect(presetSnapshot(r).agyQuota).toBeUndefined()
    expect(presetRouting(route(), r).agyQuota).toEqual(r.agyQuota)
    f.state.providers.antigravity.agyQuota = quota().agyQuota!.map(m => ({ ...m, percent: 100 }))
    await watchQuota(f.api)
    expect(f.state.routing.on.antigravity).toBe(false)
    expect(f.state.routing.paused?.antigravity?.why).toBe('Antigravity jobs out of quota')
    expect(f.state.routing.paused?.antigravity?.until).toBe(Date.parse('2026-10-24T11:28:02Z'))
    f.state.providers.antigravity.agyQuota = quota().agyQuota!
    await watchQuota(f.api)
    expect(f.state.routing.on.antigravity).toBe(true)
  }
  const f = setup()
  f.state.routing.agyCodingModel = 'claude-opus-5-5-high'
  f.state.providers.antigravity = { ...blank(), ...quota(), agyQuota: quota().agyQuota!.map(m => ({ ...m, percent: m.label === 'Claude/GPT 5h' ? 100 : m.percent })) }
  await watchQuota(f.api)
  expect(agyJobOn(f.state.routing, 'coding')).toBe(false)
  expect(agyJobOn(f.state.routing, 'visual')).toBe(true)
  f.state.guard.autoPause = false
  f.state.routing.agyCodingModel = f.state.routing.agyVisualModel = 'gemini-4-argon-high'
  f.state.providers.antigravity.agyQuota = quota().agyQuota!.map(m => ({ ...m, percent: m.label === 'Argon wk' ? 100 : m.percent }))
  await watchQuota(f.api)
  expect(f.state.routing.on.antigravity).toBe(true)
  expect(agyJobOn(f.state.routing, 'coding')).toBe(false)
  expect(agyJobOn(f.state.routing, 'visual')).toBe(false)
})

function held(on: On, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

test('guard injects each job model; mismatches warn in Warn and Enforce and never block the permitted job', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW }); mock.store(on)
  // Antigravity runs only from an allowlisted project: allow every project here.
  const state = { ...fixture({ area: 'overview', tab: 'models', scenario: 'agy-guard' }), routing: route(), guard: normalGuard(undefined), policy: { ...defaultPolicy(), allow: ['/'] } }
  held(on, state)
  const sent: any[] = []
  on('tool.call', (_$, e) => { sent.push(e); return { result: 'kept', text: 'kept', isError: true, context: ['existing'] } })
  for (const mode of ['warn', 'enforce', 'off'] as const) for (const tool of ['bounded_task', 'visual_qa', 'media_task']) {
    state.guard.routingGuard = mode
    const job = tool === 'bounded_task' ? 'coding' : 'visual', model = job === 'coding' ? state.routing.agyCodingModel : state.routing.agyVisualModel
    const call = { tool: `mcp__antigravity__gemini_${tool}`, tool_use_id: `${mode}-${tool}`, task: 'Inspect fixture' }
    expect((await ($.tool as any).call(call)).result).toBe('kept')
    expect(sent.at(-1).model).toBe(model)
    const result = await ($.tool as any).call({ ...call, tool_use_id: `${call.tool_use_id}-mismatch`, model: 'other-model' })
    expect(result.result).toBe('kept')
    expect(result.deny).toBeUndefined()
    expect(result.context.length).toBe(mode === 'off' ? 1 : 2)
    if (mode !== 'off') expect(result.context[1]).toContain(`owner's model "${model}"`)
    expect(sent.at(-1).model).toBe('other-model')
    const reviewer = { provider: 'antigravity' as const, model: 'other-model', focus: job === 'visual' ? 'visual screenshots' : 'coding' }
    expect(reviewerBlock(state.routing, reviewer, state.guard)).toBeUndefined()
    expect(!!reviewerWarning(state.routing, reviewer, state.guard)).toBe(mode !== 'off')
    expect(!!agyModelNotice(state.routing, state.guard, job, 'other-model')).toBe(mode !== 'off')
  }
  state.routing.agyQuota = quota().agyQuota!.map(m => ({ ...m, percent: m.label === 'Gemini 5h' ? 100 : m.percent }))
  expect((await ($.tool as any).call({ tool: 'mcp__antigravity__gemini_visual_qa', tool_use_id: 'out', model: state.routing.agyVisualModel })).deny).toContain('out of quota')
  expect((await ($.tool as any).call({ tool: 'mcp__antigravity__gemini_bounded_task', tool_use_id: 'still-on' })).result).toBe('kept')
})
