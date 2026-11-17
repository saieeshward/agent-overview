import { expect, mock, test } from 'claude-code/testing'

import { MEDIA, elevenCredits, mediaBalance, mediaDollars, mediaReadOnly, mediaService, mediaShort, mediaText, serverName, withMediaBalance, creditRate, planOf } from '../hooks/cost'
import { normalGuard } from '../hooks/state'
import type { Media } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }
const balanceTool = 'mcp__kling__query_membership_and_credits'
const featureTool = 'mcp__kling__text_to_video'
const kling = (left: number) => JSON.stringify({ membershipTypeDescription: 'Premier', availableRemainCredits: left })

test('ElevenLabs only counts reported numeric credits, preferring credits over characters', async () => {
  for (const key of ['credits_used', 'credits', 'cost', 'character_count', 'characters_used']) {
    expect(elevenCredits(`{"usage":{"${key}":12.5}}`)).toBe(12.5)
    expect(elevenCredits(`${key}: 0`)).toBe(0)
  }
  expect(elevenCredits('{"character_count":1000,"credits_used":"12"}')).toBe(12)
  for (const text of ['done', '{"credits":null}', '{"credits":-1}', '{"credits":1e999}', '120 characters', '{"my_credits":10}']) expect(elevenCredits(text)).toBeUndefined()
  expect(elevenCredits(mediaText({ result: { content: [{ type: 'text', text: '{"credits_used":7}' }] } }))).toBe(7)
  expect(elevenCredits(mediaText({ text: '{"credits":2}', result: '{"credits":2}' }))).toBe(2)
})

test('media balances parse the service responses and reject missing or invalid balances', async () => {
  expect(mediaBalance('kling', kling(3029))).toEqual({ plan: 'Premier', left: 3029, total: undefined })
  expect(mediaBalance('magnific', '```json\n{"plan":{"productName":"Premium+"},"credits":{"available":40940,"totalPlan":45000,"spent":4060}}\n```')).toEqual({ plan: 'Premium+', left: 40940, total: 45000 })
  for (const text of ['bad', '{}', '{"availableRemainCredits":-2}', '{"availableRemainCredits":"3029"}']) expect(mediaBalance('kling', text)).toBeUndefined()
})

test('chat credits use a baseline and preserve spending through top-ups', async () => {
  const first = withMediaBalance({ features: {} }, { left: 3029 }, 1)
  expect(first).toMatchObject({ base: 3029, left: 3029, used: 0, at: 1 })
  const spent = withMediaBalance(first, { left: 3009 }, 2)
  expect(spent.used).toBe(20)
  const topped = withMediaBalance(spent, { left: 3109 }, 3)
  expect(topped).toMatchObject({ base: 3129, left: 3109, used: 20 })
  expect(withMediaBalance(topped, { left: 3100 }, 4).used).toBe(29)
  expect(mediaDollars(spent, 0.6)).toBe(12)
  expect(mediaDollars(spent)).toBeUndefined()
  expect(mediaDollars(spent, 0)).toBe(0)
  expect(mediaDollars({ features: {} }, 1)).toBeUndefined()
})

test('service matching and read-only filtering keep discovery out of feature counts', async () => {
  for (const s of MEDIA) {
    const prefix = s.id === 'elevenlabs' ? 'mcp__claude_ai_ElevenLabs__' : s.id === 'magnific' ? 'mcp__claude_ai_Magnific__' : 'mcp__kling__'
    if (s.credits) for (const name of ['list_voices', 'get_status', 'search', 'show_plan', 'query_task', 'schema', 'guide', 'whoami', 'simulate', 'task_status', 'getTask']) expect(mediaReadOnly(prefix + name)).toBe(true)
  }
  expect(mediaReadOnly(balanceTool)).toBe(true)
  expect(mediaReadOnly('mcp__claude_ai_Magnific__account_balance')).toBe(true)
  expect(mediaReadOnly(featureTool)).toBe(false)
  expect(mediaShort(featureTool)).toBe('text_to_video')
  expect(mediaService(featureTool)?.id).toBe('kling')
  expect(mediaService('mcp__antigravity__gemini_bounded_task')).toBeUndefined()
  expect(mediaService('mcp__antigravity__gemini_media_task')?.credits).toBe(false)
  expect(mediaService('mcp__claude_ai_Figma__weave_run_model')?.id).toBe('figma')
  expect(mediaService('mcp__claude_ai_Figma__weave_run_tool')?.id).toBe('figma')
  expect(mediaService('mcp__claude_ai_Figma__generate_image')?.id).toBe('figma')
  expect(mediaService('mcp__claude_ai_Figma__get_design_context')).toBeUndefined()
  expect(mediaService('mcp__claude_ai_HyperFrames_by_HeyGen__render')?.credits).toBe(false)
})

test('a Kling feature shows live media, its chip, chat credits and priced cost; refresh is manual', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  let checks = 0
  let reads = 0
  let g = normalGuard({ creditPrice: { kling: 0.6 } })
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: g, version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'guard' }, (_$, e) => { g = e.value; return { value: { isSet: true, version: 2 } } })
  on('tool.check', { tool: balanceTool }, () => { checks++; return { decision: 'allow' } })
  on('tool.call', { tool: balanceTool }, () => ({ result: { content: [{ type: 'text', text: kling(++reads === 1 ? 3029 : 3009) }] } }))
  on('tool.call', { tool: featureTool }, async () => {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
    expect(await ui.find({ key: 'media' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /● Kling text_to_video/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Premier/ })).toBeDefined()
    await ui.unmount()
    return { result: 'generated' }
  })
  await ($.tool as any).call({ tool: featureTool })
  expect(checks).toBe(2)
  expect(reads).toBe(2)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  expect(await ui.find({ type: 'Text', text: /text_to_video ×1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'used 20 credits this chat ≈ $12.00' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Kling 20 credits ≈ \$12.00/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Kling\s+20 credits.*3009 left/ })).toBeDefined()
  await ui.press({ key: 'media:refresh:kling' })
  expect(reads).toBe(3)
  expect(checks).toBe(2)
  await ui.press({ key: 'cost:prices' })
  expect(await ui.find({ type: 'Text', text: 'MEDIA CREDITS · $ per credit' })).toBeDefined()
  await ui.input({ key: 'creditprice:kling', text: '0.25' })
  expect(g.creditPrice.kling).toBe(0.25)
  await ui.input({ key: 'creditprice:kling', text: '-1' })
  expect(g.creditPrice.kling).toBe(0.25)
  await ui.input({ key: 'creditprice:kling', text: '' })
  expect(g.creditPrice.kling).toBeUndefined()
  await ui.press({ key: 'prices:back' })
  // With no rate of the owner's, Kling Premier's list price (20 × $0.0115) prices the credits.
  expect(await ui.find({ type: 'Text', text: /Kling 20 credits ≈ \$0.230/ })).toBeDefined()
  await ui.press({ key: 'tab:settings' })
  await ui.press({ key: 'setting:mediaWidget:false' })
  await ui.press({ key: 'tab:dashboard' })
  expect(await ui.find({ key: 'media' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'OUTSIDE AI TOOLS' })).toBeUndefined()
  expect(await ui.find({ key: 'cost:media:kling' })).toBeUndefined()
  await ui.unmount()
})

test('automatic balance checks never ask; read-only tools and disabled balance checks do not probe', async ($, on) => {
  mock.clock(on)
  let checks = 0
  let reads = 0
  let enabled = true
  let m: Media = {}
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: normalGuard({ mediaBalances: enabled }), version: 1 } }))
  on('state.set', { plugin: 'agent-overview', key: 'media' }, (_$, e, next) => { m = e.value; return next(e) })
  on('tool.check', () => { checks++; return { decision: 'ask' } })
  on('tool.call', { tool: balanceTool }, () => { reads++; return { result: kling(3029) } })
  on('tool.call', () => ({ result: 'done' }))
  await ($.tool as any).call({ tool: 'mcp__kling__get_task_status' })
  expect(checks).toBe(0)
  expect(m.kling).toBeUndefined()
  await ($.tool as any).call({ tool: featureTool })
  expect(checks).toBe(2)
  expect(reads).toBe(0)
  expect(m.kling).toMatchObject({ features: { text_to_video: 1 } })
  expect(m.kling?.running).toBeUndefined()
  enabled = false
  await ($.tool as any).call({ tool: featureTool })
  expect(checks).toBe(2)
  expect(reads).toBe(0)
})

test('ElevenLabs usage comes from results and count-only tools do not get credit costs', async ($, on) => {
  mock.clock(on)
  let m: Media = {}
  on('state.set', { plugin: 'agent-overview', key: 'media' }, (_$, e, next) => { m = e.value; return next(e) })
  let reported = false
  on('tool.call', () => ({ result: reported ? '{"credits_used":12}' : 'done' }))
  await ($.tool as any).call({ tool: 'mcp__claude_ai_ElevenLabs__text_to_speech', characters_used: 999 })
  expect(m.elevenlabs?.used).toBeUndefined()
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  expect(await ui.find({ type: 'Text', text: 'credits not reported' })).toBeDefined()
  await ui.unmount()
  reported = true
  await ($.tool as any).call({ tool: 'mcp__claude_ai_ElevenLabs__text_to_speech' })
  await ($.tool as any).call({ tool: 'mcp__claude_ai_ElevenLabs__text_to_speech' })
  expect(m.elevenlabs).toMatchObject({ used: 24, features: { text_to_speech: 3 } })
  expect(m.elevenlabs?.running).toBeUndefined()
  await ($.tool as any).call({ tool: 'mcp__claude_ai_Figma__generate_image' })
  expect(m.figma).toMatchObject({ features: { generate_image: 1 } })
  expect(m.figma?.used).toBeUndefined()
})

test('overlapping media calls stay live until the last finishes; errors settle and denials do not count', async ($, on) => {
  mock.clock(on)
  let m: Media = {}
  on('state.set', { plugin: 'agent-overview', key: 'media' }, (_$, e, next) => { m = e.value; return next(e) })
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  on('tool.call', async (_$, e) => {
    const id = (e as { tool_use_id?: string }).tool_use_id
    if (id === 'slow') {
      entered()
      await waiting
      return { result: '{"credits_used":5}' }
    }
    return id === 'denied' ? { deny: 'not allowed' } : { isError: true, result: 'generation failed' }
  })
  const slow = ($.tool as any).call({ tool: 'mcp__claude_ai_ElevenLabs__text_to_speech', tool_use_id: 'slow' })
  await started
  await ($.tool as any).call({ tool: 'mcp__claude_ai_ElevenLabs__sound_effect', tool_use_id: 'fast' })
  expect(m.elevenlabs?.running).toBe('text_to_speech')
  release()
  await slow
  expect(m.elevenlabs?.running).toBeUndefined()
  expect(m.elevenlabs?.used).toBe(5)
  await ($.tool as any).call({ tool: 'mcp__claude_ai_ElevenLabs__clone_voice', tool_use_id: 'denied' })
  expect(m.elevenlabs?.features).toEqual({ text_to_speech: 1, sound_effect: 1 })
  expect(m.elevenlabs?.running).toBeUndefined()
})


test('desktop service names and balances use distinctive tools under any server prefix', async ($, on) => {
  mock.clock(on)
  const tools = ['mcp__random-media-server__account_balance', 'mcp__random-media-server__images_generate', 'mcp__voice-provider__creative_generate_speech', 'mcp__design-provider__weave_run_model', 'mcp__design-provider__generate_image']
  on('tool.list', () => ({ value: tools.map(name => ({ name, mcp: true })) as any }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', { tool: tools[0]! as any }, () => ({ result: '{"credits":{"available":12}}' }))
  expect(mediaService(tools[2]!)?.id).toBe('elevenlabs')
  expect(mediaService(tools[1]!)?.id).toBe('magnific')
  expect(mediaService(tools[4]!, tools)?.id).toBe('figma')
  expect(mediaService('mcp__design-provider__get_design_context', tools)).toBeUndefined()
  expect(serverName('random-media-server', tools)).toBe('Magnific')
  expect(serverName('voice-provider', tools)).toBe('ElevenLabs')
  expect(serverName('design-provider', tools)).toBe('Figma')
  expect(serverName('unrelated', tools)).toBe('unrelated')
  expect(mediaReadOnly(tools[0]!)).toBe(true)
  let media: Media = {}
  on('state.set', { plugin: 'agent-overview', key: 'media' }, (_$, e, next) => { media = e.value; return next(e) })
  on('tool.call', { tool: tools[1]! as any }, () => ({ result: 'generated' }))
  await ($.tool as any).call({ tool: tools[1]! })
  expect(media.magnific?.left).toBe(12)
})

test('credits price at the plan list rate unless the owner set one', async () => {
  expect(planOf('kling', 'Pro Plan')).toMatchObject({ rate: 0.0123, credits: 3000 })
  expect(planOf('magnific', 'Premium+')?.rate).toBe(0.00078)
  expect(planOf('magnific', 'Pro Starter')?.rate).toBe(0.00076)
  expect(planOf('elevenlabs', undefined)?.rate).toBe(0.00018)
  expect(creditRate('kling', 'Premier', undefined)).toBe(0.0115)
  expect(creditRate('kling', 'Premier', 0.01)).toBe(0.01)
  expect(creditRate('figma', 'any', undefined)).toBeUndefined()
})
