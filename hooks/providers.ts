import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Costs, Installed, InstalledPlugin, Meter, ModelRow, Price, Prices, Provider, ProviderInfo, Providers, TokenRow } from '../types'
import { allOf, agyBucket, agyJobQuota, blank, defaultRouting, isEmbedder, nameOf, normalGuard, normalRouting, OTHERS, storeRouting } from './state'
import { catalogFrom, parseCodexTokens, priceKey } from './cost'
import { quotaOf } from './graph'
import { at } from './paths'
import { recordSpeed } from './speed'

// State lives here as well as beside the other hooks: the engine lists each file's reads and writes from its own consts.
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {
  claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(), ollama: blank(),
} as Providers)
const costs = atom({ plugin: 'agent-overview', key: 'costs' } as const, { rows: [], claude: {}, agy: {} } as Costs)
const prices = atom({ plugin: 'agent-overview', key: 'prices' } as const, { catalog: {}, overrides: {} } as Prices)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const installed = atom({ plugin: 'agent-overview', key: 'installed' } as const, { plugins: [], mcpServers: [], skills: 0 } as Installed)
const guardSettings = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))


type $ = EngineInterface

// The usual places first: the engine's PATH lacks the owner's install folders. `locate` looks further.
const BIN = {
  claude: '.local/bin/claude',
  codex: '/opt/homebrew/bin/codex',
  node: '/opt/homebrew/bin/node',
  cmd: '/Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs',
  opencode: '/opt/homebrew/bin/opencode',
  agy: '.local/bin/agy',
  ollama: '/usr/local/bin/ollama',
  sqlite: '/usr/bin/sqlite3',
}

// ---------- where each CLI lives on this machine ----------

type Tool = 'codex' | 'opencode' | 'agy' | 'cmd' | 'node' | 'ollama'
const TOOL_NAMES: Record<Tool, string[]> = { codex: ['codex'], opencode: ['opencode'], agy: ['agy'], cmd: ['command-code', 'commandcode'], node: ['node'], ollama: ['ollama'] }
const TOOL_FIRST: Record<Tool, string> = { codex: BIN.codex, opencode: BIN.opencode, agy: BIN.agy, cmd: BIN.cmd, node: BIN.node, ollama: BIN.ollama }
// Not ~/.antigravity: its `agy` there opens the IDE, it is not the CLI.
const TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '.local/bin', '.bun/bin', '.npm-global/bin', '.opencode/bin', '.volta/bin', '.cargo/bin']
const CC_STATE = 'Library/Application Support/Command Code/app-state.json'
const found = new Map<Tool, string>()
const missed = new Map<Tool, number>()
const dirOf = (path: string) => path.slice(0, Math.max(1, path.lastIndexOf('/')))

// true: a file is there. false: nothing is. undefined: this host cannot say.
async function isFile($: $, path: string): Promise<boolean | undefined> {
  try {
    return (await $.fs.stat(path)).kind === 'file'
  } catch (err) {
    return /ENOENT|ENOTDIR|no such file|not found/i.test(String((err as Error)?.message ?? err)) ? false : undefined
  }
}

// A CLI's path, wherever it was installed (Homebrew, npm, bun, nvm); undefined when it is not on this machine.
export async function locate($: $, tool: Tool): Promise<string | undefined> {
  const hit = found.get(tool)
  if (hit) return hit
  const now = await $.clock.now()
  const last = missed.get(tool)
  if (last !== undefined && now >= last && now - last < 60000) return undefined
  const first = await at($, TOOL_FIRST[tool])
  const usual = await isFile($, first)
  if (usual) { found.set(tool, first); return first }
  // A host that cannot look is taken to have the usual install.
  if (usual === undefined) return first
  const nvmRoot = await at($, '.nvm/versions/node')
  const nvm = (await Promise.resolve().then(() => $.fs.list(nvmRoot)).catch(() => [])).filter(d => d.kind === 'dir').map(d => `${nvmRoot}/${d.name}/bin`).sort().reverse()
  const dirs = [...await Promise.all(TOOL_DIRS.map(d => at($, d))), ...nvm]
  const candidates = [...new Set(dirs.flatMap(d => TOOL_NAMES[tool].map(n => `${d}/${n}`)))].filter(path => path !== first)
  const looks = await Promise.all(candidates.map(path => isFile($, path)))
  const at0 = looks.findIndex(ok => ok === true)
  if (at0 >= 0) { found.set(tool, candidates[at0]!); return candidates[at0] }
  missed.set(tool, now)
  return undefined
}

// The CLI's own folder and node's go first on PATH, so a `#!/usr/bin/env node` script starts.
async function toolEnv($: $, path: string): Promise<Record<string, string>> {
  const node = await locate($, 'node')
  const host = await Promise.resolve().then(() => $.env.get('PATH')).catch(() => undefined)
  return { PATH: [...new Set([dirOf(path), ...(node ? [dirOf(node)] : []), ...(host || '/usr/bin:/bin:/usr/sbin:/sbin').split(':')])].filter(Boolean).join(':') }
}
async function runTool($: $, path: string, args: string[], opts: { timeoutMs?: number; stdin?: string } = {}) {
  const argv = /\.m?js$/.test(path) ? [(await locate($, 'node')) ?? BIN.node, path, ...args] : [path, ...args]
  return run($, argv, { ...opts, env: await toolEnv($, path) })
}

type Side = Exclude<Provider, 'claude'>
async function whereIs($: $, p: Side): Promise<string | undefined> {
  if (p === 'codex') return locate($, 'codex')
  if (p === 'opencode') return locate($, 'opencode')
  if (p === 'ollama') return locate($, 'ollama')
  if (p === 'antigravity') {
    const cli = await locate($, 'agy')
    if (cli !== undefined) return cli
    // Its MCP tools alone (no CLI) can still take work: '' says so.
    const tools = await Promise.resolve().then(() => $.tool.list()).catch(() => [])
    return tools.some(t => t.name.startsWith('mcp__antigravity__')) ? '' : undefined
  }
  const cli = await locate($, 'cmd')
  if (cli !== undefined) return cli
  // The desktop app alone (no CLI) still has account numbers to show: '' says so.
  return (await isFile($, await at($, CC_STATE))) !== false || (await isFile($, await at($, '.commandcode/auth.json'))) !== false ? '' : undefined
}
export const NOT_INSTALLED = 'not installed on this Mac'

// The provider's CLI path, or undefined after marking it missing: nothing is asked of a tool that is not there.
// A look that fails (the session is closing) reads as "nothing to ask": the refresh ends quietly.
async function present($: $, p: Side): Promise<string | undefined> {
  try {
    return await check($, p)
  } catch {
    return undefined
  }
}
async function check($: $, p: Side): Promise<string | undefined> {
  const path = await whereIs($, p)
  const info = (await read($, providers).then(allOf))[p]
  if (path === undefined) {
    if (info.status !== 'missing' || info.error !== NOT_INSTALLED || info.meters.length || info.facts.length) {
      await patch($, p, { status: 'missing', error: NOT_INSTALLED, meters: [], facts: [], models: [], alert: undefined, note: undefined, agyQuota: undefined, usageSource: undefined, usageAt: undefined, plan: undefined, current: undefined, offline: undefined, checkedAt: await $.clock.now() })
      // The routing told to the model leaves it out from now on.
      $.ui.invalidate('prompt.section')
    }
    return undefined
  }
  // Only this check's own verdict is lifted: a failed model listing keeps its say until one succeeds.
  if (info.status === 'missing' && info.error === NOT_INSTALLED) {
    await patch($, p, { status: 'loading', error: undefined })
    $.ui.invalidate('prompt.section')
  }
  return path
}

async function run($: $, argv: string[], opts: { env?: Record<string, string>; timeoutMs?: number; stdin?: string } = {}) {
  const r = await $.process.run(argv, { cwd: '/tmp', timeoutMs: opts.timeoutMs ?? 15000, env: opts.env, stdin: opts.stdin })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}`)
  return r.stdout
}
async function readJson($: $, path: string) {
  return JSON.parse(await $.fs.read(await at($, path))) as any
}
async function sql($: $, db: string, query: string) {
  return JSON.parse((await run($, [BIN.sqlite, '-readonly', '-json', await at($, db), query])) || '[]') as any[]
}

function patch($: $, p: Provider, change: Partial<ProviderInfo>) {
  return update($, providers, all => ({ ...all, [p]: { ...blank(), ...all[p], ...change } }))
}

function patchUsage($: $, p: Provider, change: Partial<ProviderInfo>) {
  return update($, providers, all => {
    const previous = all[p] ?? blank()
    const keep = previous.status === 'missing' || previous.status === 'error' && previous.error?.startsWith('models:')
    return { ...all, [p]: { ...previous, ...change, status: keep ? previous.status : 'ok', error: keep ? previous.error : undefined } }
  })
}

// One collector failing leaves the others standing and says why on its own tab.
async function guard($: $, p: Provider, part: string, fn: () => Promise<Partial<ProviderInfo>>) {
  try {
    const got = await fn()
    const change = { ...got, checkedAt: await $.clock.now() }
    if (part !== 'models' && !got.models) await patchUsage($, p, change)
    else await patch($, p, { ...change, status: 'ok', error: undefined })
  } catch (err) {
    // A CLI's colored error would be refused as drawn text: keep the words only.
    const msg = String((err as Error)?.message ?? err).replace(/\x1b\[[0-9;]*m/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').slice(0, 120)
    const missing = /ENOENT|not found|cannot start|No such file/i.test(msg)
    // A session that is closing refuses the write too: there is nobody left to tell.
    try {
      await patch($, p, { status: missing ? 'missing' : 'error', error: `${part}: ${msg}`, checkedAt: await $.clock.now() })
    } catch {}
  }
}

// ---------- formatting ----------

export const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`

export const until = (ms: number) => {
  if (!(ms > 0)) return ''
  const m = Math.round(ms / 60000)
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

const windowName = (mins: number) => (mins >= 10080 ? 'Weekly' : mins >= 1440 ? `${Math.round(mins / 1440)}-day` : `${Math.round(mins / 60)}-hour`)

// ---------- parsers (pure, tested) ----------

// "Resets in 126h7m53s" / "reset after 0.25s", counted from when the log was written.
export const resetTime = (line: string, loggedAt: number) => {
  const m = /[Rr]esets? (?:in|after) ((?:[\d.]+[hms])+)/.exec(line)
  if (!m) return undefined
  let ms = 0
  for (const [, n, u] of m[1]!.matchAll(/([\d.]+)([hms])/g)) ms += Number(n) * (u === 'h' ? 3600000 : u === 'm' ? 60000 : 1000)
  return loggedAt + ms
}

// configs: each Codex home's config.toml, the one `codex` uses first.
// A Codex model's effort levels as the app-server lists them (strings or { reasoningEffort }); none known = undefined.
export const effortsOf = (list: unknown) => {
  const out = Array.isArray(list) ? list.map((x: any) => (typeof x === 'string' ? x : x?.reasoningEffort ?? x?.effort)).filter((x): x is string => typeof x === 'string') : []
  return out.length ? out : undefined
}

export const parseCodex = (stdout: string, configs: { home: string; toml: string }[], now: number) => {
  const byId: Record<number, any> = {}
  for (const line of stdout.split('\n')) {
    try {
      const m = JSON.parse(line)
      if (typeof m.id === 'number') byId[m.id] = m.error ? { __error: m.error.message } : m.result
    } catch {}
  }
  const set = configs.map(c => ({ home: c.home, model: /^model\s*=\s*"([^"]+)"/m.exec(c.toml)?.[1], effort: /^model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(c.toml)?.[1] })).filter(c => c.model)
  const current = set[0]?.model
  const rl = byId[2]?.rateLimits
  const meters: Meter[] = []
  for (const w of [rl?.primary, rl?.secondary]) {
    if (!w) continue
    meters.push({
      label: windowName(w.windowDurationMins ?? 0),
      percent: w.usedPercent ?? 0,
      detail: w.resetsAt ? `resets in ${until(w.resetsAt * 1000 - now)}` : undefined,
    })
  }
  const facts: string[] = []
  const credits = rl?.credits
  if (credits?.unlimited) facts.push('credits unlimited')
  else if (credits?.balance) facts.push(`${compact(Number(credits.balance))} credits`)
  const usage = byId[4]
  const today = usage?.dailyUsageBuckets?.at(-1)
  if (today) facts.push(`${compact(today.tokens)} tokens on ${today.startDate}`)
  if (usage?.summary?.lifetimeTokens) facts.push(`${compact(usage.summary.lifetimeTokens)} lifetime`)
  if (usage?.summary?.currentStreakDays) facts.push(`${usage.summary.currentStreakDays}-day streak`)
  const list: any[] = byId[3]?.data ?? []
  const models: ModelRow[] = list
    .filter(m => !m.hidden)
    .map(m => ({
      id: m.id,
      name: m.displayName,
      info: [m.description, m.id === current && set[0]?.effort ? `effort ${set[0].effort} (config)` : m.supportedReasoningEfforts?.length ? `effort ${m.defaultReasoningEffort}` : ''].filter(Boolean).join(' · '),
      isDefault: m.isDefault,
      isCurrent: m.id === current,
      // The effort levels this model takes, as the app-server lists them (strings or { reasoningEffort }).
      efforts: effortsOf(m.supportedReasoningEfforts),
    }))
  // A model set in a config but missing from the account's catalog still shows, flagged.
  for (const c of [...set].reverse()) {
    const row = models.find(m => m.id === c.model)
    if (row) row.info = [row.info, `set in ${c.home}`].filter(Boolean).join(' · ')
    else models.unshift({ id: c.model!, info: `set in ${c.home} · newer than this Codex CLI's model list`, isCurrent: c.model === current })
  }
  if (!rl) throw new Error(byId[2]?.__error ? `rate limits: ${byId[2].__error}` : 'rate limits did not answer in time')
  return {
    plan: rl?.planType,
    current,
    meters,
    facts,
    models,
    alert: rl?.rateLimitReachedType ? `limit reached: ${rl.rateLimitReachedType}` : undefined,
  }
}

export const parseCmdModels = (text: string): ModelRow[] => {
  const rows: ModelRow[] = []
  let section = ''
  for (const raw of text.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const line = raw.trim()
    if (!line || /Available models/.test(line)) continue
    const m = /^(\S+)\s{2,}(.+)$/.exec(line)
    if (!m || m[1]!.endsWith(':')) {
      section = line
      continue
    }
    if (/headless/i.test(section)) continue
    const info = m[2]!
    rows.push({ id: m[1]!, info: `${section ? `${section} · ` : ''}${info.replace(/\s*\(default\)/, '')}`, isDefault: /\(default\)/.test(info) })
  }
  return rows
}

export const parseOpencodeVerbose = (text: string): ModelRow[] => {
  const rows: ModelRow[] = []
  const parts = text.split(/^(\S+\/\S+)$/m)
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i]!
    let m: any = {}
    try {
      m = JSON.parse(parts[i + 1] ?? '{}')
    } catch {}
    const ctx = m.limit?.context ? `${compact(m.limit.context)} ctx` : ''
    const cost = m.cost ? (m.cost.input || m.cost.output ? `$${m.cost.input}/$${m.cost.output} per M` : 'free') : ''
    const caps = [m.capabilities?.reasoning ? 'reasoning' : '', m.capabilities?.input?.image ? 'vision' : ''].filter(Boolean).join(', ')
    rows.push({ id, name: m.name, info: [ctx, cost, caps].filter(Boolean).join(' · '), efforts: m.variants ? Object.keys(m.variants) : undefined })
  }
  return rows
}

export const parseAgyModels = (text: string): ModelRow[] =>
  text
    .split('\n')
    .map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .map(l => /^([a-z0-9][\w.-]*)\s+(.+)$/i.exec(l))
    .filter((m): m is RegExpExecArray => !!m && !/^Fetching/i.test(m[0]))
    .map(m => ({ id: m[1]!, name: m[2]!.trim() }))

// ---------- collectors ----------

export function claudeModels($: $) {
  return guard($, 'claude', 'models', async () => {
    const dir = await at($, '.claude/cache/model-catalog')
    const files = (await $.fs.list(dir)).filter(f => /-ccd?\.json$/.test(f.name) && !f.name.startsWith('tok-'))
    const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (!newest) throw new Error('no model catalog cached yet')
    const cat = await readJson($, `${dir}/${newest.name}`)
    const current = await $.session.model()
    const list: any[] = cat?.catalog?.config?.models ?? []
    const models: ModelRow[] = list
      .filter(m => m.section === 'main' || m.section === 'overflow')
      .map(m => ({
        id: m.id,
        name: m.name,
        info: [m.description, m.runtime?.max_input_tokens ? `${compact(m.runtime.max_input_tokens)} ctx` : '', m.runtime?.default_effort ? `effort ${m.runtime.default_effort}` : '', m.notice?.text ?? '']
          .filter(Boolean)
          .join(' · '),
        isDefault: m.section === 'main',
        efforts: Array.isArray(m.runtime?.effort_levels) ? m.runtime.effort_levels : undefined,
        isCurrent: m.id === current.replace(/\[.*\]$/, ''),
      }))
    return { models, current }
  })
}

export function claudeUsage($: $, measured?: { rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]; context: { percent?: number; tokens?: number; window: number }; cost?: { usd: number } }) {
  return guard($, 'claude', 'usage', async () => {
    const u = measured ?? (await $.session.usage())
    const now = await $.clock.now()
    const label: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', seven_day_opus: 'Weekly Opus', spend_limit: 'Spend' }
    const meters: Meter[] = u.rateLimits.map(r => ({
      label: label[r.kind] ?? r.kind.replace(/_/g, ' '),
      percent: r.percentUsed,
      detail: r.resetsAt ? `resets in ${until(Date.parse(r.resetsAt) - now)}` : undefined,
    }))
    if (u.context.percent !== undefined) {
      meters.push({ label: 'Context', percent: u.context.percent, detail: `${compact(u.context.tokens ?? 0)} of ${compact(u.context.window)}` })
    }
    const facts = u.cost ? [`$${u.cost.usd.toFixed(2)} this session (API rates)`] : []
    return { meters, facts, note: meters.length ? undefined : 'limits appear after the first reply' }
  })
}

export function claudePlan($: $) {
  return guard($, 'claude', 'plan', async () => {
    const auth = JSON.parse(await run($, [await at($, BIN.claude), 'auth', 'status'], { timeoutMs: 8000 }))
    return { plan: auth.subscriptionType }
  })
}

export async function codex($: $) {
  const codexHome = await at($, '.codex')
  const req = [
    { id: 0, method: 'initialize', params: { clientInfo: { name: 'agent-overview', version: '0' } } },
    { method: 'initialized' },
    { id: 2, method: 'account/rateLimits/read', params: null },
    { id: 3, method: 'model/list', params: {} },
    { id: 4, method: 'account/usage/read', params: null },
  ]
  // app-server quits as soon as stdin closes, so keep it open while the answers come back.
  const lines = req.map(r => `'${JSON.stringify(r)}'`).join(' ')
  const path = await present($, 'codex')
  if (path === undefined) return
  const script = `{ printf '%s\\n' ${lines}; sleep 6; } | '${path.replace(/'/g, `'"'"'`)}' app-server`
  return guard($, 'codex', 'usage', async () => {
    const r = await $.process.run(['/bin/sh', '-c', script], { cwd: '/tmp', timeoutMs: 15000, env: { CODEX_HOME: codexHome, ...(await toolEnv($, path)) } })
    if (!r.stdout.trim()) throw new Error(r.stderr.trim().split('\n').pop() || `codex exited ${r.exitCode}`)
    const configs = [{ home: 'your Codex config', toml: await $.fs.read(`${codexHome}/config.toml`).catch(() => '') }]
    return parseCodex(r.stdout, configs, await $.clock.now())
  })
}

const USAGE_INTERVAL = 180000
type UsageSnapshot = Pick<ProviderInfo, 'meters' | 'plan' | 'facts' | 'alert' | 'usageAt' | 'usageSource' | 'note' | 'current'> & { fetchedAt: number }
const usagePending = new Map<Provider, Promise<UsageSnapshot>>()

// Share only parsed display data; credentials and raw responses stay inside the fetch's stack.
async function collectUsage($: $, p: 'opencode' | 'commandcode', manual: boolean, collect: (live: boolean) => Promise<Partial<ProviderInfo>>) {
  let task = usagePending.get(p)
  if (!task) {
    task = (async () => {
      const now = await $.clock.now()
      const key = `usageAttempt:${p}`
      const snapshotKey = `usageSnapshot:${p}`
      const [last, cached] = await Promise.all([$.store.get(key).catch(() => undefined), $.store.get(snapshotKey).catch(() => undefined) as Promise<UsageSnapshot | undefined>])
      const due = manual || typeof last !== 'number' || now < last || now - last >= USAGE_INTERVAL
      if (!due && cached) return cached
      if (due) await $.store.set(key, now).catch(() => {})
      const got = await collect(due)
      const snapshot: UsageSnapshot = { meters: got.meters ?? [], plan: got.plan, facts: got.facts ?? [], alert: got.alert, usageAt: got.usageAt, usageSource: got.usageSource, note: got.note, current: got.current, fetchedAt: now }
      await $.store.set(snapshotKey, snapshot).catch(() => {})
      return snapshot
    })()
    usagePending.set(p, task)
  }
  try {
    const { fetchedAt, meters, plan, facts, alert, usageAt, usageSource, note, current } = await task
    // JSON drops undefined fields in the store; restore them to clear a previous alert or note.
    const got = { meters, plan, facts, alert, usageAt, usageSource, note, current }
    // A failed usage fetch must not erase a quota hit reported by this session's run.
    if (got.usageSource !== 'live' && (await read($, providers).then(allOf))[p].alert === 'quota hit · its run said so') got.alert = 'quota hit · its run said so'
    await patchUsage($, p, { ...got, checkedAt: fetchedAt })
  } finally { if (usagePending.get(p) === task) usagePending.delete(p) }
}

async function usageJson($: $, url: string, key: string, command = false) {
  if (!(command ? url.startsWith('https://api.commandcode.ai/alpha/') : url === 'https://opencode.ai/zen/go/v1/usage')) throw new Error('usage unavailable')
  let timer: ReturnType<$['clock']['after']> | undefined
  try {
    // The host fetch has no abort option; late replies cannot update usage after this deadline.
    const response = await Promise.race([
      $.http.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${key}`, ...(command ? { 'User-Agent': 'agent-overview' } : {}) } }),
      new Promise<never>((_resolve, reject) => { timer = $.clock.after(10000, () => reject(new Error('usage unavailable'))) }),
    ])
    if (!response.ok) throw new Error('usage unavailable')
    return JSON.parse(response.text) as any
  } finally { timer?.cancel() }
}

const amount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0
const dateMs = (x: unknown) => typeof x === 'number' ? x : typeof x === 'string' ? Date.parse(x) : NaN
const resetDetail = (at: number, now: number) => `resets in ${until(at - now) || '0m'}`

async function liveCommandCode($: $, now: number): Promise<Partial<ProviderInfo> | undefined> {
  try {
    const key = await $.env.get('COMMAND_CODE_API_KEY') || (await readJson($, '.commandcode/auth.json'))?.apiKey
    if (typeof key !== 'string' || !key.trim()) return
    const base = 'https://api.commandcode.ai/alpha'
    const who = await usageJson($, `${base}/whoami?limits=1`, key, true)
    // Teams answer whoami with org.id and take an orgId query; personal accounts answer org: null and take none.
    const orgId = typeof who?.org?.id === 'string' && who.org.id ? who.org.id : ''
    if (orgId && orgId.includes(key)) return
    const org = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
    const [billing, subs] = await Promise.all([
      usageJson($, `${base}/billing/credits${org}`, key, true),
      usageJson($, `${base}/billing/subscriptions${org}`, key, true),
    ])
    const subscription = subs?.data
    if (!Number.isFinite(dateMs(subscription?.currentPeriodStart)) || !Number.isFinite(dateMs(subscription?.currentPeriodEnd))) return
    if (String(subscription.currentPeriodStart).includes(key)) return
    const usage = await usageJson($, `${base}/usage/summary${org}${org ? '&' : '?'}since=${encodeURIComponent(String(subscription.currentPeriodStart))}`, key, true)
    if (!amount(usage?.totalCredits) || !amount(billing?.credits?.monthlyCredits)) return
    for (const win of [billing?.windowLimits?.fiveHour, billing?.windowLimits?.weekly]) {
      if (win && (!amount(win.cap) || !amount(win.used) || (win.cap > 0 && !Number.isFinite(dateMs(win.resetAt))))) return
    }
    const result = commandCodeInfo({ ...billing, subscription, usage }, now, true, now)
    if (!JSON.stringify(result).includes(key)) return result
  } catch { /* Auth, HTTP and parse failures are deliberately silent. */ }
}

function commandCodeInfo(o: any, now: number, live: boolean, stamp?: number): Partial<ProviderInfo> {
  const meters: Meter[] = []
  const w = o.windowLimits ?? {}
  // `limited` only says the plan has usage windows; a window is hit when it reports exceeded or is used up.
  const hit = (win: any) => win?.exceeded === true || (w.limited === true && amount(win?.cap) && win.cap > 0 && amount(win?.used) && win.used >= win.cap)
  const fresh = (win: any, window: number) => amount(win?.cap) && win.cap > 0 && amount(win.used) && stamp !== undefined && stamp <= now && now - stamp < window && dateMs(win.resetAt) > now
  for (const [label, win] of [['5-hour', w.fiveHour], ['Weekly', w.weekly]] as const) {
    if (!amount(win?.cap) || !(win.cap > 0) || !amount(win.used)) continue
    // A window that reset since the desktop app last synced says nothing about now: leave it out.
    if (!live && !fresh(win, label === '5-hour' ? 5 * 3600000 : 7 * 86400000)) continue
    meters.push({ label, percent: (100 * win.used) / win.cap, detail: `${win.used.toFixed(1)} of ${win.cap} credits · ${resetDetail(dateMs(win.resetAt), now)}` })
  }
  // The monthly pool, as the website's bar shows it: used this period over used plus what is left.
  const used = o.usage?.totalCredits
  const remaining = o.credits?.monthlyCredits
  if (amount(used) && amount(remaining)) {
    const end = o.subscription?.currentPeriodEnd
    meters.unshift({ label: 'Monthly', percent: used + remaining > 0 ? (100 * used) / (used + remaining) : 0, detail: `${used.toFixed(1)} of ${Math.round(used + remaining)} credits${Number.isFinite(dateMs(end)) ? ` · ${resetDetail(dateMs(end), now)}` : ''}` })
  }
  const facts: string[] = []
  if (amount(remaining)) facts.push(`${remaining.toFixed(2)} monthly credits left`)
  if (Number.isFinite(dateMs(o.subscription?.currentPeriodEnd))) facts.push(`period ends ${new Date(dateMs(o.subscription.currentPeriodEnd)).toISOString().slice(0, 10)}`)
  if (o.usage?.totalCount) facts.push(`${o.usage.totalCount} requests this period`)
  const age = stamp !== undefined ? Math.max(0, now - stamp) : 0
  if (!live) for (const meter of meters) meter.detail += stamp !== undefined ? ` · as of ${new Date(stamp).toDateString()}` : ' · sync date unknown'
  return {
    usageAt: stamp,
    usageSource: live ? 'live' : 'desktop',
    plan: typeof o.subscription?.planId === 'string' ? o.subscription.planId : typeof o.credits?.planId === 'string' ? o.credits.planId : undefined,
    meters,
    facts,
    alert: (live && !!w.exceeded) || ([[w.fiveHour, 5 * 3600000], [w.weekly, 7 * 86400000]] as const).some(([win, span]) => hit(win) && (live || fresh(win, span))) ? 'rate-limited' : undefined,
    note: live ? undefined : `numbers from the desktop app, ${stamp !== undefined ? `${until(age) || '0m'} old` : 'sync date unknown'}; open it to refresh`,
  }
}

export async function commandCodeUsage($: $, manual = false) {
  if ((await present($, 'commandcode')) === undefined) return
  return collectUsage($, 'commandcode', manual, async live => {
    const state = await readJson($, CC_STATE).catch(() => undefined)
    const now = await $.clock.now()
    const fetched = dateMs(state?.accountCache?.fetchedAt)
    const got = (live ? await liveCommandCode($, now) : undefined) ?? commandCodeInfo(state?.accountCache?.result?.overview ?? {}, now, false, Number.isFinite(fetched) ? fetched : undefined)
    return { ...got, current: state?.appState?.model }
  })
}

export async function commandCodeModels($: $) {
  const path = await present($, 'commandcode')
  if (path === undefined) return
  return guard($, 'commandcode', 'models', async () => {
    // The desktop app without its CLI has no model list to ask for.
    const models = path ? parseCmdModels(await runTool($, path, ['--list-models'], { timeoutMs: 20000 })) : []
    return { models }
  })
}

// OpenCode Go's limits are dollar amounts per rolling window (opencode.ai/docs/go; they may change).
const GO_WINDOWS = [
  { label: '5-hour', secs: 5 * 3600, cap: 12 },
  { label: 'Weekly', secs: 7 * 86400, cap: 30 },
  { label: 'Monthly', secs: 30 * 86400, cap: 60 },
]

async function liveOpencode($: $, now: number): Promise<Partial<ProviderInfo> | undefined> {
  try {
    let key = await $.env.get('OPENCODE_API_KEY')
    if (!key) {
      const dataHome = await $.env.get('XDG_DATA_HOME') || await at($, '.local/share')
      const auth = (await readJson($, `${dataHome}/opencode/auth.json`))?.['opencode-go']
      if (auth?.type === 'api') key = auth.key
    }
    if (typeof key !== 'string' || !key.trim()) return
    const response = await usageJson($, 'https://opencode.ai/zen/go/v1/usage', key)
    const meters: Meter[] = []
    for (const [id, label] of [['rolling', '5-hour'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] as const) {
      const win = response?.usage?.[id]
      if (!amount(win?.percent) || !['ok', 'rate-limited'].includes(win.status) || !Number.isFinite(dateMs(win.resetsAt))) return
      meters.push({ label, percent: Math.min(100, Math.floor(win.percent)), limited: win.status === 'rate-limited', detail: `${resetDetail(dateMs(win.resetsAt), now)}${win.status === 'rate-limited' ? ' · rate-limited' : ''}` })
    }
    return { meters, plan: 'Go', usageAt: now, usageSource: 'live', note: undefined, alert: meters.some(m => m.limited) ? 'rate-limited' : undefined }
  } catch { /* Never expose auth file contents, response bodies or fetch errors. */ }
}

async function opencodeLocal($: $): Promise<Partial<ProviderInfo>> {
  const db = '.local/share/opencode/opencode.db'
  const week = await sql($, db, "select json_extract(model,'$.providerID')||'/'||json_extract(model,'$.id') m, count(*) n, sum(cost) cost, sum(tokens_input+tokens_output) tok, max(time_updated) last from session where model is not null and time_updated > (strftime('%s','now')-7*86400)*1000 group by m order by last desc")
  const all = await sql($, db, 'select count(*) n, sum(cost) cost from session')
  const latest = await sql($, db, "select json_extract(model,'$.providerID')||'/'||json_extract(model,'$.id') m from session where model is not null order by time_updated desc limit 1")
  const spent = week.reduce((s, r) => s + (r.cost ?? 0), 0)
  const win = (await sql($, db, `select ${GO_WINDOWS.map(x => `sum(case when time_created > (strftime('%s','now')-${x.secs})*1000 then json_extract(data,'$.cost') end) w${x.secs}`).join(', ')} from message where json_extract(data,'$.role')='assistant' and time_created > (strftime('%s','now')-2592000)*1000`))[0] ?? {}
  const meters: Meter[] = GO_WINDOWS.map(x => {
    const used = Number(win[`w${x.secs}`] ?? 0)
    return { label: x.label, percent: (100 * used) / x.cap, detail: `≈ $${used.toFixed(2)} of $${x.cap} · this Mac only` }
  })
  const facts = [
    `$${spent.toFixed(2)} spent in 7 days`,
    `${week.reduce((s, r) => s + r.n, 0)} sessions in 7 days`,
    `$${(all[0]?.cost ?? 0).toFixed(2)} all time`,
    ...week.slice(0, 3).map(r => `${r.m}: ${r.n} sessions, ${compact(r.tok ?? 0)} tokens`),
  ]
  return { current: latest[0]?.m, meters, facts, plan: 'Go', usageSource: 'estimate', usageAt: await $.clock.now(), alert: undefined, note: 'estimates · this Mac only · opencode.ai shows the exact figures' }
}

export async function opencodeUsage($: $, manual = false) {
  if ((await present($, 'opencode')) === undefined) return
  return collectUsage($, 'opencode', manual, async live => {
    const [local, exact] = await Promise.all([
      opencodeLocal($).catch((): Partial<ProviderInfo> => ({ meters: [], facts: [], usageSource: 'estimate', usageAt: undefined, alert: undefined, note: 'estimates unavailable · this Mac only' })),
      live ? liveOpencode($, await $.clock.now()) : undefined,
    ])
    return { ...local, ...exact }
  })
}

export async function opencodeModels($: $) {
  const path = await present($, 'opencode')
  if (path === undefined) return
  return guard($, 'opencode', 'models', async () => {
    const models = parseOpencodeVerbose(await runTool($, path, ['models', 'opencode-go', '--verbose'], { timeoutMs: 20000 }))
    return { models }
  })
}

export function parseAgyQuota(text: string, r: ReturnType<typeof defaultRouting>, now: number): Partial<ProviderInfo> {
  const groups = JSON.parse(text)?.command?.data?.groups
  if (!Array.isArray(groups) || !groups.length) throw new Error('usage groups missing')
  const quota: Meter[] = []
  for (const group of groups) {
    if (!Array.isArray(group.buckets)) throw new Error('usage buckets missing')
    for (const b of group.buckets) {
      const bucket = /argon/i.test(`${b.id} ${group.name}`) ? 'Argon' : /3p|claude|gpt/i.test(`${b.id} ${group.name}`) ? 'Claude/GPT' : /gemini/i.test(`${b.id} ${group.name}`) ? 'Gemini' : undefined
      if (!bucket || !['weekly', '5h'].includes(b.window)) continue
      if (typeof b.remaining_fraction !== 'number' || !Number.isFinite(b.remaining_fraction) || b.remaining_fraction < 0 || b.remaining_fraction > 1) throw new Error('invalid usage fraction')
      const resetAt = Date.parse(b.reset_time)
      quota.push({ label: `${bucket} ${b.window === 'weekly' ? 'wk' : '5h'}`, percent: (1 - b.remaining_fraction) * 100,
        ...(Number.isFinite(resetAt) ? { resetAt, detail: `resets in ${until(resetAt - now) || '0m'}` } : {}),
      })
    }
  }
  if (!['Gemini 5h', 'Gemini wk', 'Argon wk'].every(label => quota.some(m => m.label === label))) throw new Error('usage quota incomplete')
  const thirdParty = [r.agyCodingModel, r.agyVisualModel].some(m => agyBucket(m) === 'Claude/GPT')
  const order = ['Gemini 5h', 'Gemini wk', 'Argon wk', 'Claude/GPT 5h', 'Claude/GPT wk']
  quota.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
  return { meters: quota.filter(m => thirdParty || !m.label.startsWith('Claude/GPT ')), agyQuota: quota, facts: [], alert: undefined, note: undefined, usageAt: now, usageSource: 'live' }
}

export async function antigravityUsage($: $) {
  const path = await present($, 'antigravity')
  if (path === undefined) return
  return guard($, 'antigravity', 'usage', async () => {
    const now = await $.clock.now()
    try {
      if (!path) throw new Error('no CLI')
      const text = await runTool($, path, ['-p', '/usage', '--output-format', 'json', '--print-timeout', '30s'], { timeoutMs: 35000, stdin: '' })
      return parseAgyQuota(text, await read($, routing), now)
    } catch {}
    const days = await sql($, '.gemini/antigravity-cli/conversation_summaries.db', 'select date(last_modified_time) d, count(*) n, sum(step_count) steps from conversation_summaries group by 1 order by 1 desc limit 7').catch(() => [])
    const cfg = await readJson($, '.local/share/antigravity-mcp/config.json').catch(() => ({}))
    const recent = (await sql($, '.gemini/antigravity-cli/conversation_summaries.db', "select count(*) n, sum(step_count) steps from conversation_summaries where last_modified_time > datetime('now','-5 hours')").catch(() => []))[0]
    const facts = [`${recent?.n ?? 0} conversations, ${recent?.steps ?? 0} steps in the last 5 hours`, ...days.slice(0, 1).map(d => `${d.n} conversations, ${d.steps} steps on ${d.d}`)]
    const week = days.reduce((s, d) => s + d.n, 0)
    if (week) facts.push(`${week} conversations on the last ${days.length} active days`)
    let alert: string | undefined
    const logDir = await at($, '.gemini/antigravity-cli/log')
    const logs = (await $.fs.list(logDir).catch(() => [])).filter(f => f.name.startsWith('cli-')).sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const f of logs.slice(0, 40)) {
      const log = await $.fs.read(`${logDir}/${f.name}`).catch(() => '')
      const hit = log.split('\n').reverse().find(l => /RESOURCE_EXHAUSTED/.test(l))
      const resetAt = hit ? resetTime(hit, f.mtimeMs) : undefined
      if (resetAt && resetAt > now) { alert = `quota hit · resets in ${until(resetAt - now)}`; break }
    }
    return { current: cfg.model, meters: [], agyQuota: undefined, facts, alert, usageAt: now, usageSource: 'estimate', note: 'Live quota unavailable; local conversations and quota hits only' }
  })
}

export async function antigravityModels($: $) {
  const path = await present($, 'antigravity')
  if (path === undefined) return
  return guard($, 'antigravity', 'models', async () => {
    const models = path ? parseAgyModels(await runTool($, path, ['models'], { timeoutMs: 20000 })) : []
    return { models }
  })
}

export async function plugins($: $) {
  const list: InstalledPlugin[] = []
  try {
    const claude = JSON.parse(await run($, [await at($, BIN.claude), 'plugin', 'list', '--json'], { timeoutMs: 10000 })) as any[]
    for (const p of claude) {
      if (!p.installPath || p.noteDetails?.some((n: any) => n.type === 'synced-plugin-shadowed') || String(p.id).startsWith('agent-overview@')) continue
      const skills = p.installPath ? (await $.fs.list(`${p.installPath}/skills`).catch(() => [])).filter(x => x.kind === 'dir').map(x => x.name).sort() : []
      list.push({ name: String(p.id).split('@')[0]!, version: p.version, enabled: !!p.enabled, where: 'claude', skills })
    }
  } catch {}
  try {
    const agyPath = await locate($, 'agy')
    const agy = agyPath ? JSON.parse(await runTool($, agyPath, ['plugin', 'list', '--json'], { timeoutMs: 10000 })) as any[] : []
    for (const p of agy) list.push({ name: p.name, version: p.version, enabled: !!p.enabled, where: 'antigravity' })
  } catch {}
  let mcpServers: string[] = []
  let skills = 0
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const b = u.context.breakdown
    mcpServers = [...new Set((b?.mcpTools ?? []).map(t => t.serverName))].sort()
    skills = b?.skills?.totalSkills ?? 0
  } catch {}
  const tools = await $.tool.list().then(ts => ts.filter(t => t.mcp).map(t => t.name).sort()).catch(() => [] as string[])
  const next: Installed = { plugins: list, mcpServers, skills, tools }
  await update($, installed, () => next)
}

export function refreshUsage($: $, only?: Provider, manual = false) {
  const all: Record<Provider, () => Promise<unknown>> = {
    claude: () => Promise.all([claudeUsage($), claudePlan($)]),
    codex: () => codex($),
    commandcode: () => commandCodeUsage($, manual),
    opencode: () => opencodeUsage($, manual),
    antigravity: () => antigravityUsage($),
    ollama: () => ollamaCheck($),
  }
  return Promise.all((only ? [only] : (Object.keys(all) as Provider[])).map(p => all[p]()))
}

export function refreshModels($: $, only?: Provider) {
  const all: Record<Provider, () => Promise<unknown>> = {
    claude: () => claudeModels($),
    codex: () => codex($),
    commandcode: () => commandCodeModels($),
    opencode: () => opencodeModels($),
    antigravity: () => antigravityModels($),
    ollama: () => ollamaCheck($),
  }
  return Promise.all((only ? [only] : (Object.keys(all) as Provider[])).map(p => all[p]()))
}

// The owner asked to look again: forget what was not found, then read that provider anew.
export async function recheck($: $, p: Provider) {
  missed.clear()
  await Promise.all([refreshUsage($, p, true), ...(p === 'codex' ? [] : [refreshModels($, p)])])
  await watchQuota($)
}

// Providers out of quota go off until their reset (an hour when it is not known), then come back.
export async function watchQuota($: EngineInterface) {
  let all = await read($, providers).then(allOf)
  let r = await read($, routing)
  const agyQuota = all.antigravity.agyQuota
  const quotaChanged = JSON.stringify(r.agyQuota) !== JSON.stringify(agyQuota)
  if (quotaChanged) {
    r = await update($, routing, x => ({ ...x, agyQuota }))
    await storeRouting($, r)
    $.ui.invalidate('prompt.section')
  }
  if (!(await read($, guardSettings)).autoPause) return
  const now = await $.clock.now()
  const paused = { ...(r.paused ?? {}) }
  const on = { ...r.on }
  const said: string[] = []
  for (const p of OTHERS) {
    const was = paused[p]
    if (was && now >= was.until && all[p].alert === 'quota hit · its run said so') {
      all = allOf(await update($, providers, x => ({ ...x, [p]: { ...blank(), ...x[p], alert: x[p]?.alert === 'quota hit · its run said so' ? undefined : x[p]?.alert } })))
    }
    const jobs = p === 'antigravity' && agyQuota ? (['coding', 'visual'] as const).filter(job => job === 'coding' ? r.agyCoding : r.agyVisual).map(job => agyJobQuota(r, job, now)) : undefined
    const out = jobs?.length && jobs.every(Boolean) ? jobs.filter((q): q is NonNullable<typeof q> => !!q) : []
    const q = jobs ? out.length ? { why: 'Antigravity jobs out of quota', wait: Math.min(...out.map(q => q.wait ?? 3600000)) } : undefined : quotaOf(all[p], p)
    if (q && on[p] && !was) {
      on[p] = false
      paused[p] = { why: q.why, at: now, until: now + (q.wait ?? 3600000) }
      said.push(`· ${nameOf(p)} out of quota · off until ${new Date(paused[p]!.until).toTimeString().slice(0, 5)}`)
    } else if (was && (now >= was.until || p === 'antigravity' && agyQuota && !q)) {
      if (q) paused[p] = { ...was, until: now + (q.wait ?? 3600000) }
      else {
        delete paused[p]
        on[p] = true
        said.push(`▸ ${nameOf(p)} is back on`)
      }
    }
  }
  if (JSON.stringify(paused) === JSON.stringify(r.paused ?? {})) return
  const saved = normalRouting(r)
  for (const p of OTHERS) if (on[p] !== r.on[p] || JSON.stringify(paused[p]) !== JSON.stringify(r.paused?.[p])) {
    saved.on[p] = on[p]
    if (paused[p]) (saved.paused ??= {})[p] = paused[p]
    else delete saved.paused?.[p]
  }
  const next = await update($, routing, () => saved)
  await storeRouting($, next)
  $.ui.invalidate('prompt.section')
  for (const t of said) $.ui.toast(t)
}

// ---------- tokens, costs and prices ----------

// Today's Codex sessions, OpenCode's database, and Command Code's last synced period.
export async function tokens($: $) {
  const rows: TokenRow[] = []
  try {
    const now = new Date(await $.clock.now())
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const cut = midnight.toISOString().slice(0, 19)
    const since = `${cut.replace('T', ' ')} UTC`
    const dir = (await at($, '.codex/sessions')).replace(/'/g, `'"'"'`)
    const script = `find '${dir}' -name '*.jsonl' -newermt '${since}' | while IFS= read -r f; do m=$(grep -o '"model":"[^"]*"' "$f" | sort | uniq -c | sort -rn | head -1); t=$(grep '"token_count"' "$f" | tail -1); b=$(grep '"token_count"' "$f" | awk -v c='${cut}' 'substr($0,15,19)<c' | tail -1); printf '%s\\t%s\\t%s\\n' "$m" "$t" "$b"; done`
    const r = await $.process.run(['/bin/sh', '-c', script], { timeoutMs: 15000 })
    rows.push(...parseCodexTokens(r.stdout))
  } catch {}
  try {
    const db = '.local/share/opencode/opencode.db'
    const today = await sql($, db, "select json_extract(data,'$.providerID')||'/'||json_extract(data,'$.modelID') m, sum(json_extract(data,'$.tokens.input')) i, sum(coalesce(json_extract(data,'$.tokens.output'),0)+coalesce(json_extract(data,'$.tokens.reasoning'),0)) o, sum(json_extract(data,'$.tokens.cache.read')) cr, sum(json_extract(data,'$.tokens.cache.write')) cw, sum(json_extract(data,'$.cost')) c from message where json_extract(data,'$.role')='assistant' and time_created >= strftime('%s','now','localtime','start of day','utc')*1000 group by m")
    for (const x of today) rows.push({ provider: 'opencode', model: x.m, period: 'today', input: x.i ?? 0, output: x.o ?? 0, cacheRead: x.cr ?? 0, cacheWrite: x.cw ?? 0, reported: x.c ?? 0 })
  } catch {}
  try {
    const state = await readJson($, 'Library/Application Support/Command Code/app-state.json')
    const u = state?.accountCache?.result?.overview?.usage
    // Command Code bills in credits worth $1 each: its own usage reports totalCost equal to totalCredits.
    if (u?.totalTokens || u?.totalCost) rows.push({ provider: 'commandcode', model: state?.appState?.model ?? 'command code', period: 'period', input: u.totalTokensIn ?? 0, output: u.totalTokensOut ?? 0, cacheRead: 0, cacheWrite: 0, reported: u.totalCost ?? u.totalCredits ?? 0 })
  } catch {}
  let engineUsd: number | undefined
  try {
    engineUsd = (await $.session.usage()).cost?.usd
  } catch {}
  const checkedAt = await $.clock.now()
  const today = new Date(checkedAt).toDateString()
  const key = `base:${await $.session.id()}`
  const held = await read($, costs)
  const saved = held.baseDay ? undefined : await $.store.get(key).catch(() => undefined) as { day?: string; rows?: TokenRow[] } | undefined
  const baseDay = held.baseDay ?? saved?.day
  // A new day zeroes the daily rows; a billing-period total (Command Code) keeps its reading as the base.
  const base = baseDay === today ? held.base ?? saved?.rows ?? rows : baseDay ? rows.filter(r => r.period === 'period') : rows
  if (baseDay !== today) await $.store.set(key, { day: today, rows: base }).catch(() => {})
  await update($, costs, c => ({ ...c, rows, engineUsd, checkedAt, base, baseDay: today }))
  await ensurePrices($)
}

// Reload the price list when a model has tokens but no price yet (once per unknown model).
export async function ensurePrices($: $) {
  const c = await read($, costs)
  const pr = await read($, prices)
  const keys = [...Object.keys(c.claude), ...Object.keys(c.agy), ...c.rows.filter(r => r.reported === undefined).map(r => r.model)].map(priceKey)
  if (keys.some(k => !pr.catalog[k] && !pr.overrides[k] && !(pr.missing ?? []).includes(k))) await loadPrices($)
}

// Prices from the models.dev catalogue; `refresh` asks OpenCode to fetch it anew first.
export async function loadPrices($: $, refresh = false) {
  const opencodePath = refresh ? await locate($, 'opencode') : undefined
  if (opencodePath) await runTool($, opencodePath, ['models', '--refresh'], { timeoutMs: 30000 }).catch(() => '')
  try {
    const c = await read($, costs)
    const all = await read($, providers).then(allOf)
    const r = await read($, routing)
    const wanted = new Set<string>([
      ...c.rows.map(x => priceKey(x.model)),
      ...Object.keys(c.claude).map(priceKey),
      ...Object.keys(c.agy).map(priceKey),
      ...r.picks.filter(x => x.provider !== 'ollama').map(x => priceKey(x.model)),
      // Local models cost nothing: a catalogue price for the same open model would mislead.
      ...(Object.entries(all) as [Provider, ProviderInfo][]).filter(([p]) => p !== 'ollama').flatMap(([, p]) => p.models.map(m => priceKey(m.id))),
    ])
    // The catalogue is over $.fs.read's 4 MiB limit: node hands back just the prices (~0.7 MB).
    const trim = 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const o={};for(const[p,v]of Object.entries(d))for(const[m,x]of Object.entries(v.models||{}))if(x.cost&&typeof x.cost.input==="number")(o[p]??={models:{}}).models[m]={cost:x.cost};process.stdout.write(JSON.stringify(o))'
    const json = JSON.parse(await run($, [(await locate($, 'node')) ?? BIN.node, '-e', trim, await at($, '.cache/opencode/models.json')], { timeoutMs: 20000 }))
    const catalog = catalogFrom(json, wanted)
    const missing = [...wanted].filter(k => !catalog[k])
    const saved = (await $.store.get('prices').catch(() => undefined)) as Record<string, Price> | undefined
    const fetchedAt = await $.clock.now()
    await update($, prices, p => ({ catalog, overrides: saved ?? p.overrides, fetchedAt, missing }))
  } catch {}
}

// ---------- Ollama: models on this Mac, through its local server ----------

export const OLLAMA_URL = 'http://127.0.0.1:11434'
export const OLLAMA_DOWN = 'local server not running'
// Local generation runs near 20 tokens a second; a long answer to a long prompt takes minutes.
export const OLLAMA_TIMEOUT = 600000
// Prompts past about 6,000 tokens get the larger context window.
export const OLLAMA_LONG = 24000

// `ollama list`: NAME  ID  SIZE  MODIFIED, columns two or more spaces apart.
export function parseOllamaList(text: string): { models: ModelRow[]; embedders: number } {
  const rows = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.trim()).filter(l => l && !/^NAME\s/.test(l)).map(l => l.split(/\s{2,}/))
  const named = rows.filter(r => r[0] && /^[\w./:-]+$/.test(r[0]))
  const models = named.filter(r => !isEmbedder(r[0]!)).map(r => ({ id: r[0]!, info: [r[2], 'free · local'].filter(Boolean).join(' · ') }))
  return { models, embedders: named.length - models.length }
}

// The local server, with a deadline: the host fetch has no abort, so a late reply is ignored.
async function ollamaFetch($: $, path: string, init: { method: 'GET' | 'POST'; body?: string }, ms: number) {
  let timer: ReturnType<$['clock']['after']> | undefined
  try {
    return await Promise.race([
      $.http.fetch(`${OLLAMA_URL}${path}`, { method: init.method, ...(init.body !== undefined ? { body: init.body, headers: { 'Content-Type': 'application/json' } } : {}) }),
      new Promise<never>((_resolve, reject) => { timer = $.clock.after(ms, () => reject(new Error(`no answer from Ollama in ${Math.round(ms / 1000)}s`))) }),
    ])
  } finally { timer?.cancel() }
}
// Present when the CLI is there; available when its server answers `ollama list`.
export async function ollamaCheck($: $) {
  const path = await present($, 'ollama')
  if (path === undefined) return
  try {
    // `ollama list` asks the local server: it fails when the server is not running.
    const out = await runTool($, path, ['list'], { timeoutMs: 8000 }).catch(() => undefined)
    const got = out === undefined ? undefined : parseOllamaList(out)
    const was = (await read($, providers).then(allOf)).ollama ?? blank()
    const now = await $.clock.now()
    const offline = got ? undefined : OLLAMA_DOWN
    await patch($, 'ollama', {
      status: 'ok', error: undefined, offline, checkedAt: now, meters: [], alert: undefined, plan: 'local',
      models: got?.models ?? was.models,
      facts: got ? ['server running', `${got.models.length} chat model${got.models.length === 1 ? '' : 's'} installed`, ...(got.embedders ? [`${got.embedders} embedding model${got.embedders === 1 ? '' : 's'} not offered for tasks`] : []), 'free · no quota'] : ['free · no quota'],
      note: got ? undefined : 'installed, but its local server is not answering: open the Ollama app',
    })
    // The routing told to the model names Ollama only while its server answers.
    if (!!was.offline !== !!offline || was.status !== 'ok') $.ui.invalidate('prompt.section')
  } catch {}
}

export type OllamaRun = { text: string; model: string; outputTokens?: number; inputTokens?: number; ms?: number; doneReason?: string }
export type OllamaOpts = { system?: string; long?: boolean; think?: boolean; format?: 'json' | Record<string, unknown>; images?: string[] }
export const ollamaBody = (model: string, prompt: string, opts: OllamaOpts = {}) => ({
  model, prompt, stream: false, keep_alive: '10m',
  ...(opts.system ? { system: opts.system } : {}),
  ...(opts.format ? { format: opts.format } : {}),
  ...(opts.images?.length ? { images: opts.images } : {}),
  options: { num_ctx: opts.long || prompt.length + (opts.system?.length ?? 0) > OLLAMA_LONG ? 16384 : 8192 },
  // Thinking models answer straight away: reasoning would only slow a small local job. Others ignore it.
  ...(opts.think === false ? { think: false } : {}),
})

// Short answers add up per model until they make one sample the speed store keeps.
const pendingSpeed = new Map<string, { outputTokens: number; ms: number }>()
export async function ollamaSpeed($: $, model: string, outputTokens: number, ms: number) {
  if (!(outputTokens > 0) || !(ms > 0)) return
  const held = pendingSpeed.get(model) ?? { outputTokens: 0, ms: 0 }
  const next = { outputTokens: held.outputTokens + outputTokens, ms: held.ms + ms }
  if (next.outputTokens < 200 || next.ms < 2000) { pendingSpeed.set(model, next); return }
  pendingSpeed.delete(model)
  await recordSpeed($, model, next.outputTokens, next.ms)
}

// One generation, not streamed. Speed comes from Ollama's own counts: eval_count over eval_duration (ns).
export async function ollamaGenerate($: $, model: string, prompt: string, opts: Omit<OllamaOpts, 'think'> = {}): Promise<OllamaRun> {
  const send = async (body: object) => {
    const response = await ollamaFetch($, '/api/generate', { method: 'POST', body: JSON.stringify(body) }, OLLAMA_TIMEOUT)
    let json: any = {}
    try { json = JSON.parse(response.text) } catch {}
    return { response, json }
  }
  let { response, json } = await send(ollamaBody(model, prompt, { ...opts, think: false }))
  // Should a server refuse the switch for a model that cannot think, ask again without it.
  if (!response.ok && /think/i.test(String(json?.error ?? ''))) ({ response, json } = await send(ollamaBody(model, prompt, opts)))
  if (!response.ok) throw new Error(String(json?.error ?? `HTTP ${response.status}`).slice(0, 300))
  const text = typeof json?.response === 'string' ? json.response : ''
  const outputTokens = typeof json?.eval_count === 'number' ? json.eval_count : undefined
  const ms = typeof json?.eval_duration === 'number' ? json.eval_duration / 1e6 : undefined
  if (outputTokens !== undefined && ms !== undefined) await ollamaSpeed($, model, outputTokens, ms)
  const inputTokens = typeof json?.prompt_eval_count === 'number' ? json.prompt_eval_count : undefined
  return { text, model, outputTokens, inputTokens, ms, doneReason: typeof json?.done_reason === 'string' ? json.done_reason : undefined }
}
