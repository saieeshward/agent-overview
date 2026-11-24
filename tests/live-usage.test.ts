import type { EngineInterface, HttpInit, HttpResponse, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { commandCodeModels, commandCodeUsage, opencodeModels, opencodeUsage, refreshUsage, watchQuota } from '../hooks/providers'
import { quotaOf, usageTail } from '../hooks/graph'
import { blank, defaultRouting, normalGuard } from '../hooks/state'
import type { Providers } from '../types'

type Side = 'opencode' | 'commandcode'
const collect = { opencode: opencodeUsage, commandcode: commandCodeUsage }
const home = '/home/test'
const authPath = { opencode: `${home}/.local/share/opencode/auth.json`, commandcode: `${home}/.commandcode/auth.json` }
const cachePath = `${home}/Library/Application Support/Command Code/app-state.json`
const response = (body: unknown, status = 200): HttpResponse => ({ ok: status >= 200 && status < 300, status, headers: {}, text: JSON.stringify(body) })
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }
let serial = 0

function fixture() {
  const id = `live-usage-${++serial}`
  const keys: Record<Side, string> = { opencode: `${id}-go-credential`, commandcode: `${id}-cmd-credential` }
  const secrets = Object.values(keys)
  const state = {
    providers: Object.fromEntries(['claude', 'codex', 'opencode', 'commandcode', 'antigravity'].map(p => [p, blank()])) as Providers,
    routing: defaultRouting(), guard: normalGuard(undefined),
  }
  const saved: Record<string, unknown> = {}
  const captured: unknown[] = []
  const reads: string[] = []
  const requests: { url: string; init?: HttpInit }[] = []
  const timers: { at: number; ms: number; fn: () => void; cancelled: boolean }[] = []
  const env: Record<string, string | undefined> = { HOME: home }
  const data = { now: Date.parse('2026-10-20T12:00:00Z'), requests, reads, captured, env, files: {} as Record<string, string>, reply: (_url: string): Promise<HttpResponse> | HttpResponse => response({}), commands: [] as string[][] }
  const iso = (ms: number) => new Date(data.now + ms).toISOString()
  const payloads: { go: any; who: any; billing: any; subscription: any; usage: any } = {
    go: { usage: { rolling: { status: 'ok', percent: 38.9, resetsAt: iso(3600000) }, weekly: { status: 'ok', percent: 61, resetsAt: iso(86400000) }, monthly: { status: 'ok', percent: 20, resetsAt: iso(7 * 86400000) } } },
    who: { org: { id: 'org/a &b' } },
    billing: { credits: { planId: 'command-pro', monthlyCredits: 62, purchasedCredits: 100, freeCredits: 50, availableCredits: 212 }, windowLimits: { limited: false, fiveHour: { used: 3, cap: 12, resetAt: data.now + 3600000 }, weekly: { used: 15, cap: 30, resetAt: data.now + 86400000 } } },
    subscription: { data: { planId: 'command-pro', status: 'active', currentPeriodStart: iso(-10 * 86400000), currentPeriodEnd: iso(20 * 86400000) } },
    usage: { totalCredits: 38, totalCost: 38, totalCount: 23, totalTokens: 1234 },
  }
  const bodyFor = (url: string) => url.startsWith('https://opencode.ai/') ? payloads.go : url.includes('/whoami') ? payloads.who : url.includes('/billing/credits') ? payloads.billing : url.includes('/billing/subscriptions') ? payloads.subscription : payloads.usage
  data.reply = url => response(bodyFor(url))
  data.files[authPath.opencode] = JSON.stringify({ 'opencode-go': { type: 'api', key: keys.opencode } })
  data.files[authPath.commandcode] = JSON.stringify({ apiKey: keys.commandcode })
  data.files[cachePath] = JSON.stringify({ appState: { model: 'desktop-model' }, accountCache: { fetchedAt: data.now - 7200000, result: { overview: { usage: { totalCredits: 62 }, credits: { monthlyCredits: 38 }, subscription: payloads.subscription.data, windowLimits: payloads.billing.windowLimits } } } })
  let version = 0
  const api = {
    env: { get: async (name: string) => env[name] },
    session: { id: async () => id },
    clock: {
      now: async () => data.now,
      after: (ms: number, fn: () => void) => { const timer = { at: data.now + ms, ms, fn, cancelled: false }; timers.push(timer); return { cancel: () => { timer.cancelled = true } } },
    },
    fs: { read: async (path: string) => { reads.push(path); return data.files[path] ?? '{}' } },
    http: { fetch: async (url: string, init?: HttpInit) => {
      requests.push({ url, init })
      const provider = url.startsWith('https://opencode.ai/') ? 'opencode' : 'commandcode'
      // Boolean assertions keep even a failing test from printing credentials.
      expect(init?.headers?.Authorization === `Bearer ${keys[provider]}`).toBe(true)
      expect(provider === 'opencode' ? url === 'https://opencode.ai/zen/go/v1/usage' : url.startsWith('https://api.commandcode.ai/alpha/')).toBe(true)
      expect(init?.method).toBe('GET')
      expect(init?.headers?.['User-Agent']).toBe(provider === 'commandcode' ? 'agent-overview' : undefined)
      captured.push({ url, method: init?.method, body: init?.body })
      return data.reply(url)
    } },
    process: { run: async (argv: string[]) => {
      data.commands.push(argv); captured.push(argv)
      const query = argv.at(-1) ?? ''
      return { exitCode: 0, stderr: '', stdout: query.includes('from message') ? '[{"w18000":6,"w604800":15,"w2592000":30}]' : query.includes('sum(cost) cost from session') ? '[{"n":3,"cost":8}]' : query.includes('group by m') ? '[{"m":"opencode-go/model","n":2,"cost":6,"tok":100}]' : '[]' }
    } },
    state: {
      get: async ({ key }: { key: keyof typeof state }) => ({ value: state[key], version }),
      set: async ({ key }: { key: keyof typeof state }, value: unknown) => { captured.push({ key, value }); Object.assign(state, { [key]: value }); return { isSet: true, version: ++version } },
    },
    store: { get: async (key: string) => saved[key], set: async (key: string, value: unknown) => { captured.push({ store: key, value }); saved[key] = value === undefined ? value : JSON.parse(JSON.stringify(value)) } },
    ui: { invalidate: (what: string) => { captured.push({ invalidate: what }) }, toast: (text: string) => { captured.push({ toast: text }) } },
  } as unknown as EngineInterface
  const clean = () => { for (const key of secrets) expect(JSON.stringify([captured, state, saved]).includes(key)).toBe(false) }
  return { api, state, saved, data, keys, secrets, payloads, bodyFor, timers, clean }
}

function showState(on: On, f: ReturnType<typeof fixture>) {
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: f.state.providers, version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'routing' }, () => ({ value: { value: f.state.routing, version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: f.state.guard, version: 1 } }))
  on('state.set', { plugin: 'agent-overview' }, (_$, e, next) => {
    f.data.captured.push({ state: e.key, value: e.value })
    if (e.key in f.state) { Object.assign(f.state, { [e.key]: e.value }); return { value: { isSet: true, version: 2 } } }
    return next(e)
  })
  on('ui.toast', (_$, e) => { f.data.captured.push(e); return { value: undefined } })
}

test('OpenCode live meters use the XDG CLI key, preserve spend, and pause even below 100% when limited', async () => {
  const f = fixture()
  f.data.env.XDG_DATA_HOME = '/custom/data'
  f.data.files['/custom/data/opencode/auth.json'] = f.data.files[authPath.opencode]!
  f.payloads.go.usage.rolling.status = 'rate-limited'
  await opencodeUsage(f.api)
  const info = f.state.providers.opencode
  expect(f.data.reads).toEqual(['/custom/data/opencode/auth.json'])
  expect(f.data.requests.length).toBe(1)
  expect(info.meters.map(m => [m.label, m.percent])).toEqual([['5-hour', 38], ['Weekly', 61], ['Monthly', 20]])
  expect(info.meters[0]).toMatchObject({ limited: true, detail: 'resets in 1h 0m · rate-limited' })
  expect(info.meters[1]?.detail).toBe('resets in 1d 0h')
  expect(info.facts).toContain('$6.00 spent in 7 days')
  expect(info.usageSource).toBe('live')
  expect(info.note).toBeUndefined()
  expect(quotaOf(info, 'opencode')?.wait).toBe(3600000)
  await watchQuota(f.api)
  expect(f.state.routing.on.opencode).toBe(false)
  expect(f.state.routing.paused?.opencode?.until).toBe(f.data.now + 3600000)
  f.clean()
})

test('Command Code live sequence uses its own CLI key and monthly pool, with parallel billing reads', async () => {
  const f = fixture()
  let release: (() => void) | undefined
  f.data.reply = url => url.includes('/billing/credits?') ? new Promise(resolve => { release = () => resolve(response(f.payloads.billing)) }) : response(f.bodyFor(url))
  const pending = commandCodeUsage(f.api)
  await settle()
  expect(f.data.requests.length).toBe(3)
  expect(f.data.requests.map(r => r.url)).toEqual([
    'https://api.commandcode.ai/alpha/whoami?limits=1',
    'https://api.commandcode.ai/alpha/billing/credits?orgId=org%2Fa%20%26b',
    'https://api.commandcode.ai/alpha/billing/subscriptions?orgId=org%2Fa%20%26b',
  ])
  release!()
  await pending
  expect(f.data.requests[3]?.url).toBe(`https://api.commandcode.ai/alpha/usage/summary?orgId=org%2Fa%20%26b&since=${encodeURIComponent(f.payloads.subscription.data.currentPeriodStart)}`)
  expect(f.data.reads).toContain(authPath.commandcode)
  const info = f.state.providers.commandcode
  expect(info.meters.map(m => [m.label, m.percent])).toEqual([['Monthly', 38], ['5-hour', 25], ['Weekly', 50]])
  expect(info.meters[0]?.detail).toContain('resets in 20d 0h')
  expect(info.meters[1]?.detail).toContain('resets in 1h 0m')
  expect(info.meters[2]?.detail).toContain('resets in 1d 0h')
  expect(info).toMatchObject({ plan: 'command-pro', current: 'desktop-model', usageSource: 'live', usageAt: f.data.now })
  expect(info.note).toBeUndefined()
  expect(info.meters.some(m => m.detail?.includes('as of'))).toBe(false)
  expect(f.timers.every(t => t.ms === 10000 && t.cancelled)).toBe(true)
  f.clean()
})

test('a personal Command Code account (org null) uses the same URLs without orgId and the monthly pool is totalCredits over totalCredits plus monthlyCredits', async () => {
  const f = fixture()
  f.payloads.who = { org: null }
  f.payloads.billing.credits = { monthlyCredits: 80, availableCredits: 90 }
  f.payloads.subscription.data = { ...f.payloads.subscription.data, planId: 'individual-goat' }
  f.payloads.usage = { totalCredits: 20, totalCost: 20, totalCount: 5, totalTokens: 500 }
  await commandCodeUsage(f.api)
  expect(f.data.requests.map(r => r.url)).toEqual([
    'https://api.commandcode.ai/alpha/whoami?limits=1',
    'https://api.commandcode.ai/alpha/billing/credits',
    'https://api.commandcode.ai/alpha/billing/subscriptions',
    `https://api.commandcode.ai/alpha/usage/summary?since=${encodeURIComponent(f.payloads.subscription.data.currentPeriodStart)}`,
  ])
  const info = f.state.providers.commandcode
  expect(info.meters.map(m => [m.label, m.percent])).toEqual([['Monthly', 20], ['5-hour', 25], ['Weekly', 50]])
  expect(info).toMatchObject({ plan: 'individual-goat', usageSource: 'live', usageAt: f.data.now })
  f.clean()
})

test('environment credentials override files, and zero-cap Command Code windows stay hidden', async () => {
  const f = fixture()
  f.data.env.OPENCODE_API_KEY = f.keys.opencode
  f.data.env.COMMAND_CODE_API_KEY = f.keys.commandcode
  f.payloads.billing.windowLimits.weekly.cap = 0
  await Promise.all([opencodeUsage(f.api), commandCodeUsage(f.api)])
  expect(f.data.reads).toEqual([cachePath])
  expect(f.state.providers.commandcode.meters.map(m => m.label)).toEqual(['Monthly', '5-hour'])
  f.clean()
})

test('401, 403, network errors, malformed replies and timeouts silently fall back without leaking credentials', async () => {
  for (const provider of ['opencode', 'commandcode'] as Side[]) for (const failure of ['401', '403', 'network', 'malformed', 'timeout']) {
    const f = fixture()
    let late: ((response: HttpResponse) => void) | undefined
    f.data.reply = () => {
      if (failure === 'network') throw new Error(f.keys[provider])
      if (failure === 'timeout') return new Promise(resolve => { late = resolve })
      if (failure === 'malformed') return { ...response({}), text: f.keys[provider] }
      return response({ message: f.keys[provider] }, Number(failure))
    }
    const pending = collect[provider](f.api)
    await settle()
    if (failure === 'timeout') {
      const active = f.timers.filter(t => !t.cancelled)
      expect(active.length).toBe(1)
      f.data.now += 10000
      for (const t of active) t.fn()
    }
    await pending
    const info = f.state.providers[provider]
    expect(info.error).toBeUndefined()
    expect(info.usageSource).toBe(provider === 'opencode' ? 'estimate' : 'desktop')
    expect(info.meters[0]?.percent).toBe(provider === 'opencode' ? 50 : 62)
    expect(info.note).toContain(provider === 'opencode' ? 'estimates · this machine only' : '2h 0m old')
    if (provider === 'commandcode') expect(info.meters[0]?.detail).toContain('as of')
    expect(f.data.captured.some((e: any) => e.toast)).toBe(false)
    const before = JSON.stringify(info)
    if (late) { late(response(f.bodyFor(f.data.requests[0]!.url))); await settle() }
    expect(JSON.stringify(f.state.providers[provider]) === before).toBe(true)
    f.clean()
  }
})

test('each Command Code billing stage falls back, missing auth and invalid payloads never become live', async () => {
  for (const path of ['/billing/credits?', '/billing/subscriptions?', '/usage/summary?']) {
    const f = fixture()
    f.data.reply = url => url.includes(path) ? response({ message: f.keys.commandcode }, 403) : response(f.bodyFor(url))
    await commandCodeUsage(f.api)
    expect(f.state.providers.commandcode.usageSource).toBe('desktop')
    f.clean()
  }
  for (const provider of ['opencode', 'commandcode'] as Side[]) {
    for (const invalid of ['auth', 'malformed-auth', 'payload']) {
      const f = fixture()
      if (invalid === 'auth') f.data.files[authPath[provider]] = provider === 'opencode' ? JSON.stringify({ 'opencode-go': { type: 'oauth', key: f.keys.opencode } }) : '{}'
      else if (invalid === 'malformed-auth') f.data.files[authPath[provider]] = f.keys[provider]
      else f.data.reply = () => response({ usage: {}, org: {} })
      await collect[provider](f.api)
      expect(f.data.requests.length).toBe(invalid === 'payload' ? (provider === 'commandcode' ? 3 : 1) : 0)
      expect(f.state.providers[provider].usageSource).toBe(provider === 'opencode' ? 'estimate' : 'desktop')
      f.clean()
    }
  }
})

test('a service echoing a credential cannot put it in a query or provider state', async () => {
  for (const field of ['org', 'plan']) {
    const f = fixture()
    if (field === 'org') f.payloads.who.org.id = f.keys.commandcode
    else f.payloads.subscription.data.planId = f.keys.commandcode
    await commandCodeUsage(f.api)
    expect(f.state.providers.commandcode.usageSource).toBe('desktop')
    expect(f.data.requests.length).toBe(field === 'org' ? 1 : 4)
    f.clean()
  }
})

test('per-provider attempts coalesce, throttle successes and failures for three minutes, and refresh on demand', async () => {
  const f = fixture()
  await Promise.all([opencodeUsage(f.api), opencodeUsage(f.api), commandCodeUsage(f.api), commandCodeUsage(f.api)])
  expect(f.data.requests.length).toBe(5)
  f.data.now += 179999
  await Promise.all([opencodeUsage(f.api), commandCodeUsage(f.api)])
  expect(f.data.requests.length).toBe(5)
  expect(f.data.reads.filter(p => p.endsWith('/auth.json')).length).toBe(2)
  f.data.now++
  await Promise.all([opencodeUsage(f.api), commandCodeUsage(f.api)])
  expect(f.data.requests.length).toBe(10)
  // Keys are read anew only at fetch time, including manual refresh.
  for (const provider of ['opencode', 'commandcode'] as Side[]) { f.keys[provider] += '-rotated'; f.secrets.push(f.keys[provider]) }
  f.data.files[authPath.opencode] = JSON.stringify({ 'opencode-go': { type: 'api', key: f.keys.opencode } })
  f.data.files[authPath.commandcode] = JSON.stringify({ apiKey: f.keys.commandcode })
  await Promise.all([refreshUsage(f.api, 'opencode', true), refreshUsage(f.api, 'commandcode', true)])
  expect(f.data.requests.length).toBe(15)
  f.data.reply = () => response({}, 401)
  await Promise.all([opencodeUsage(f.api, true), commandCodeUsage(f.api, true)])
  expect(f.data.requests.length).toBe(17)
  f.data.now += 90000
  await Promise.all([opencodeUsage(f.api), commandCodeUsage(f.api)])
  expect(f.data.requests.length).toBe(17)
  expect(f.state.providers.opencode.usageSource).toBe('estimate')
  expect(f.state.providers.commandcode.usageSource).toBe('desktop')
  f.data.now += 90000
  await Promise.all([opencodeUsage(f.api), commandCodeUsage(f.api)])
  expect(f.data.requests.length).toBe(19)
  f.clean()
})

test('live usage renders without estimates or desktop labels across the dashboard, provider view and hint', async ($, on) => {
  const f = fixture()
  mock.clock(on, { now: f.data.now })
  await Promise.all([opencodeUsage(f.api), commandCodeUsage(f.api)])
  showState(on, f)
  const tail = usageTail(f.state.providers, f.state.routing, f.data.now)
  expect(tail).toContain('OpenCode 5h 62% left wk 39% left')
  expect(tail.includes('≈')).toBe(false)
  f.data.captured.push(tail)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: { title: 'Overview', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  expect({ dashboard38: !!await ui.find({ type: 'Text', text: /62% left/ }), dashboard20: !!await ui.find({ type: 'Text', text: /80% left/ }), estimated38: !!await ui.find({ type: 'Text', text: /≈38%/ }) }).toEqual({ dashboard38: true, dashboard20: true, estimated38: false })
  f.data.captured.push(await ui.drawn())
  await ui.press({ key: 'tab:models' })
  expect({ modelsLeft: !!await ui.find({ type: 'Text', text: /39%.*left/ }) }).toEqual({ modelsLeft: true })
  f.data.captured.push(await ui.drawn())
  await ui.press({ key: 'open:opencode' })
  for (const label of ['5-hour', 'Weekly', 'Monthly']) expect({ label, shown: !!await ui.find({ type: 'Text', text: new RegExp(label) }) }).toEqual({ label, shown: true })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(text.includes('this machine only') || text.includes('≈38%')).toBe(false)
  expect(text).toContain('resets in 1h 0m')
  f.data.captured.push(await ui.drawn())
  f.data.reply = () => response({ message: f.keys.opencode }, 401)
  await Promise.all([opencodeUsage(f.api, true), commandCodeUsage(f.api, true)])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /≈50%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /this machine only/ })).toBeDefined()
  f.data.captured.push(await ui.drawn())
  await ui.press({ key: 'edit:back' })
  await ui.press({ key: 'open:commandcode' })
  expect(await ui.find({ type: 'Text', text: /2h 0m old/ })).toBeDefined()
  f.data.captured.push(await ui.drawn())
  await ui.unmount()
  f.clean()
})

test('the existing refresh button fetches live usage immediately and applies automatic quota pause', async ($, on) => {
  const f = fixture()
  mock.clock(on, { now: f.data.now })
  mock.store(on, { 'usageAttempt:opencode': f.data.now, 'usageAttempt:commandcode': f.data.now })
  mock.env(on, { HOME: home })
  showState(on, f)
  on('session.id', () => ({ value: 'refresh-button' }))
  on('session.usage', () => ({ value: { startedAt: f.data.now, rateLimits: [], context: { window: 100 } } }))
  on('fs.read', (_$, e) => ({ value: f.data.files[e.path] ?? '{}' }))
  on('process.run', () => ({ value: { stdout: '[]', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', async (_$, e) => ({ value: await f.api.http.fetch(e.url, e.init) }))
  on('store.set', { key: /.*/ }, (_$, e, next) => { f.data.captured.push({ store: e.key, value: e.value }); return next(e) })
  await Promise.all([opencodeUsage(f.api), commandCodeUsage(f.api)])
  f.payloads.go.usage.rolling.status = 'rate-limited'
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: { title: 'Overview', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  await ui.press({ key: 'cost:refresh' })
  await ui.redraw()
  expect(f.data.requests.length).toBe(10)
  expect(f.state.routing.on.opencode).toBe(false)
  expect(f.state.routing.paused?.opencode?.why).toContain('rate-limited')
  f.data.captured.push(await ui.drawn())
  await ui.unmount()
  f.clean()
})


test('live snapshots are shared across sessions, including warm readers and concurrent first reads', async () => {
  for (const provider of ['opencode', 'commandcode'] as Side[]) {
    const a = fixture(), b = fixture()
    const second = { ...b.api, store: a.api.store } as EngineInterface
    await Promise.all([collect[provider](a.api), collect[provider](second)])
    expect(a.data.requests.length).toBe(provider === 'opencode' ? 1 : 4)
    expect(b.data.requests).toHaveLength(0)
    expect(b.state.providers[provider]).toEqual(a.state.providers[provider])
    expect(a.saved[`usageSnapshot:${provider}`]).toMatchObject({ fetchedAt: a.data.now, usageSource: 'live' })
    // A warm session also consumes the newest shared snapshot.
    a.data.now += 180000
    if (provider === 'opencode') a.payloads.go.usage.rolling.percent = 77
    else a.payloads.usage.totalCredits = 77
    await collect[provider](a.api)
    b.data.now = a.data.now
    b.state.providers[provider].alert = 'rate-limited'
    b.state.providers[provider].note = 'old cache note'
    await collect[provider](second)
    expect(b.data.requests).toHaveLength(0)
    expect(b.state.providers[provider]).toEqual(a.state.providers[provider])
    const fresh = fixture()
    fresh.data.now = a.data.now
    await collect[provider]({ ...fresh.api, store: a.api.store } as EngineInterface)
    expect(fresh.data.requests).toHaveLength(0)
    expect(fresh.state.providers[provider]).toEqual(a.state.providers[provider])
    a.clean(); b.clean(); fresh.clean()
  }
})

test('desktop rate-limit flags expire with their window and cache age', async () => {
  for (const [age, reset, limited] of [[2 * 3600000, 60000, true], [2 * 3600000, 0, false], [5 * 3600000, 60000, false], [8 * 86400000, 86400000, false]] as const) {
    const f = fixture()
    const cache = JSON.parse(f.data.files[cachePath]!)
    cache.accountCache.fetchedAt = f.data.now - age
    cache.accountCache.result.overview.windowLimits = { limited: true, fiveHour: { cap: 12, used: 12, resetAt: f.data.now + reset } }
    f.data.files[cachePath] = JSON.stringify(cache)
    f.data.reply = () => response({}, 401)
    await commandCodeUsage(f.api)
    expect(f.state.providers.commandcode.alert === 'rate-limited').toBe(limited)
    expect(f.state.providers.commandcode.meters.some(m => m.label === '5-hour')).toBe(limited)
    f.clean()
  }
})

test('usage success preserves missing installations and models errors until model discovery succeeds', async () => {
  const models = { opencode: opencodeModels, commandcode: commandCodeModels }
  for (const provider of ['opencode', 'commandcode'] as Side[]) for (const error of ['ENOENT', 'model discovery unavailable']) {
    const f = fixture()
    const original = f.api.process.run
    f.api.process.run = async () => { throw new Error(error) }
    await models[provider](f.api)
    const before = { status: f.state.providers[provider].status, error: f.state.providers[provider].error }
    await collect[provider](f.api)
    expect(f.state.providers[provider]).toMatchObject(before)
    expect(f.state.providers[provider].usageSource).toBe('live')
    f.api.process.run = original
    await models[provider](f.api)
    expect(f.state.providers[provider].status).toBe('ok')
    expect(f.state.providers[provider].error).toBeUndefined()
    f.clean()
  }
})

test('Bash returns its result while usage is pending and swallows refresh failures', async ($, on) => {
  const f = fixture()
  mock.clock(on, { now: f.data.now }); mock.store(on); mock.env(on, { HOME: home })
  showState(on, f)
  on('session.id', () => ({ value: 'nonblocking-usage' }))
  on('fs.read', (_$, e) => ({ value: f.data.files[e.path] ?? '{}' }))
  on('process.run', (_$, e) => ({ value: { stdout: '[]', stderr: '', exitCode: e.argv[0] === 'git' ? 1 : 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  let release: (() => void) | undefined
  let started!: () => void
  const requested = new Promise<void>(resolve => { started = resolve })
  on('http.fetch', () => { started(); return new Promise(resolve => { release = () => resolve({ value: response({}, 503) }) }) })
  on('tool.call', () => ({ result: 'completed tool' }))
  const pending = ($.tool as any).call({ tool: 'Bash', tool_use_id: 'nonblocking', command: 'opencode run "task"' })
  await requested
  const result = await pending
  expect(result).toMatchObject({ result: 'completed tool' })
  release!()
  await settle()
  f.clean()
})

test('a plan with usage windows is not rate-limited until a window is used up or exceeded', async () => {
  const f = fixture()
  f.payloads.billing.windowLimits = { limited: true, exceeded: null, fiveHour: { used: 0, cap: 14, exceeded: false, resetAt: f.data.now + 3600000 }, weekly: { used: 10.7, cap: 35, exceeded: false, resetAt: f.data.now + 86400000 } } as any
  await commandCodeUsage(f.api)
  expect(f.state.providers.commandcode.usageSource).toBe('live')
  expect(f.state.providers.commandcode.alert).toBeUndefined()
  ;(f.payloads.billing.windowLimits as any).fiveHour.exceeded = true
  await commandCodeUsage(f.api, true)
  expect(f.state.providers.commandcode.alert).toBe('rate-limited')
  f.clean()
})
