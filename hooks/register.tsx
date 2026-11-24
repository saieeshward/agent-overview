import { codexOutput, loadSpeeds, recordSpeed } from './speed'
import { atom, read, update } from 'claude-code'
import { restorePresets } from './preset-state'
import { emitVibe } from './vibe/events'
import { restoreDecisions } from './vibe/decisions'
import { restoreMode, saveStage } from './modes'
import { syncWorkSkills } from './work/settings'
import { registerVibe } from './vibe/loop'
import { contextHint, registerChatSurfaces } from './chat-surfaces'
import { registerChatLook } from './chat-look'
import { officeRail } from './office-rail'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Act, AgentNode, Confidential, Lane, RouteLogItem, Sensitivity, Costs, DecisionItem, Finding, Stage, Installed, Media, Mode, EditItem, GitInfo, GrillItem, History, HistoryItem, Impl, LiveEdit, MainInfo, ModelSpeeds, Prices, Provider, Providers, Routing, SideLive, TurnCost, Ui, Used, Written } from '../types'
import { antigravityUsage, claudeUsage, ensurePrices, loadPrices, ollamaGenerate, OLLAMA_DOWN, OLLAMA_LONG, plugins, refreshModels, refreshUsage, tokens, watchQuota } from './providers'
import { addTokens, claudeTotal, elevenCredits, matchTurnCost, mediaReadOnly, mediaService, mediaShort, mediaText, money, outputTokens, parseAgyUsage, refreshMedia, rowCost, spendBy, zero } from './cost'
import { allOf, agyJobModel, agyJobOn, agyModelNotice, OTHERS, PROVIDERS, blank, isEmbedder, offlineOf, loadRouting, pruneStore, defaultRouting, handoffText, livePicks, nameOf, normalGuard, normalRouting, ownerName, planDeny, routingText, setOwner, subagentRoute, withFlags, missingOf, without } from './state'
import { babysitting, babysitterModel, displayAgents } from './babysitter'
import type { SubagentRoute } from './state'
import { externalOf, labelOf, mine, QUOTA_TEXT, detachedCommand, sideCommand, sideMarkers, sideRuns, stateOf, stdinFileOf, taskOf, usageTail, watchKey } from './graph'
import { STREAMED, editWindow, hunk, numstat, partialField, sideWindow, trimEdits } from './stream'
import { DEFAULT_PINS, MARKS, dropServerBlocks, filterListing, forcedText, offText, skillMode, toolMode } from './toggles'
import { PANE, drawBand, drawPane, fit, tok } from './view'
import { IMPACT, shortModel, tableOf } from './ui'
import { autoAntigravity } from './auto'
import { mergeFinding, stageDeny, workText } from './work/stage'
import { geminiRun, vetImages } from './gemini'
import { runsAgy } from './agyguard'
import { cleanPicked, listWorktrees, listingText, parsePicks } from './worktrees'
import { ADVERSARY, ADVERSARY_MODEL, ADVERSARY_PROMPT, cancel as cancelReview, mainTurnEnded, mainTurnStarted, noteReviewer, takeSpawn, parseArgs, prepare as prepareReview, reviewerDone, startRound, statusText } from './adversarial'
import { escalation, failure, isEscalated, shapeFailure, shapeOf, tidy } from './escalate'
import type { Format } from './escalate'
import { GEMINI_DEFAULT, GEMINI_MODELS, isDefaultVisual } from './policy'
import { flushCheck, mark, markCount, readDebugLog, startCheck } from './hookcheck'
import { FALLBACK, CLIENT_PATTERNS, clientHit, strictest, sideSensitivity, cloudCheck, declarationText, defaultPolicy, isProblem, neverCommitPatterns, laneName, laneTool, lanesOpen, loadPolicy, logRoute, lowerEffort, parseDeclaration, resolveRoute, settleRoute } from './policy'
import type { Resolved } from './policy'

// State lives here as well as beside the other hooks: the engine lists each file's reads and writes from its own consts.
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
// What each spawned agent declared, kept apart from `nodes` (capped at 60) so a busy session cannot evict it; its own cap is 500.
type KeptSens = { agentId: string; sensitivity?: string; parent?: string; escalated?: boolean }
const agentSens = atom({ plugin: 'agent-overview', key: 'agentSens' } as const, [] as KeptSens[])
const AGENT_SENS_CAP = 500
const grill = atom({ plugin: 'agent-overview', key: 'grill' } as const, [] as GrillItem[])
const decisions = atom({ plugin: 'agent-overview', key: 'decisions' } as const, [] as DecisionItem[])
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
const written = atom({ plugin: 'agent-overview', key: 'written' } as const, { added: 0, removed: 0, files: [] } as Written)
const live = atom({ plugin: 'agent-overview', key: 'live' } as const, null as LiveEdit | null)
const sideLive = atom({ plugin: 'agent-overview', key: 'sideLive' } as const, null as SideLive | null)
const acts = atom({ plugin: 'agent-overview', key: 'acts' } as const, {} as Record<string, Act>)
const lastLive = atom({ plugin: 'agent-overview', key: 'lastLive' } as const, null as LiveEdit | null)
const git = atom({ plugin: 'agent-overview', key: 'git' } as const, { error: 'loading' } as GitInfo)
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {
  claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(), ollama: blank(),
} as Providers)
const used = atom({ plugin: 'agent-overview', key: 'used' } as const, { mcp: {}, skills: {}, agentTypes: {} } as Used)
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const tick = atom({ plugin: 'agent-overview', key: 'tick' } as const, 0)
const modelSpeeds = atom({ plugin: 'agent-overview', key: 'modelSpeeds' } as const, {} as ModelSpeeds)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const history = atom({ plugin: 'agent-overview', key: 'history' } as const, { since: 0, items: [] } as History)
const costs = atom({ plugin: 'agent-overview', key: 'costs' } as const, { rows: [], claude: {}, agy: {} } as Costs)
const media = atom({ plugin: 'agent-overview', key: 'media' } as const, {} as Media)
const turnCosts = atom({ plugin: 'agent-overview', key: 'turnCosts' } as const, [] as TurnCost[])
const toggles = atom({ plugin: 'agent-overview', key: 'toggles' } as const, {} as Record<string, Mode>)
const pins = atom({ plugin: 'agent-overview', key: 'pins' } as const, [] as string[])
const installed = atom({ plugin: 'agent-overview', key: 'installed' } as const, { plugins: [], mcpServers: [], skills: 0 } as Installed)
const prices = atom({ plugin: 'agent-overview', key: 'prices' } as const, { catalog: {}, overrides: {} } as Prices)
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
type DeliveredPrompt = { sessionId: string; routing: string; work: string }
const deliveredPrompt = atom({ plugin: 'agent-overview', key: 'deliveredPrompt' } as const, null as DeliveredPrompt | null)


const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const impl = atom({ plugin: 'agent-overview', key: 'impl' } as const, { agents: [] } as Impl)
const findings = atom({ plugin: 'agent-overview', key: 'findings' } as const, [] as Finding[])
const policy = atom({ plugin: 'agent-overview', key: 'policy' } as const, defaultPolicy())
const routeLog = atom({ plugin: 'agent-overview', key: 'routeLog' } as const, [] as RouteLogItem[])
const confidential = atom({ plugin: 'agent-overview', key: 'confidential' } as const, { cwd: '', found: [], sources: [] } as Confidential)

const GRILL_TOOL = 'mcp__agent-overview__grill_log'
const QA_TOOL = 'mcp__agent-overview__qa_log'
const DECISION_TOOL = 'mcp__agent-overview__decision_log'
const REVIEW_TOOL = 'mcp__agent-overview__review_log'
const OLLAMA_TOOL = 'mcp__agent-overview__ollama_run'
const GEMINI_TOOL = 'mcp__agent-overview__gemini_run'
const REVIEW_PREP_TOOL = 'mcp__agent-overview__adversarial_review'

export { providerOf as family } from './state'

export { externalOf } from './graph'

const AT = String.raw`(?:^|[;&|(]\s*|\s(?:env|exec|time|nohup)\s+)(?:(?:env\s+)?[A-Za-z_]\w*=\S*\s+)*(?:[^\s;&|()]*/)?`

// Only literal directories are safe to resolve without running a shell.
const literalDir = (text: string, home: string): string | undefined => {
  const raw = text.trim()
  const s = home && /^(?:~\/|~$)/.test(raw) ? home + raw.slice(1) : raw
  if (!s || /[$`~\\]/.test(s)) return undefined
  if (/^["']/.test(s)) {
    return s.length > 2 && s[s.length - 1] === s[0] && !/["']/.test(s.slice(1, -1)) ? s.slice(1, -1) : undefined
  }
  return /[\s"';&|()<>]/.test(s) ? undefined : s
}
export const reviewCwd = (command: string, provider: Provider, home = ''): { cwd?: string } | undefined => {
  command = command.trimStart()
  let cwd: string | undefined
  const cd = /^\s*cd\s+(.+?)\s*(?:&&|;)/.exec(command)
  if (/^\s*cd\b/.test(command)) {
    if (!cd) return undefined
    cwd = literalDir(cd[1]!, home)
    if (!cwd) return undefined
    command = command.slice(cd[0].length).trimStart()
    // A second shell directory change needs a shell parser; skip the review.
    if (/\bcd\s/.test(command.split(/&&|;/).slice(0, -1).join(';'))) return undefined
  }
  const found = sideCommand(command)
  if (!found) return undefined
  if (found.shell) {
    const inner = reviewCwd(found.shell.command, provider, home)
    if (!inner) return undefined
    return { cwd: inner.cwd ? cwd && !inner.cwd.startsWith('/') ? `${cwd}/${inner.cwd}` : inner.cwd : cwd }
  }
  command = found.text
  if (provider === 'codex') {
    if (found.provider !== provider) return undefined
    const call = new RegExp(`${AT}codex\\s+`).exec(command)
    if (!call) return undefined
    const tail = command.slice(call.index + call[0].length)
    const words = [...tail.matchAll(/\d*(?:<<|>>|[<>])&?|(?:"(?:[^"\\]|\\.)*"|'[^']*'|\\.|[^\s;&|"'\\])+|&&|[;&|]/g)]
    let end = 0
    for (const word of words) {
      if (tail.slice(end, word.index).trim()) return undefined
      end = word.index! + word[0].length
    }
    if (tail.slice(end).trim()) return undefined
    const args = words.map(w => w[0])
    const shellCwd = cwd
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (/^[;&|]/.test(arg)) break
      if (arg === '-C' || arg === '--cd' || /^(?:-C|--cd)=/.test(arg)) {
        const dir = literalDir(arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i] ?? '', home)
        if (!dir) return undefined
        cwd = dir.startsWith('/') || !shellCwd ? dir : `${shellCwd}/${dir}`
      } else if (['-m', '--model', '-c', '--config', '-p', '--profile', '-s', '--sandbox', '-o', '--output-last-message', '--output-schema', '-i', '--image'].includes(arg)) i++
    }
  }
  return { cwd }
}

async function sh($: EngineInterface, ...argv: string[]) {
  try {
    const r = await $.process.run(['git', ...argv], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : undefined
  } catch {
    return undefined
  }
}

async function refreshGit($: EngineInterface) {
  const branch = await sh($, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (branch === undefined) return update($, git, () => ({ error: 'not a git repo' }))
  const commit = (await sh($, 'log', '-1', '--format=%h %s · %cr')) ?? 'no commits yet'
  const dirty = ((await sh($, 'status', '--porcelain')) ?? '').split('\n').filter(Boolean).length
  const counts = await sh($, 'rev-list', '--left-right', '--count', '@{u}...HEAD')
  const [behind, ahead] = counts?.split(/\s+/) ?? []
  const sync = counts ? `↑${ahead} ↓${behind}` : 'no upstream'
  const recent = ((await sh($, 'log', '-6', '--format=%h %s · %cr')) ?? '').split('\n').filter(Boolean)
  return update($, git, () => ({ branch, commit, dirty, ahead: sync, recent }))
}

function setNode($: EngineInterface, match: (n: AgentNode) => boolean, change: (n: AgentNode) => AgentNode) {
  return update($, nodes, list => list.map(n => (match(n) ? change(n) : n)))
}

const owned = new Set<string>()
async function track<R>($: EngineInterface, node: AgentNode, run: () => Promise<R>, detached = false) {
  owned.add(node.id)
  await update($, nodes, list => [...list, node].slice(-60))
  let state: AgentNode['state'] = 'failed'
  let output = ''
  let usageOutput = ''
  let outputFile: string | undefined
  let background = detached
  try {
    const ran = (await run()) as R & { isError?: boolean; deny?: string; text?: string; result?: unknown }
    state = ran.isError || ran.deny ? 'failed' : 'done'
    const result = ran.result as { stdout?: string; stderr?: string; backgroundTaskId?: string; backgroundOutputPath?: string; persistedOutputPath?: string; rawOutputPath?: string } | undefined
    background ||= !!result?.backgroundTaskId
    outputFile = result?.backgroundOutputPath ?? result?.persistedOutputPath ?? result?.rawOutputPath
    output = ran.deny ?? ran.text ?? (typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? ''))
    usageOutput = mediaText([ran.text ?? '', result?.stdout ?? '', result?.stderr ?? '', ran.result ?? '', JSON.stringify(ran.result ?? '')])
    if (!background && outputFile) usageOutput += '\n' + await $.fs.read(outputFile).catch(() => '')
    return ran
  } finally {
    const endedAt = await $.clock.now()
    const pending = background && state === 'done'
    await setNode($, n => n.id === node.id, n => ({ ...n, state: pending ? 'running' : state, endedAt: pending ? undefined : endedAt, output: clip(output, 2000), outputFile }))
    owned.delete(node.id)
    if (!pending) {
      await clearSideLive($, node.id)
      await remember($, node, state, endedAt)
      const produced = node.provider === 'codex' ? await codexOutput($, usageOutput, node.startedAt ?? endedAt, endedAt) : outputTokens(usageOutput)
      await recordSpeed($, node.model, produced ?? 0, endedAt - (node.startedAt ?? endedAt))
    }
  }
}

async function sidePrompt($: EngineInterface, command: string, pid?: number, cwd?: string) {
  const task = taskOf(command)
  if (task) return task.slice(0, 200 * 1024)
  try {
    let file = stdinFileOf(command)
    if (pid !== undefined) {
      const result = await $.process.run(['/usr/sbin/lsof', '-a', '-p', String(pid), '-d', '0', '-Fn'], { timeoutMs: 4000 })
      if (result.exitCode !== 0 || result.isStdoutTruncated) return undefined
      file = result.stdout.split('\n').find(l => l.startsWith('n/'))?.slice(1)
    }
    if (!file) return undefined
    if (cwd && !file.startsWith('/')) file = `${cwd}/${file}`
    if ((await $.fs.stat(file)).kind !== 'file') return undefined
    return (await $.fs.read(file)).slice(0, 200 * 1024) || undefined
  } catch { return undefined }
}

async function sideOutput($: EngineInterface, pid: number) {
  try {
    const result = await $.process.run(['/usr/sbin/lsof', '-a', '-p', String(pid), '-d', '1,2', '-Fn'], { timeoutMs: 4000 })
    if (result.exitCode !== 0 || result.isStdoutTruncated) return undefined
    for (const line of result.stdout.split('\n')) {
      const path = line.startsWith('n/') ? line.slice(1) : ''
      if (path && (await $.fs.stat(path)).kind === 'file') return path
    }
  } catch {}
  return undefined
}

// The engine this session runs in: the nearest claude process above a shell the mod starts (else the first node one).
let engine: number | undefined
const ENGINE = 'p=$PPID; n=; while [ "$p" -gt 1 ]; do case "$(ps -o comm= -p $p)" in *claude*) echo $p; exit;; *node*) n=${n:-$p};; esac; p=$(ps -o ppid= -p $p | tr -d " "); done; echo $n'

let sideRunPolling = false
export async function refreshSideRuns($: EngineInterface) {
  if (sideRunPolling) return
  sideRunPolling = true
  try { await pollSideRuns($) } finally { sideRunPolling = false }
}

async function pollSideRuns($: EngineInterface) {
  let result
  try {
    result = await $.process.run(['/bin/ps', '-axo', 'pid=,etime=,command='], { timeoutMs: 4000 })
  } catch { return }
  if (result.exitCode !== 0 || result.isStdoutTruncated) return
  engine ??= Number((await $.process.run(['/bin/sh', '-c', ENGINE], { timeoutMs: 4000 }).catch(() => undefined))?.stdout.trim()) || undefined
  const tree = engine ? await $.process.run(['/bin/ps', '-axo', 'pid=,ppid='], { timeoutMs: 4000 }).catch(() => undefined) : undefined
  // Other chats' side runs share this machine: keep this session's (all of them while its engine is unknown).
  const alive = new Set([...result.stdout.matchAll(/^\s*(\d+)\s/gm)].map(m => Number(m[1])))
  const list = await read($, nodes)
  const known = (n: AgentNode, pid: number) => n.pid === pid
  const now = await $.clock.now()
  const allRuns = sideRuns(result.stdout)
  const env = list.some(n => n.detached && n.state === 'running')
    ? await $.process.run(['/bin/ps', '-E', '-ww', '-axo', 'pid=,etime=,command='], { timeoutMs: 4000 }).catch(() => undefined) : undefined
  const markers = env?.exitCode === 0 && !env.isStdoutTruncated ? sideMarkers(env.stdout) : undefined
  const descendants = engine && tree?.exitCode === 0 ? mine(allRuns, tree.stdout, engine) : allRuns
  const runs = allRuns.filter(run => descendants.includes(run) || list.some(n => n.state === 'running' && (n.pid === run.pid || markers?.get(run.pid) === n.id)))
  const claim = (n: AgentNode, run: typeof allRuns[number]) => !n.id.startsWith('bg:') && n.provider === run.provider && n.state === 'running' && n.pid === undefined &&
    (markers?.get(run.pid) === n.id || !markers?.has(run.pid) && !n.detached && descendants.includes(run))
  const ended = (n: AgentNode) => n.state === 'running' && n.provider && n.provider !== 'claude' && !n.agentId && !owned.has(n.id) &&
    (n.pid !== undefined ? !alive.has(n.pid) : n.detached && !!markers && !runs.some(run => claim(n, run)))
  if (!runs.some(run => !list.some(n => known(n, run.pid))) && !list.some(ended)) return
  const r = await read($, routing)
  const snaps = new Map<number, AgentNode['snap']>()
  const prompts = new Map<number, string | undefined>()
  const outputFiles = new Map<number, string | undefined>()
  const unclaimed = [...list]
  for (const run of runs) {
    if (unclaimed.some(n => known(n, run.pid))) continue
    outputFiles.set(run.pid, await sideOutput($, run.pid))
    const i = unclaimed.findIndex(n => claim(n, run))
    if (i >= 0) unclaimed[i] = { ...unclaimed[i]!, pid: run.pid }
    // Background changes count from when the mod first sees the process, not its start.
    else {
      snaps.set(run.pid, await snapshot($, run.dir))
      const command = result.stdout.split('\n').find(l => Number(/^\s*(\d+)/.exec(l)?.[1]) === run.pid)?.replace(/^\s*\d+\s+\S+\s+/, '') ?? ''
      prompts.set(run.pid, await sidePrompt($, command, run.pid))
    }
  }
  let finished: AgentNode[] = []
  await update($, nodes, current => {
    finished = []
    const next = current.map(n => {
      if (!ended(n)) return n
      finished.push(n)
      return { ...n, state: 'done' as const, endedAt: now }
    })
    for (const run of runs) {
      if (next.some(n => known(n, run.pid))) continue
      const i = next.findIndex(n => claim(n, run))
      if (i >= 0) next[i] = { ...next[i]!, pid: run.pid, outputFile: next[i]!.outputFile ?? outputFiles.get(run.pid) }
      else next.push({
        id: `bg:${run.pid}`, pid: run.pid, provider: run.provider, kind: nameOf(run.provider),
        label: labelOf(prompts.get(run.pid) ?? '') || `${nameOf(run.provider)} run`,
        input: prompts.get(run.pid)?.slice(0, 20000), dir: run.dir,
        outputFile: outputFiles.get(run.pid),
        model: run.model ?? r.models[run.provider][0] ?? nameOf(run.provider), effort: run.effort, state: 'running',
        steps: 0, startedAt: now - run.ms, run: mainTurn, snap: snaps.get(run.pid),
      })
    }
    return next
  })
  for (const n of finished) {
    if (n.snap) await changesSince($, { untracked: [], ignored: [], ...n.snap }, { model: n.model, provider: n.provider! }, n.id)
    await clearSideLive($, n.id)
    await remember($, n, 'done', now)
    const output = n.outputFile ? await $.fs.read(n.outputFile).catch(() => '') : n.output ?? ''
    const produced = n.provider === 'codex' ? await codexOutput($, output, n.startedAt ?? now, now) : outputTokens(output)
    await recordSpeed($, n.model, produced ?? 0, now - (n.startedAt ?? now))
    void refreshUsage($, n.provider).then(() => watchQuota($)).catch(() => {})
    void tokens($).then(() => watchSpend($)).catch(() => {})
  }
}

// Lines as a person counts them: no phantom line for '' or a trailing newline.
export const lineList = (s: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'))

// A finished agent joins the history kept across sessions (newest last, 300 at most).
async function remember($: EngineInterface, n: AgentNode, state: 'done' | 'failed', endedAt: number) {
  if (n.kind === 'workflow') return
  const shown = displayAgents(await read($, nodes), await read($, edits)).find(x => x.id === n.id)
  if (!shown) return
  n = shown
  const item: HistoryItem = { at: n.startedAt ?? endedAt, label: n.label || n.kind, model: n.model, provider: n.provider, state, ms: endedAt - (n.startedAt ?? endedAt), session: await $.session.id().catch(() => '') }
  const saved = await $.store.get('history').catch(() => (read($, history).then(h => h.items)))
  const items = [...(Array.isArray(saved) ? saved as HistoryItem[] : []), item].slice(-300)
  const next = await update($, history, h => ({ ...h, items }))
  await $.store.set('history', next.items).catch(() => {})
}

async function stripInjected<R extends { additionalContext?: string[] }>($: EngineInterface, r: R): Promise<R> {
  const t = await read($, toggles)
  const offs = Object.entries(MARKS).filter(([p]) => t[`plugin:${p}`] === 'off').map(([, re]) => re)
  return r.additionalContext && offs.length ? { ...r, additionalContext: r.additionalContext.filter(c => !offs.some(re => re.test(c))) } : r
}

const day = (t: number) => new Date(t).toDateString()

// An agent whose spawn settled after a reload has no agentId on its node: find it by its description.
const adopted = new Set<string>()
async function adopt($: EngineInterface, agentId: string) {
  if (adopted.has(agentId)) return
  adopted.add(agentId)
  const info = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)
  if (!info) return
  await update($, nodes, list => {
    const i = list.findIndex(n => !n.agentId && n.kind !== 'workflow' && n.label === info.description)
    if (i < 0) return list
    const live = info.status === 'running' || info.status === 'pending' || info.status === 'waiting'
    return list.map((n, j) => (j === i ? { ...n, agentId, ...(live ? { state: 'running' as const, endedAt: undefined } : {}) } : n))
  })
}

// Warn at 80% and 100% within each provider's cap window.
const capWarned = new Set<string>()
let lastOver = ''
async function overCaps($: EngineInterface) {
  const g = await read($, guard)
  const today = day(await $.clock.now())
  const spent = spendBy(await read($, costs), await read($, prices), g.ccBase, today)
  return (Object.keys(g.caps) as Provider[]).flatMap(p => {
    const cap = g.caps[p] ?? 0
    const s = spent[p]
    return cap > 0 && s !== undefined ? [{ p, spent: s, cap }] : []
  })
}
// The routing as it can be followed here: providers that are not installed, or not running, take no work.
async function liveRouting($: EngineInterface) {
  const ps = await read($, providers).then(allOf)
  return without(await read($, routing), [...missingOf(ps), ...offlineOf(ps)])
}
// `routing` is what the model is told; `seen`, the same without live speeds, is what decides whether it is told again.
async function currentPrompt($: EngineInterface) {
  const g = await read($, guard)
  const ps = await read($, providers).then(allOf)
  const r = await read($, routing)
  const caps = await pastCaps($)
  const opts = { ...g, missing: missingOf(ps), down: offlineOf(ps), ollamaModels: (ps.ollama?.models ?? []).map(m => m.id), claudeModels: ps.claude?.models.filter(m => m.isDefault) }
  const tasks = declarationText(await read($, policy), await openLanes($))
  return {
    routing: [routingText(r, {}, caps, opts, await read($, modelSpeeds)), tasks].filter(Boolean).join('\n'),
    seen: [routingText(r, {}, caps, opts), tasks].filter(Boolean).join('\n'),
    work: workText((await read($, ui)).area, await read($, stage), g.work, await read($, impl)),
  }
}
async function lastPrompt($: EngineInterface, sessionId: string): Promise<DeliveredPrompt | null> {
  const held = await read($, deliveredPrompt)
  if (held?.sessionId === sessionId) return held
  return sessionId ? await $.store.get(`deliveredPrompt:${sessionId}`).catch(() => null) as DeliveredPrompt | null : null
}
async function rememberPrompt($: EngineInterface, value: DeliveredPrompt) {
  await update($, deliveredPrompt, () => value)
  if (value.sessionId) await $.store.set(`deliveredPrompt:${value.sessionId}`, value).catch(() => {})
}

// Which side lanes can take a task now (Claude only, off, not running, client material, the allowlist).
async function openLanes($: EngineInterface, sensitivity?: Sensitivity) {
  const ps = await read($, providers).then(allOf)
  return lanesOpen(await read($, routing), { installed: ps.ollama.status !== 'missing', up: !ps.ollama.offline }, sensitivity, await cloudOk($, { sensitivity }))
}

// Whether this project and this text may go to Antigravity (Phase 3's allowlist and client patterns).
async function cloudOk($: EngineInterface, opts: { sensitivity?: string; text?: string; publicOnly?: boolean }) {
  const c = await read($, confidential)
  // The folder now, not the one the session started in: a cd moves it.
  const cwd = await $.session.cwd().catch(() => '') || c.cwd
  const sensitivity = opts.sensitivity ?? (/\bsensitivity:\s*client\b/i.test(opts.text ?? '') ? 'client' : undefined)
  return cloudCheck(await read($, policy), cwd, { ...opts, sensitivity, found: c.found })
}

// The project's own "Never commit" and confidential paths, read once per session from CLAUDE.md and its .clan files.
async function loadConfidential($: EngineInterface) {
  const cwd = await $.session.cwd().catch(() => '')
  if (!cwd) return
  const found = new Set<string>(), sources: string[] = []
  const root = (await gitRun($, ['rev-parse', '--show-toplevel'], cwd))?.stdout.trim()
  for (const dir of [...new Set([cwd, root].filter((d): d is string => !!d))]) {
    const md = await $.fs.read(`${dir}/CLAUDE.md`).catch(() => '')
    const fromMd = md ? neverCommitPatterns(md) : []
    if (fromMd.length) { fromMd.forEach(p => found.add(p)); sources.push(`${dir}/CLAUDE.md`) }
    const entries = await $.fs.list(dir).catch(() => [])
    for (const f of entries.filter(x => x.kind === 'file' && x.name.endsWith('.clan')).slice(0, 3)) {
      const r = await $.process.run(['/usr/bin/unzip', '-p', `${dir}/${f.name}`], { timeoutMs: 4000 }).catch(() => undefined)
      const fromClan = r?.exitCode === 0 ? neverCommitPatterns(r.stdout) : []
      if (fromClan.length) { fromClan.forEach(p => found.add(p)); sources.push(`${dir}/${f.name}`) }
    }
  }
  await update($, confidential, () => ({ cwd, found: [...found].slice(0, 40), sources }))
}

// The strictest sensitivity declared along an agent's chain (itself and its parents), and whether it was sent here by an
// escalation. A word that is not public, internal or client counts as client.
async function chainInfo($: EngineInterface, agentId?: string): Promise<{ sensitivity?: Sensitivity; escalated: boolean }> {
  // The main thread has no agent id: its own argument and declaration are all there is.
  if (!agentId) return { escalated: false }
  const list = await read($, nodes), log = await read($, routeLog), kept = await read($, agentSens)
  const declared: string[] = []
  let escalated = false
  let n = list.find(x => x.agentId === agentId), id: string | undefined = agentId
  for (let i = 0; i < 20; i++) {
    const k = id ? kept.find(x => x.agentId === id) : undefined
    const d = n?.sensitivity ?? (id ? log.find(x => x.agentId === id && x.tool === 'Agent')?.sensitivity : undefined) ?? k?.sensitivity
    // A subagent whose node is gone, or that declared nothing (undeclared, fork, resume, teammate), counts as internal: fail closed.
    declared.push(d ?? 'internal')
    if (n?.escalated || k?.escalated) escalated = true
    let next: AgentNode | undefined, nextId: string | undefined
    if (n?.parentNode) { next = list.find(x => x.id === n!.parentNode); nextId = next?.agentId ?? n.parentId }
    else { nextId = n?.parentId ?? k?.parent; next = nextId ? list.find(x => x.agentId === nextId) : undefined }
    if (n?.parentNode && !next && !nextId) { declared.push('internal'); break }
    if (!next && !nextId) break
    n = next; id = nextId
  }
  return { sensitivity: strictest(declared), escalated }
}
const ESCALATED_DENY = 'This agent was started to redo a task a side lane could not answer: side lanes are closed to it. Do the task yourself in Claude.'

// An Agent spawn's declared task, checked against the owner's table: where it runs, or why it may not.
type TaskCheck = { exempt: true } | { deny: string; item: RouteLogItem } | { route?: Resolved; item: RouteLogItem; warn?: string }
async function checkTask($: EngineInterface, e: { tool_use_id: string; description?: string; fork?: boolean; resume?: unknown; workflow?: unknown; isTeammate?: boolean }): Promise<TaskCheck> {
  if (e.fork || e.resume || e.workflow || e.isTeammate) return { exempt: true }
  const p = await read($, policy)
  const d = parseDeclaration(e.description ?? '')
  const base = { at: await $.clock.now(), id: e.tool_use_id, tool: 'Agent', label: String(e.description ?? '').slice(0, 120) }
  if (isProblem(d)) {
    const item: RouteLogItem = { ...base, type: d.type, sensitivity: d.sensitivity, declared: d.problem, lane: 'claude', model: '', outcome: p.declare === 'block' ? 'denied' : p.declare === 'warn' ? 'warned' : 'running', note: d.fix }
    if (p.declare === 'block') return { deny: `Routing guard: ${d.fix}`, item }
    return { item, warn: p.declare === 'warn' ? `Routing guard: "${String(e.description ?? '').slice(0, 40)}" ${d.problem === 'missing' ? 'has no task declaration' : `declares ${d.type ?? '?'}/${d.sensitivity ?? '?'}, not on the table`}` : undefined }
  }
  // With declarations off the mod only records what was declared: it never moves a model or an effort.
  if (p.declare === 'off') return { item: { ...base, type: d.type, sensitivity: d.sensitivity, declared: 'ok', lane: 'claude', model: '', outcome: 'running' } }
  let route = resolveRoute(p, d.type, await openLanes($, d.sensitivity), d.sensitivity)
  // A side lane's failed answer comes back to Claude once, by design: run it on the lane's Claude step up.
  if (route.declared.lane !== 'claude' && !route.moved && isEscalated(d.rest)) route = { ...FALLBACK[route.declared.lane as Exclude<Lane, 'claude'>], declared: route.declared, moved: `escalated from ${laneName(route.declared.lane)}` }
  if (route.lane === 'claude') route = { ...route, effort: lowerEffort(route.effort, d.effort) as typeof route.effort }
  const item: RouteLogItem = { ...base, type: d.type, sensitivity: d.sensitivity, declared: 'ok', lane: route.lane, model: route.model, effort: route.effort, outcome: 'running', note: route.moved ? `${laneName(route.declared.lane)} unavailable: ${route.moved}` : undefined }
  // A task the table gives to a side lane is called directly there; a subagent for it is the wrong lane.
  if (route.declared.lane !== 'claude' && !route.moved) {
    const fix = `task:${d.type} runs on ${laneName(route.declared.lane)} (${route.declared.model}): call ${laneTool(route.declared.lane)} directly with the whole task and its input, not a subagent.`
    if (p.declare === 'block') return { deny: `Routing guard: ${fix}`, item: { ...item, outcome: 'denied', note: fix } }
    route = { ...FALLBACK[route.declared.lane as Exclude<Lane, 'claude'>], declared: route.declared, moved: 'spawned as a subagent' }
    return { route, item: { ...item, lane: 'claude', model: route.model, effort: route.effort, note: fix }, warn: p.declare === 'warn' ? `Routing guard: ${fix}` : undefined }
  }
  return { route, item }
}

// Only the providers past their cap change the routing.
async function pastCaps($: EngineInterface) {
  return (await overCaps($)).filter(x => x.spent >= x.cap)
}
async function watchSpend($: EngineInterface) {
  const now = await $.clock.now()
  const today = day(now)
  const g = normalGuard(await $.store.get('guard').catch(() => read($, guard)) ?? await read($, guard))
  const c = await read($, costs)
  // Command Code reports its billing period only: keep this morning's total to count today from.
  const ccRows = c.rows.filter(r => r.provider === 'commandcode')
  if (ccRows.length && g.ccBase?.day !== today) {
    const pr = await read($, prices)
    const value = ccRows.reduce((t, r) => t + (rowCost(r, pr) ?? 0), 0)
    const saved = normalGuard(await $.store.get('guard').catch(() => g) ?? g)
    const next = await update($, guard, () => ({ ...saved, ccBase: saved.ccBase?.day === today ? saved.ccBase : { day: today, value } }))
    await $.store.set('guard', next).catch(() => {})
  }
  const over = await overCaps($)
  // The routing section names over-cap providers: when that set changes, it is composed again.
  const nowOver = over.filter(x => x.spent >= x.cap).map(x => x.p).join(',')
  if (nowOver !== lastOver) {
    lastOver = nowOver
    $.ui.invalidate('prompt.section')
  }
  for (const x of over) {
    const level = x.spent >= x.cap ? 100 : x.spent >= 0.8 * x.cap ? 80 : 0
    const window = x.p === 'claude' || x.p === 'antigravity' ? await $.session.id() : today
    const key = `${window}:${x.p}:${level}`
    if (!level || capWarned.has(key)) continue
    capWarned.add(key)
    $.ui.toast(level === 100 ? `$ ${nameOf(x.p)} hit its $${x.cap} cap · now used last` : `$ ${nameOf(x.p)} at ${Math.round((100 * x.spent) / x.cap)}% of its $${x.cap} cap`)
  }
}

// Warn once per climb, re-arming after context drops ten points below the threshold.
let ctxWarned = false
async function warnContext($: EngineInterface) {
  const threshold = (await read($, guard)).ctxWarn
  if (!threshold) { ctxWarned = false; return }
  const ctx = (await read($, providers).then(allOf)).claude.meters.find(m => m.label === 'Context')
  if (!ctx) return
  if (ctx.percent <= threshold - 10) ctxWarned = false
  else if (ctx.percent >= threshold && !ctxWarned) {
    ctxWarned = true
    $.ui.toast(`Context ${Math.round(ctx.percent)}% full · compact from the Cost card or /compact`)
  }
}

async function gitRun($: EngineInterface, argv: string[], cwd?: string) {
  try {
    const r = await $.process.run(['git', ...argv], { timeoutMs: 8000, cwd })
    return r.isStdoutTruncated ? undefined : r
  } catch {
    return undefined
  }
}
const listOf = (s: string) => s.split('\0').filter(Boolean)

// Before a side provider runs: the repo and a snapshot commit of its tracked files, and the untracked ones.
// `git stash create` writes that commit without touching the work tree, the index or the stash list.
async function snapshot($: EngineInterface, cwd?: string) {
  const root = await gitRun($, ['rev-parse', '--show-toplevel'], cwd)
  const repo = root?.exitCode === 0 ? root.stdout.trim() : undefined
  if (!repo) return undefined
  const stash = await gitRun($, ['-C', repo, 'stash', 'create'])
  if (!stash || stash.exitCode !== 0) return undefined
  const head = stash.stdout.trim() ? stash : await gitRun($, ['-C', repo, 'rev-parse', 'HEAD'])
  const base = head?.exitCode === 0 ? head.stdout.trim() : undefined
  if (!base) return undefined
  // Untracked paths before the run: the ones git lists, and ignored ones as whole folders, so a big
  // node_modules does not overflow the listing (an overflow skips the review).
  const shown = await gitRun($, ['-C', repo, 'ls-files', '-z', '--others', '--exclude-standard'])
  const ignored = await gitRun($, ['-C', repo, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])
  if (!shown || shown.exitCode !== 0 || !ignored || ignored.exitCode !== 0) return undefined
  return { repo, base, untracked: listOf(shown.stdout), ignored: listOf(ignored.stdout) }
}

async function clearSideLive($: EngineInterface, id?: string) {
  const prev = await read($, sideLive)
  if (prev && (id === undefined || prev.id === id)) await update($, sideLive, x => id === undefined || x?.id === id ? null : x)
}

async function watchedSide($: EngineInterface) {
  const list = await read($, nodes)
  const u = await read($, ui)
  // As the live view picks it: main, else the box picked in the graph, else the newest activity.
  const watch = (u.watch ?? ((await read($, guard)).follow ? 'follow' : 'main')) === 'main' ? 'main' : u.sel
  const key = watchKey(await read($, acts), list, watch)
  return list.find(n => key === `node:${n.id}` && n.provider && n.provider !== 'claude' && !n.agentId && n.state === 'running')
}

let sidePolling = false
export async function refreshSideLive($: EngineInterface) {
  if (sidePolling) return
  sidePolling = true
  try {
    const node = await watchedSide($)
    if (!node?.snap) { await clearSideLive($); return }
    const snap = node.snap
    const prev = await read($, sideLive)
    if (prev && prev.id !== node.id) await clearSideLive($, prev.id)
    const diff = await gitRun($, ['-C', snap.repo, 'diff', '--numstat', '-z', snap.base])
    const others = await gitRun($, ['-C', snap.repo, 'ls-files', '-z', '--others', '--exclude-standard'])
    if (!diff || diff.exitCode !== 0 || !others || others.exitCode !== 0) return
    const existed = (f: string) => snap.untracked?.includes(f) || snap.ignored?.some(d => d.endsWith('/') ? f.startsWith(d) : f === d)
    const files = numstat(diff.stdout).filter(f => !existed(f.path))
    for (const path of listOf(others.stdout)) {
      if (existed(path) || files.some(f => f.path === path)) continue
      const text = await $.fs.read(`${snap.repo}/${path}`).catch(() => undefined)
      if (text !== undefined) files.push({ path, added: text.includes('\0') ? 0 : lineList(text).length, removed: 0, isNew: true })
    }
    const times = new Map<string, number>()
    for (const f of files) {
      const stat = await $.fs.stat(`${snap.repo}/${f.path}`).catch(() => undefined)
      if (stat) times.set(f.path, stat.mtimeMs)
      if (!f.isNew) {
        const exists = await gitRun($, ['-C', snap.repo, 'cat-file', '-e', `${snap.base}:${f.path}`])
        f.isNew = exists?.exitCode === 1 || exists?.exitCode === 128
      }
    }
    files.sort((a, b) => (times.get(b.path) ?? 0) - (times.get(a.path) ?? 0))
    const next: SideLive = { id: node.id, files, at: await $.clock.now() }
    const first = files[0]
    if (first) {
      const old = first.isNew ? undefined : await gitRun($, ['-C', snap.repo, 'show', `${snap.base}:${first.path}`])
      const abs = `${snap.repo}/${first.path}`
      const text = await $.fs.read(abs).catch(async () => await $.fs.exists(abs) ? undefined : '')
      if ((first.isNew || old?.exitCode === 0) && text !== undefined && !text.includes('\0') && !old?.stdout.includes('\0')) {
        Object.assign(next, { file: first.path, ...sideWindow(lineList(old?.stdout ?? ''), lineList(text)) })
      }
    }
    // A slow Git read must not repaint a run that ended or lost the watch meanwhile.
    if ((await watchedSide($))?.id !== node.id) return
    if (!prev && !files.length) return
    if (prev && JSON.stringify({ ...prev, at: 0 }) === JSON.stringify({ ...next, at: 0 })) return
    await update($, sideLive, () => next)
  } finally { sidePolling = false }
}

// After it ran: each file it changed, as the changed stretch before and after.
// ponytail: anything else editing the repo during the run is counted too; a per-run worktree would separate them.
const countedChanges = new Set<string>()
async function changesSince($: EngineInterface, snap: NonNullable<Awaited<ReturnType<typeof snapshot>>>, who: { model: string; provider: Provider }, nodeId: string) {
  const key = `${await $.session.id().catch(() => '')}:${nodeId}`
  if (countedChanges.has(key)) return
  countedChanges.add(key)
  const diff = await gitRun($, ['-C', snap.repo, 'diff', '--name-only', '-z', snap.base])
  const others = await gitRun($, ['-C', snap.repo, 'ls-files', '-z', '--others', '--exclude-standard'])
  if (!diff || diff.exitCode !== 0 || !others || others.exitCode !== 0) return
  const changed = [...new Set(listOf(diff.stdout))]
  const existed = (f: string) => snap.untracked.includes(f) || snap.ignored.some(d => (d.endsWith('/') ? f.startsWith(d) : f === d))
  const fresh = [...new Set(listOf(others.stdout))].filter(f => !existed(f))
  const paths = [...new Set([...changed, ...fresh])]
  const review = (await read($, guard)).review
  const at = await $.clock.now()
  const items: EditItem[] = []
  for (const path of paths.slice(0, 40)) {
    const abs = `${snap.repo}/${path}`
    const exists = await gitRun($, ['-C', snap.repo, 'cat-file', '-e', `${snap.base}:${path}`])
    if (!exists) continue
    const isNew = !existed(path) && exists.exitCode !== 0
    if (!isNew && exists.exitCode !== 0) continue
    const old = isNew ? undefined : await gitRun($, ['-C', snap.repo, 'show', `${snap.base}:${path}`])
    if (!isNew && (!old || old.exitCode !== 0)) continue
    const before = old?.stdout ?? ''
    const hash = await gitRun($, ['-C', snap.repo, 'hash-object', '--', path])
    const after = (await $.fs.exists(abs)) ? await $.fs.read(abs).catch(() => '') : ''
    if (before.includes('\0') || after.includes('\0')) continue
    const h = hunk(lineList(before), lineList(after))
    items.push({
      file: abs,
      lines: [...h.before.map(l => `- ${l}`), ...h.after.map(l => `+ ${l}`)].slice(0, 12),
      added: h.added,
      removed: h.removed,
      before: h.before.slice(0, 80),
      after: h.after.slice(0, 80),
      at,
      isNew,
      ...who,
      review: review ? 'pending' : undefined,
      base: snap.base,
      repo: snap.repo,
      path,
      afterHash: hash?.exitCode === 0 ? hash.stdout.trim() || undefined : undefined,
      // The run deleted it (or renamed it away): a revert brings it back from the snapshot.
      gone: !isNew && !(await $.fs.exists(abs)) ? true : undefined,
    })
  }
  if (items.length) await addEdits($, items)
  const more = paths.length > 40 ? ` · ${paths.length - 40} more not listed, see git diff ${snap.base.slice(0, 8)}` : ''
  if (review && (items.length || more)) $.ui.toast(`${items.length} file${items.length > 1 ? 's' : ''} from ${shortModel(who.model)} to review${more}`)
}

const bump = (rec: Record<string, number>, key: string) => ({ ...rec, [key]: (rec[key] ?? 0) + 1 })

// The model the owner allowed (or named in the call) for a local Ollama run, or why there is none.
export function ollamaPick(r: Routing, installed: string[], asked?: string): { model: string } | { deny: string } {
  const chat = installed.filter(m => !isEmbedder(m))
  if (asked && isEmbedder(asked)) return { deny: `${asked} is an embedding model: it cannot take a task.${chat.length ? ` Use ${chat.join(', ')}.` : ''}` }
  const allowed = r.picks.filter(x => x.provider === 'ollama' && !isEmbedder(x.model)).map(x => x.model)
  const usable = allowed.length ? allowed.filter(m => !installed.length || installed.includes(m)) : chat
  if (asked) {
    if (installed.length && !installed.includes(asked)) return { deny: `${asked} is not installed in Ollama. Installed: ${chat.join(', ') || 'none'}.` }
    if (allowed.length && !allowed.includes(asked)) return { deny: `The owner allows only ${allowed.join(', ')} on Ollama.` }
    return { model: asked }
  }
  return usable[0] ? { model: usable[0] } : { deny: 'No Ollama chat model is installed or allowed: pull one with `ollama pull <model>`, or pick one in the agent panel.' }
}

// A local generation through Ollama's API: tracked like a side run, free, with its real speed recorded.
async function ollamaRun($: EngineInterface, e: Loose): Promise<ToolCallResult> {
  const r = await read($, routing)
  const info = (await read($, providers).then(allOf)).ollama ?? blank()
  const panel = "(set by the owner in the agent panel's Routing tab)"
  if (r.role === 'claude') return { deny: `Ollama is paused: Claude only ${panel}.` }
  if (!r.on.ollama) return { deny: `Ollama is turned off ${panel}.` }
  if (info.status === 'missing') return { deny: 'Ollama is not installed on this Mac.' }
  if (info.offline) return { deny: `Ollama's ${OLLAMA_DOWN}: ask the owner to open the Ollama app, or hand the task to another provider.` }
  const prompt = typeof e.prompt === 'string' ? e.prompt : ''
  if (!prompt.trim()) return { deny: 'prompt is empty: put the whole task and its input in prompt.' }
  if ((await chainInfo($, e.agentId as string | undefined)).escalated) return { deny: ESCALATED_DENY }
  const pick = ollamaPick(r, info.models.map(m => m.id), typeof e.model === 'string' && e.model.trim() ? e.model.trim() : undefined)
  if ('deny' in pick) return pick
  const system = typeof e.system === 'string' && e.system.trim() ? e.system : undefined
  const long = e.long === true || prompt.length > OLLAMA_LONG
  const format: Format | undefined = e.format === 'json' || (e.format && typeof e.format === 'object' && !Array.isArray(e.format)) ? e.format as Format : undefined
  const paths = Array.isArray(e.images) ? e.images.filter((x): x is string => typeof x === 'string' && x.startsWith('/')).slice(0, 8) : []
  const images: string[] = []
  for (const path of paths) {
    const bytes = await $.fs.read(path, { as: 'bytes' }).catch(() => undefined)
    if (!bytes) return { deny: `Cannot read the image ${path}.` }
    images.push(bytes.base64)
  }
  const parentRow = e.agentId ? (await read($, nodes)).find(n => n.agentId === e.agentId) : undefined
  const node: AgentNode = {
    id: e.tool_use_id, state: 'running', steps: 0, startedAt: await $.clock.now(), parentId: e.agentId, parentNode: parentRow?.id, run: parentRow?.run ?? mainTurn,
    label: String(e.description ?? '') || labelOf(prompt) || 'Ollama run', kind: 'Ollama', model: pick.model, provider: 'ollama', input: clip(prompt, 20000),
  }
  const d = parseDeclaration(String(e.description ?? ''))
  const decl = { type: isProblem(d) ? undefined : d.type, sensitivity: isProblem(d) ? (typeof e.sensitivity === 'string' ? e.sensitivity : undefined) : d.sensitivity }
  const item: RouteLogItem = { at: node.startedAt!, id: e.tool_use_id, tool: 'ollama_run', label: node.label, declared: isProblem(d) ? 'exempt' : 'ok', ...decl, lane: 'ollama', model: pick.model, outcome: 'running' }
  await logRoute($, item)
  return track($, node, async (): Promise<ToolCallResult> => {
    try {
      const out = await ollamaGenerate($, pick.model, prompt, { system, long, format, images })
      const tokens = out.outputTokens === undefined ? undefined : out.outputTokens + (out.inputTokens ?? 0)
      // Tidy the answer to the shape the prompt asks for (code or JSON only, one line, N bullets); escalate it if it still breaks it.
      const shape = shapeOf(prompt, system)
      const text = format ? out.text : tidy(out.text, shape)
      const why = failure(text, { doneReason: out.doneReason, format }) ?? (format ? undefined : shapeFailure(text, shape))
      if (why) {
        await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'escalated', tokens, ms: out.ms, note: `${why} → Claude Haiku` })
        return { result: escalation('ollama', why, decl) }
      }
      await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'done', tokens, ms: out.ms, ...(text !== out.text.trim() ? { note: 'tidied to the shape asked for' } : {}) })
      return { result: text }
    } catch (err) {
      await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'failed', note: String((err as Error)?.message ?? err).slice(0, 200) })
      const msg = String((err as Error)?.message ?? err).slice(0, 300)
      // A refused connection means the server stopped: look again so routing says so.
      if (/fetch|connect|refused|no answer/i.test(msg)) void refreshUsage($, 'ollama').catch(() => {})
      return { deny: `Ollama run on ${pick.model} failed: ${msg}` }
    }
  })
}

// A Gemini answer through `agy -p`, run by the mod itself: tracked like a side run, its tokens and speed kept.
async function geminiTool($: EngineInterface, e: Loose): Promise<ToolCallResult> {
  const r = await read($, routing)
  const panel = "(set by the owner in the agent panel's Models tab)"
  const prompt = typeof e.prompt === 'string' ? e.prompt : ''
  const imagesGiven = Array.isArray(e.images) ? e.images.length : 0
  const job = imagesGiven || !r.agyCoding ? 'visual' as const : 'coding' as const
  if (r.role === 'claude') return { deny: `Antigravity is paused: Claude only ${panel}. Do this in Claude.` }
  if (!r.on.antigravity) return { deny: `Antigravity is turned off ${panel}. Do this in Claude.` }
  if (!agyJobOn(r, job)) return { deny: `Antigravity has ${job === 'visual' ? 'visual checks' : 'coding and text work'} off or out of quota ${panel}. Do this in Claude.` }
  if (!prompt.trim()) return { deny: 'prompt is empty: put the whole task and its input in prompt.' }
  const info = await chainInfo($, e.agentId as string | undefined)
  if (info.escalated) return { deny: ESCALATED_DENY }
  // The call inherits the strictest sensitivity of the agent chain that made it; its own argument can only add to that.
  const declaredHere = parseDeclaration(String(e.description ?? ''))
  const said = sideSensitivity(e.sensitivity, strictest([info.sensitivity, declaredHere.sensitivity]))
  if ('refuse' in said) return { deny: `Antigravity refused: ${said.refuse}. Do this in Claude, or on Ollama (ollama_run) for private text.` }
  const sensitivity = said.sensitivity
  const cwd = await $.session.cwd().catch(() => '')
  const c0 = await read($, confidential)
  const patterns = [...CLIENT_PATTERNS, ...c0.found, ...(await read($, policy)).patterns]
  const vet = await vetImages($, e.images, cwd, text => { const hit = clientHit(text, patterns); return hit ? `names a confidential path (${hit})` : undefined })
  if ('error' in vet) return { deny: `Antigravity refused: ${vet.error}` }
  const images = vet.paths
  const imageIds = 'ids' in vet ? vet.ids : undefined
  // Gemini's sandbox is not proven to keep it to the files given, so this lane takes public material only.
  const cloud = await cloudOk($, { sensitivity, text: [prompt, ...images].join('\n'), publicOnly: true })
  if (!cloud.allowed) return { deny: `Antigravity refused: ${cloud.why}. Do this in Claude, or on Ollama (ollama_run) for private text.` }
  const p = await read($, policy)
  const model = typeof e.model === 'string' && GEMINI_MODELS.includes(e.model) ? e.model : p.table.visual.lane === 'gemini' ? p.table.visual.model : isDefaultVisual(p.table.visual) ? GEMINI_DEFAULT : agyJobModel(r, job)
  const parentRow = e.agentId ? (await read($, nodes)).find(n => n.agentId === e.agentId) : undefined
  const startedAt = await $.clock.now()
  const node: AgentNode = {
    id: e.tool_use_id, state: 'running', steps: 0, startedAt, parentId: e.agentId, parentNode: parentRow?.id, run: parentRow?.run ?? mainTurn,
    label: String(e.description ?? '') || labelOf(prompt) || 'Gemini run', kind: 'Antigravity', model, provider: 'antigravity', input: clip(prompt, 20000),
  }
  const d = parseDeclaration(String(e.description ?? ''))
  await logRoute($, { at: startedAt, id: e.tool_use_id, tool: 'gemini_run', label: node.label, declared: isProblem(d) ? 'exempt' : 'ok', type: isProblem(d) ? (images.length ? 'visual' : undefined) : d.type, sensitivity, lane: 'gemini', model, outcome: 'running' })
  return track($, node, async (): Promise<ToolCallResult> => {
    const out = await geminiRun($, { model, prompt, images, ids: imageIds, json: e.format === 'json' }).catch(err => ({ text: '', status: 'ERROR', error: String((err as Error)?.message ?? err).slice(0, 300) }) as Awaited<ReturnType<typeof geminiRun>>)
    const tokens = (out.inputTokens ?? 0) + (out.outputTokens ?? 0)
    if (out.outputTokens !== undefined) void update($, costs, c => ({ ...c, agy: { ...c.agy, [model]: addTokens(c.agy[model] ?? zero(), { input: out.inputTokens ?? 0, output: out.outputTokens ?? 0, cacheRead: 0, cacheWrite: 0 }) } }))
    void antigravityUsage($).then(() => watchQuota($)).catch(() => {})
    if (out.status !== 'SUCCESS') {
      const quota = QUOTA_TEXT.test(out.error ?? '')
      if (quota) await update($, providers, all => ({ ...all, antigravity: { ...all.antigravity, alert: 'quota hit · its run said so' } }))
      await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'failed', tokens, ms: out.ms, note: out.error })
      // A failed run goes to Claude once, like an unusable answer: the hint stops a loop of retries on the side lanes.
      return { deny: `Gemini run on ${model} failed: ${out.error ?? out.status}${quota ? ' (out of quota)' : ''}\n${escalation('gemini', `the run failed: ${(out.error ?? out.status).slice(0, 100)}`, { type: isProblem(d) ? (images.length ? 'visual' : undefined) : d.type, sensitivity })}` }
    }
    const why = failure(out.text, { format: e.format === 'json' ? 'json' : undefined })
    if (why) {
      await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'escalated', tokens, ms: out.ms, note: `${why} → Claude Sonnet` })
      return { result: escalation('gemini', why, { type: isProblem(d) ? (images.length ? 'visual' : undefined) : d.type, sensitivity }) }
    }
    await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'done', tokens, ms: out.ms })
    return { result: out.text }
  })
}

type Loose = { tool: string; tool_use_id: string; agentId?: string; [arg: string]: unknown }

let seq = 0
// A bare skill name ("ponytail-audit") to its plugin, from the installed plugins' skill folders.
let skillPlugin: Record<string, string> = {}
const bareToPlugin = (bare: string) => skillPlugin[bare]
let beat = 0
let ticking = false
let mainTurn = 'turn'
let turnStart: { id: string; since: number; usd?: number; tokens: number; outputs: Record<string, number>; children: Record<string, number> } | undefined
const speedAgents = new Set<string>()
const ranEdits = new Set<string>()
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)
let lastMain = ''

const actTools = new Map<string, string>()
const editWindows = new Map<string, Promise<ReturnType<typeof editWindow>>>()

function editContext($: EngineInterface, id: string, file: string, old: string) {
  let pending = editWindows.get(id)
  if (!pending) {
    pending = $.fs.read(file).then(text => editWindow(text, old)).catch(() => undefined)
    editWindows.set(id, pending)
  }
  return pending
}

function setAct($: EngineInterface, act: Act, id: string) {
  return update($, acts, all => {
    if (actTools.get(act.key) !== id) return all
    const kept = { ...all, [act.key]: act }
    const finished = Object.values(kept).filter(a => a.state !== 'running').sort((a, b) => a.at - b.at)
    while (Object.keys(kept).length > 12 && finished.length) delete kept[finished.shift()!.key]
    return kept
  })
}

function actTitle(e: Loose): string {
  if (e.tool === 'Bash') return String(e.command ?? '').split('\n')[0]!.slice(0, 200)
  if (STREAMED[e.tool] || e.tool === 'Read') return String(e.file_path ?? e.notebook_path ?? '')
  if (e.tool === 'Grep' || e.tool === 'Glob') return `${e.pattern ?? ''}${e.path ? ` · ${e.path}` : ''}`
  if (e.tool === 'WebFetch') return String(e.url ?? '')
  if (e.tool === 'Agent') return String(e.description ?? '')
  if (e.tool === 'Skill') return String(e.skill ?? '')
  if (e.tool.startsWith('mcp__')) {
    const arg = Object.entries(e).find(([k, v]) => !['tool', 'tool_use_id', 'agentId'].includes(k) && typeof v === 'string')?.[1]
    return `${e.tool.replace(/^mcp__.+?__/, '')}${arg ? ` · ${arg}` : ''}`
  }
  return e.tool
}

const mediaRunning = new Map<string, { short: string }[]>()
async function mediaCall($: EngineInterface, tool: string, run: () => Promise<ToolCallResult>) {
  const service = mediaService(tool, (await read($, installed)).tools)
  if (!service || mediaReadOnly(tool)) return run()
  const id = service.id
  const short = mediaShort(tool)
  const active = { short }
  mediaRunning.set(id, [...(mediaRunning.get(id) ?? []), active])
  await update($, media, m => ({ ...m, [id]: { ...m[id], features: m[id]?.features ?? {}, running: mediaRunning.get(id)?.slice(-1)[0]?.short } }))
  if ((await read($, media))[id]?.base === undefined) await refreshMedia($, id, false, tool)
  let ran: ToolCallResult | undefined
  try {
    ran = await run()
    return ran
  } finally {
    const remaining = (mediaRunning.get(id) ?? []).filter(x => x !== active)
    if (remaining.length) mediaRunning.set(id, remaining)
    else mediaRunning.delete(id)
    const credits = id === 'elevenlabs' && ran && !ran.deny ? elevenCredits(mediaText(ran)) : undefined
    await update($, media, m => {
      const old = m[id] ?? { features: {} }
      return { ...m, [id]: { ...old, running: mediaRunning.get(id)?.slice(-1)[0]?.short, features: ran?.deny ? old.features : bump(old.features, short), used: credits === undefined ? old.used : (old.used ?? 0) + credits } }
    })
    if (!ran?.deny) await refreshMedia($, id, false, tool)
  }
}

// Wrap every return, including local refusals, so no activity is left spinning.
async function watchCall($: EngineInterface, e: Loose, run: () => Promise<ToolCallResult>) {
  if ([DECISION_TOOL, QA_TOOL, GRILL_TOOL].includes(e.tool)) return run()
  const key = e.agentId ?? 'main'
  const previous = (await read($, acts))[key]
  const at = actTools.get(key) === e.tool_use_id ? previous?.at ?? await $.clock.now() : await $.clock.now()
  actTools.set(key, e.tool_use_id)
  const act: Act = { key, toolUseId: e.tool_use_id, tool: e.tool, title: actTitle(e), state: 'running', at }
  if (STREAMED[e.tool]) {
    act.file = act.title
    act.text = String(e[STREAMED[e.tool]!] ?? '')
    if (e.tool === 'Write') act.startLine = 1
  }
  await setAct($, act, e.tool_use_id)
  if (e.tool === 'Edit') {
    Object.assign(act, await editContext($, e.tool_use_id, act.file!, String(e.old_string ?? '')))
    if (actTools.get(key) === e.tool_use_id) await setAct($, act, e.tool_use_id)
  }
  const tracked = e.tool === 'Agent' || e.tool === 'Workflow'
  if (tracked) routingCalls.set(e.tool_use_id, { notices: new Set() })
  let ran: ToolCallResult | undefined
  try {
    ran = await run()
    const ctx = routingCalls.get(e.tool_use_id)
    if (!ran.deny && !ran.isError && ctx?.route?.notice && !ctx.logged) {
      const group = (await read($, nodes)).find(n => n.id === `wf:${e.tool_use_id}`)
      if (group) await recordRoute($, group.id, group.label, ctx.route, e.tool_use_id)
    }
    if (e.tool === 'Agent' && !ran.deny && !ran.isError) {
      const result = ran.result as { agentId?: string; resolvedModel?: string; usage?: { output_tokens?: number }; totalDurationMs?: number; status?: string } | undefined
      if (result?.status === 'completed' && result.agentId && !speedAgents.has(result.agentId)) {
        const node = (await read($, nodes)).find(n => n.agentId === result.agentId)
        await recordSpeed($, result.resolvedModel ?? node?.model ?? String(e.model ?? ''), result.usage?.output_tokens ?? 0, result.totalDurationMs ?? 0)
        speedAgents.add(result.agentId)
      }
    }
    // agent.spawn has no context field; only the enclosing tool result can carry this reminder.
    if (ran.deny !== undefined) return ran
    return ctx?.notices.size ? { ...ran, context: [...(ran.context ?? []), ...ctx.notices] } : ran
  } finally {
    if (tracked) routingCalls.delete(e.tool_use_id)
    const endedAt = await $.clock.now()
    const output = ran?.text ?? (typeof ran?.result === 'string' ? ran.result : JSON.stringify(ran?.result ?? ''))
    if (actTools.get(key) === e.tool_use_id) await setAct($, {
      ...act, state: !ran || ran.deny || ran.isError ? 'failed' : 'done', endedAt,
      ...(!STREAMED[e.tool] ? { output: output.split(/\r?\n/).filter(l => l.trim()).slice(-14) } : {}),
    }, e.tool_use_id)
    if (actTools.get(key) === e.tool_use_id) actTools.delete(key)
    editWindows.delete(e.tool_use_id)
    if (STREAMED[e.tool]) {
      ranEdits.add(e.tool_use_id)
      if (ranEdits.size > 200) ranEdits.delete(ranEdits.values().next().value!)
      const was = await read($, live)
      if (was?.id === e.tool_use_id && ran && !ran.deny && !ran.isError) await update($, lastLive, () => was)
      await update($, live, cur => cur?.id === e.tool_use_id ? null : cur)
    }
  }
}

const refusedRoutes = new Set<string>()
const workflowReasons = new Map<string, string>()
const routingCalls = new Map<string, { notices: Set<string>; workflow?: { prompt: string; description: string }; route?: SubagentRoute; logged?: boolean }>()

async function logDecision($: EngineInterface, item: DecisionItem) {
  const list = await update($, decisions, list => [...list, item].slice(-300))
  const session = await $.session.id().catch(() => undefined)
  if (session) await $.store.set(`decisions:${session}`, list).catch(() => {})
  await emitVibe($, { kind: 'decision' })
  if (item.impact === 'high') $.ui.toast(`${IMPACT.high.mark} ${item.decision}`)
}

async function recordRoute($: EngineInterface, id: string, label: string, route: SubagentRoute, toolId: string) {
  if (!route.notice || !route.provider) return
  const why = route.reason ? `Reason: ${route.reason}` : route.notice
  await setNode($, n => n.id === id, n => ({ ...n, offRoute: why }))
  await logDecision($, {
    decision: `Claude subagent used while Main is ${nameOf(route.provider)}: ${label}`,
    why, impact: route.impact ?? 'low', at: await $.clock.now(),
  })
  const call = routingCalls.get(toolId)
  if (call) { call.notices.add(route.notice); call.logged = true }
}

// The edits list keeps only recent items; the session totals beside it never shrink.
async function addEdits($: EngineInterface, items: EditItem[]) {
  await update($, edits, list => trimEdits([...list, ...items]))
  await update($, written, w => ({
    added: w.added + items.reduce((t, x) => t + (x.added ?? 0), 0),
    removed: w.removed + items.reduce((t, x) => t + (x.removed ?? 0), 0),
    files: [...new Set([...w.files, ...items.map(x => x.file)])],
  }))
}

export const register: Register = (on, options) => {
  setOwner(options.owner_name)
  registerChatLook(on)
  registerChatSurfaces(on)
  on('session.start', async ($, e, next) => {
    await startCheck($)
    // State outlives a reload: a provider added since (Ollama) needs its entry before anything reads it.
    await update($, providers, all => PROVIDERS.every(p => all[p.id]) ? all : { ...Object.fromEntries(PROVIDERS.map(p => [p.id, blank()])), ...all } as Providers)
    await $.command.register({ name: 'default', description: 'Open the Agent panel' })
    await $.command.register({ name: 'overview', description: 'Open the Agent panel (alias)' })
    await $.command.register({ name: 'clean-worktrees', description: "List this repo's worktrees with a verdict each; /clean-worktrees <n...> backs up and removes only those" })
    await $.command.register({ name: 'review-adversarial', description: 'Adversarial review of the diff by Claude Opus 5.5, on request: [base] [goal] shows the cost, then go | cancel | status' })
    // The reviewer is spawned only by the command: the model never sees it as an agent type.
    await $.agent.register({ name: 'adversary', description: 'Adversarial reviewer; started only by /review-adversarial', prompt: ADVERSARY_PROMPT, model: ADVERSARY_MODEL, effort: 'high', tools: ['Read', 'Grep', 'Glob'] }).catch(() => undefined)
    await $.tool.register({
      name: 'qa_log',
      isDeferred: false,
      description:
        "Keep the owner's answers and instructions. Call this once each time the owner answers a question " +
        'you asked (while grilling them or at any other time) or gives you an instruction, preference or ' +
        'rule worth remembering for this work. question: what you asked, or the topic of the instruction. ' +
        'answer: their answer or instruction rewritten as one or two clear, well-formed sentences (keep ' +
        'their meaning, fix grammar and rambling). kind: answer or instruction. It shows in their overview ' +
        'panel and asks nothing.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' }, answer: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'instruction'], default: 'answer' } },
        required: ['question', 'answer'],
      },
    })
    await $.tool.register({
      name: 'decision_log',
      isDeferred: false,
      description:
        'Tell the owner about a decision you made on your own that is worth their glance: a library or approach picked, ' +
        'a trade-off, a scope cut, a default chosen, something skipped. It does not ask for input or wait for approval; ' +
        'it shows in their agent panel. One short decision line, one short why, and the impact (low, medium or high). ' +
        'Use it for choices they might want to know about, not for routine steps.',
      inputSchema: {
        type: 'object',
        properties: {
          decision: { type: 'string', description: 'What you decided, one short line' },
          why: { type: 'string', description: 'Why, one short line' },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['decision', 'why', 'impact'],
      },
    })
    await $.tool.register({
      name: 'review_log',
      isDeferred: false,
      description: "Log one review finding so the owner sees it in the agent panel's Review tab; one call per finding; the same file:line from several reviewers is merged and counted.",
      inputSchema: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'integer' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, text: { type: 'string' }, by: { type: 'string' } },
        required: ['file', 'severity', 'text', 'by'],
      },
    })
    await $.tool.register({
      name: 'ollama_run',
      isDeferred: false,
      description:
        'Run one prompt on a local Ollama model on this Mac and get its text back. Free and private; about 50 tokens a second. ' +
        'Only for small text jobs: quick summaries, commit messages, diff summaries, log triage, explain-this-code, extracting fields from private briefs. ' +
        'Say the shape you need in the prompt (e.g. "output only the code", "one line, max 72 characters", "exactly 3 bullet points", "JSON only"): the answer is tidied to it, and one that still breaks it is escalated to Claude Haiku. ' +
        'Not for design, multi-file changes, creative writing or anything agentic: the model has no tools and cannot read files, so put everything it needs in prompt. ' +
        'Works only while the owner has Ollama on in the agent panel and its local server is running.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The whole task, with any text, diff or log it needs pasted in' },
          model: { type: 'string', description: 'An installed Ollama model, as the routing lists it; left out, the first allowed one' },
          system: { type: 'string', description: 'Optional system instruction, such as the output format' },
          long: { type: 'boolean', description: 'True for a long input: uses a 16K context window instead of 8K' },
          format: { description: '"json", or a JSON schema object, when the answer must be JSON; an answer that does not parse or match is escalated to Claude Haiku' },
          images: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of images for a vision model (private visual checks stay on this Mac)' },
          sensitivity: { type: 'string', enum: ['public', 'internal', 'client'], description: 'Client work is fine here: it stays on this Mac' },
          description: { type: 'string', description: 'A few words for the agent panel' },
        },
        required: ['prompt'],
      },
    })
    await $.tool.register({
      name: 'adversarial_review',
      isDeferred: false,
      description:
        `Prepare an adversarial review, ONLY when ${ownerName()} asks for one; never on your own initiative, never as a routine step. ` +
        'It gathers the diff (against base, or the working tree vs HEAD), and returns the reviewer, rounds and estimated cost. ' +
        `It starts nothing: tell ${ownerName()} the estimate; they start it with /review-adversarial go or Run in the agent panel. Findings land in the Review tab.`,
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'What the change is meant to achieve, in one or two sentences' },
          base: { type: 'string', description: 'A git ref to diff against; left out, the working tree against HEAD' },
          rounds: { type: 'integer', minimum: 1, maximum: 5, description: "Left out, the owner's setting (2 by default)" },
        },
        required: ['goal'],
      },
    })
    await $.tool.register({
      name: 'gemini_run',
      isDeferred: false,
      description:
        'Run one prompt on Gemini through the Antigravity CLI (agy -p, plan mode, sandboxed, from an empty temp folder) and get its text back. ' +
        'For visual checks (pass images: what text, logos or defects an image shows) and small public text jobs. ' +
        'PUBLIC MATERIAL ONLY: its sandbox is not proven to stop reads outside its temp folder, so sensitivity "internal" and "client" are refused, as are confidential paths and any project not on the owner\'s Antigravity allowlist. ' +
        'The call also inherits the strictest sensitivity of the agent that makes it (the argument can only make it stricter), and sensitivity must be exactly "public" or it is refused. ' +
        'Put everything it needs in prompt; images must be image files inside this project. ' +
        'Works only while the owner has Antigravity on in the agent panel.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The whole task, with any text it needs pasted in' },
          sensitivity: { type: 'string', enum: ['public', 'internal', 'client'], description: 'Only "public" is sent; anything else is refused' },
          images: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of image files (png, jpg, webp, gif, avif; under 20 MB) inside this project; each is resolved and copied into the temp folder' },
          model: { type: 'string', enum: GEMINI_MODELS, description: "Left out, the owner's visual model" },
          format: { type: 'string', enum: ['json'], description: 'json when the answer must be valid JSON' },
          description: { type: 'string', description: 'A few words for the agent panel' },
        },
        required: ['prompt', 'sensitivity'],
      },
    })
    void $.session.model().then(model => update($, main, m => ({ ...m, model })))
    // The owner's routing choices for this chat outlive a relaunch.
    await loadSpeeds($)
    const saved = await loadRouting($)
    await pruneStore($)
    await update($, routing, () => normalRouting(saved))
    // A reload may bring new routing words: the cached routing section is composed again.
    $.ui.invalidate('prompt.section')
    await loadPolicy($)
    await autoAntigravity($)                // once: Antigravity's jobs and every project on (hooks/auto.ts)
    void loadConfidential($)
    const savedGuard = await $.store.get('guard').catch(() => undefined)
    await update($, guard, () => normalGuard(savedGuard))
    await restoreDecisions($)
    await restoreMode($)
    await syncWorkSkills($)
    $.ui.invalidate('tool.describe')
    $.ui.invalidate('ui.render')
    await restorePresets($)
    const savedPins = await $.store.get('pins').catch(() => undefined)
    await update($, pins, () => (Array.isArray(savedPins) ? (savedPins as string[]) : DEFAULT_PINS))
    const past = await $.store.get('history').catch(() => undefined)
    const began = await $.clock.now()
    await update($, history, h => ({ since: h.since || began, items: Array.isArray(past) ? (past as HistoryItem[]).slice(-300) : h.items }))
    // A reload drops the code that would settle anything in flight: settle it now.
    const now = await $.clock.now()
    const agents = await $.agent.list().catch(() => [])
    const alive = agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
    await update($, nodes, list => list.map(n => {
      if (n.state !== 'running') return n
      const over = agents.find(a => a.id === n.agentId && ['completed', 'failed', 'killed'].includes(a.status))
      if (over) return { ...n, state: over.status === 'completed' ? 'done' as const : 'failed' as const, endedAt: now }
      if (n.agentId || n.pid !== undefined || n.id.startsWith('bg:')) return n
      const a = n.provider ? undefined : alive.find(x => x.description === n.label && !list.some(y => y.agentId === x.id))
      return a ? { ...n, agentId: a.id } : { ...n, state: 'failed' as const, endedAt: now }
    }))
    await update($, live, () => null)
    await update($, media, m => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, { ...v, running: undefined }])))
    await clearSideLive($)
    void refreshGit($)
    void refreshUsage($).then(() => watchQuota($)).catch(() => {})
    void refreshModels($).catch(() => {})
    void plugins($).then(async () => {
      skillPlugin = Object.fromEntries((await read($, installed)).plugins.flatMap(p => (p.skills ?? []).map(sk => [sk, p.name])))
    })
    $.clock.every(5000, () => void refreshSideRuns($))
    $.clock.every(3000, () => void refreshSideLive($))
    $.clock.every(15000, () => void refreshGit($))
    $.clock.every(90000, () => void refreshUsage($).then(() => watchQuota($)).catch(() => {}))
    $.clock.every(600000, () => void refreshModels($).catch(() => {}))
    $.clock.every(300000, () => void plugins($))
    void tokens($).then(() => loadPrices($))
    $.clock.every(120000, () => void tokens($).then(() => watchSpend($)))
    $.clock.every(1800000, () => void loadPrices($))
    $.clock.every(300000, () => void readDebugLog($))
    $.clock.every(30000, () => void flushCheck($))
    // The spinner turns only while something is running, so a quiet panel never redraws.
    $.clock.every(150, () => {
      if (ticking) return
      ticking = true
      void (async () => {
        try {
          const all = await read($, nodes)
          const busy = all.some(n => stateOf(n, all) === 'running') || (await read($, live)) !== null || !!(await read($, main)).working || Object.values(await read($, acts)).some(a => a.state === 'running') || Object.values(await read($, media)).some(m => m.running)
          // Hovered long decisions need a slow beat even when nothing runs.
          beat = (beat + 1) % 1000
          const ticker = beat % 2 === 0 && (await read($, guard)).ticker && (await read($, decisions)).some(d => d.decision.length > 40)
          if (busy || ticker) await update($, tick, t => (t + 1) % 1000)
        } finally { ticking = false }
      })()
    })
    // A session can start before any surface attaches; the panel opens when one does.
    $.ui.open({ id: PANE, title: 'Agent panel' }).catch(() => {})
    return next(e)
  })

  on('agent.offer', { agent: ADVERSARY }, () => ({ isOffered: false }))

  on('command.run', { command: 'clean-worktrees' }, async ($, e) => {
    mark('command.run')
    const picks = parsePicks(e.args)
    if (picks && !picks.length) return { text: 'Name worktrees by their numbers from /clean-worktrees, e.g. /clean-worktrees 2 5.' }
    if (picks) return { text: await cleanPicked($, picks) }
    const l = await listWorktrees($)
    return { text: 'error' in l ? `No worktrees to list: ${l.error}.` : listingText(l) }
  })

  on('command.run', { command: 'review-adversarial' }, async ($, e) => {
    mark('command.run')
    const args = parseArgs(e.args)
    const text = args.action === 'go' ? await startRound($)
      : args.action === 'cancel' ? await cancelReview($)
        : args.action === 'status' ? await statusText($)
          : await prepareReview($, args, await read($, routing), await read($, prices))
    return { text }
  })

  on('command.run', { command: ['overview', 'default'] }, async $ => {
    mark('command.run')
    await $.ui.open({ id: PANE, title: 'Agent panel', focus: true })
    return { text: 'Agent panel opened.' }
  })

  // The routing the owner set in the panel, told to the model on every request.
  on('prompt.compose', async ($, e, next) => {
    mark('prompt.compose')
    const composed = await next(e)
    if (e.traits.includes('bare')) return composed
    const { routing: text, seen, work } = await currentPrompt($)
    const sessionId = await $.session.id()
    // A resumed chat still carries its recorded section and any later turn overrides.
    if (!await lastPrompt($, sessionId)) await rememberPrompt($, { sessionId, routing: seen, work })
    const t = await read($, toggles)
    const switches = [forcedText(t), offText(t)].filter(Boolean).join('\n')
    return {
      sections: [
        ...composed.sections.filter(s => !['agent-overview:work', 'agent-overview:vibe', 'agent-overview:mode'].includes(s.id)),
        ...(work ? [{ id: 'agent-overview:work', text: work, scope: 'session' as const }] : []),
        { id: 'agent-overview:routing', text, scope: 'session' as const },
        ...(switches ? [{ id: 'agent-overview:switches', text: switches, scope: 'session' as const }] : []),
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    mark('prompt.submit')
    if (e.isMeta || !(['composer', 'bridge', 'sdk', 'auto-continuation'].includes(e.origin.kind) || e.origin.kind === 'plugin' && (e.origin.asUser || e.origin.name === 'agent-overview'))) return next(e)
    const sessionId = await $.session.id(), previous = await lastPrompt($, sessionId), current = await currentPrompt($)
    const context: string[] = []
    // Live speeds move with every run: only a change to the routing itself sends it again.
    if (previous?.routing !== current.seen) context.push(`Delegation routing changed (overrides the earlier routing section):\n${current.routing}`)
    if (previous?.work !== current.work) context.push(`Mode instructions changed (overrides the earlier Work/Vibe mode section):\n${current.work || 'Default mode. No Work stages or Vibe instructions apply.'}`)
    if (!context.length) return next(e)
    const result = await next({ ...e, context: [...(e.context ?? []), ...context] })
    // A blocked prompt or context removed by another hook was never delivered.
    if (result.drop === undefined && context.every(text => result.context?.includes(text))) await rememberPrompt($, { sessionId, routing: current.seen, work: current.work })
    return result
  })

  on('session.measure', async ($, e, next) => {
    void claudeUsage($, e).then(() => warnContext($))
    // Claude Code's own ledger (/cost) counts the whole chat, launches before this one included.
    if (e.cost && e.changed.includes('cost')) void update($, costs, c => ({ ...c, engineUsd: e.cost!.usd }))
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    mark('skill.prompt')
    const name = e.pluginName && !e.skill.includes(':') ? `${e.pluginName}:${e.skill}` : e.skill
    if (skillMode(await read($, toggles), name) === 'off') return { text: `The skill ${name} is turned OFF for this session by the owner. Tell the user and do not follow it.` }
    void update($, used, u => ({ ...u, skills: bump(u.skills, e.skill) }))
    return next(e)
  })

  // OFF hides from what the model reads: the skill listing, deferred tool names, a plugin's injected text.
  on('prompt.attachment', async ($, e, next) => {
    mark('prompt.attachment')
    const r = await next(e)
    const a = e as unknown as { type: string; origin?: { kind?: string } }
    // Claude Code's own reminders say whether ultracode is on; the Models tab shows it.
    if (a.type === 'ultra_effort_enter' || a.type === 'ultra_effort_exit') void update($, main, m => ({ ...m, ultracode: a.type === 'ultra_effort_enter' }))
    const text = (r as { text?: string | null }).text
    if (text == null) return r
    const t = await read($, toggles)
    if (!Object.values(t).includes('off')) return r
    if (a.type === 'skill_listing') return { ...r, text: filterListing(text, n => skillMode(t, n, bareToPlugin) === 'off') }
    if (a.type === 'deferred_tools_delta') return { ...r, text: text.split('\n').filter(l => toolMode(t, l.trim()) !== 'off').join('\n') }
    if (a.type === 'mcp_instructions_delta') return { ...r, text: dropServerBlocks(text, s => t[`server:${s}`] === 'off') }
    for (const [plugin, re] of Object.entries(MARKS)) if (t[`plugin:${plugin}`] === 'off' && re.test(text)) return { ...r, text: null }
    return r
  })

  on('tool.describe', async ($, e, next) => {
    mark('tool.describe')
    let r = await next(e)
    if ((e.tool === QA_TOOL || e.tool === GRILL_TOOL) && (await read($, ui)).area === 'vibe') return { ...r, description: 'QA logging is suppressed in Vibe mode. Do not call this tool.', isDeferred: true }
    if (e.tool === QA_TOOL && !(await read($, guard)).qaLog) r = { ...r, description: 'Use this only while grilling the owner: keep their answers to your grilling questions. Do not log other answers or instructions. question: what you asked. answer: their answer as one or two clear sentences. kind: answer.' }
    const m = toolMode(await read($, toggles), (e as unknown as { tool: string }).tool)
    if (m === 'off') return { ...r, description: 'Turned OFF by the owner for this session. Do not call it.', isDeferred: true }
    if (m === 'force') return { ...r, description: `${r.description}\n\nThe owner set this to FORCE: use it whenever it applies.`, isDeferred: false }
    return r
  })

  // A plugin turned off also stops its hooks' text reaching new sessions and subagents.
  on('classic.SessionStart', async ($, e, next) => (mark('classic.SessionStart'), stripInjected($, await next(e))))
  on('classic.SubagentStart', async ($, e, next) => (mark('classic.SubagentStart'), stripInjected($, await next(e))))

  on('agent.spawn', async ($, e, next) => {
    mark('agent.spawn')
    // The owner's own adversarial review: its reviewer, model and effort are the command's, outside the routing.
    // Only the spawn startRound is making right now gets through (a run awaiting a round, its one-shot claim, its exact
    // description); a model that names the type itself is refused, so it cannot start Opus without the cost confirmation.
    if (e.subagentType === ADVERSARY) {
      if (!(await takeSpawn($, e.description))) return { deny: 'The review agent starts only from /review-adversarial go (or Run in the agent panel) after the cost is confirmed, never from a tool call.' }
      const startedAt = await $.clock.now()
      const node: AgentNode = { id: `${e.tool_use_id || 'review'}:${++seq}`, run: mainTurn, input: clip(e.prompt, 20000), label: e.description || 'Adversarial review', kind: 'adversary', model: e.model ?? ADVERSARY_MODEL, state: 'running', steps: 0, startedAt }
      await update($, nodes, all => [...all, node].slice(-60))
      const ran = await next(e)
      await setNode($, n => n.id === node.id, n => ({ ...n, agentId: ran.agentId, ...(ran.deny ? { state: 'failed' as const, endedAt: startedAt } : {}) }))
      await noteReviewer($, ran.agentId)
      return ran
    }
    const r0 = await liveRouting($)
    const g = normalGuard(await read($, guard))
    if (!r0.on.claude) return { deny: 'Claude crew is off; use an enabled provider.' }
    if (r0.role === 'plan' && g.planSubagents === 'block') return { deny: planDeny(r0) }
    const task = await checkTask($, e)
    const declared = parseDeclaration(String(e.description ?? ''))
    if ('deny' in task) {
      await logRoute($, task.item)
      $.ui.toast(`✗ ${task.deny.slice(0, 90)}`)
      return { deny: task.deny }
    }
    const tableRoute = 'route' in task ? task.route : undefined
    if ('warn' in task && task.warn) $.ui.toast(task.warn)
    const workflow = routingCalls.get(e.tool_use_id)?.workflow
    const workflowReason = e.workflow ? workflowReasons.get(e.tool_use_id) : undefined
    const selected = !e.fork && !e.resume ? babysitterModel(e.prompt, e.model, g.babysitterModel) : undefined
    const input = {
      ...e,
      model: selected ?? e.model,
      prompt: [e.prompt, workflow?.prompt, workflowReason ? `Reason: ${workflowReason}` : undefined].filter(Boolean).join('\n'),
      description: [e.description, workflow?.description].filter(Boolean).join('\n'),
    }
    const route: SubagentRoute = selected ? {} : subagentRoute(r0, g, input, !!workflowReason || refusedRoutes.has(e.parentAgentId ?? 'main'), (await pastCaps($)).map(x => x.p))
    if (route.deny) { refusedRoutes.add(e.parentAgentId ?? 'main'); return { deny: route.deny } }
    const startedAt = await $.clock.now()
    const resumed = e.resume?.agentId
    if (resumed && (await read($, nodes)).some(n => n.agentId === resumed)) {
      speedAgents.delete(resumed)
      const ran = await next(e)
      if (ran.deny) return ran
      await setNode($, n => n.agentId === resumed, n => ({ ...n, state: 'running', endedAt: undefined, startedAt, stopping: undefined }))
      const node = (await read($, nodes)).find(n => n.agentId === resumed)!
      await recordRoute($, node.id, e.description || node.label, route, e.tool_use_id)
      return ran
    }
    // The graph's parent: the workflow run it belongs to, else the agent that spawned it.
    const list = await read($, nodes)
    if (e.parentAgentId && list.some(n => n.agentId === e.parentAgentId && n.stopping)) return { deny: 'Stopped by the owner from the agent panel: start nothing new, reply with one line on where you got to.' }
    const group = e.workflow ? `wf:${e.tool_use_id}` : undefined
    if (group && !list.some(n => n.id === group)) {
      await update($, nodes, all => [...all, { id: group, label: 'Workflow', kind: 'workflow', model: e.parentModel, state: 'running' as const, steps: 0, startedAt, run: group }].slice(-60))
    }
    const parentNode = group ?? (e.parentAgentId ? list.find(n => n.agentId === e.parentAgentId)?.id : undefined)
    const run = group ?? (parentNode ? list.find(n => n.id === parentNode)?.run : undefined) ?? mainTurn
    const node: AgentNode = {
      // Workflow agents share one tool_use_id, so each node gets its own.
      id: `${e.tool_use_id}:${++seq}`,
      parentNode,
      run,
      input: clip(e.prompt, 20000),
      label: e.description,
      kind: e.subagentType,
      model: e.model ?? '…',
      parentId: e.parentAgentId,
      state: 'running',
      steps: 0,
      startedAt,
      // What the spawn declared, kept on the node so a side-lane call can inherit it before the route log has the agent's id.
      sensitivity: 'item' in task ? task.item.sensitivity : undefined,
      escalated: !isProblem(declared) && isEscalated(declared.rest) ? true : undefined,
    }
    await update($, nodes, all => [...all, node].slice(-60))
    void update($, used, u => ({ ...u, agentTypes: bump(u.agentTypes, e.subagentType) }))
    // Claude subagents take the owner's first-choice model when the call names none; under
    // "Claude plans only" they are told to hand the work itself to the side provider.
    const preferred = r0.models.claude[0]
    const handoff = route.handoff ?? (!e.fork && !e.resume ? handoffText(r0, await read($, modelSpeeds)) : undefined)
    // An explicit model on the call wins; the table fills in only when the caller named none (a silent swap hid
    // Fable and Opus requests behind the table's Sonnet, 17 Nov).
    let spawn = selected ? { ...e, model: selected } : tableRoute && !e.model ? { ...e, model: tableRoute.model } : preferred && !e.model && !e.fork && !e.resume && r0.role !== 'plan' ? { ...e, model: preferred } : e
    if (handoff) spawn = { ...spawn, prompt: `${handoff}\n\n${spawn.prompt}` }
    if (spawn.model) await setNode($, n => n.id === node.id, n => ({ ...n, model: spawn.model! }))
    let ran
    try {
      ran = await next(spawn)
    } catch (err) {
      await setNode($, n => n.id === node.id, n => ({ ...n, state: 'failed', endedAt: startedAt }))
      throw err
    }
    const endedAt = ran.deny ? await $.clock.now() : undefined
    const got = ran
    if (got.agentId) speedAgents.delete(got.agentId)
    await setNode($, n => n.id === node.id, n => ({
      ...n,
      model: got.model ?? n.model,
      agentId: got.agentId,
      ...(got.deny ? { state: 'failed' as const, endedAt } : {}),
    }))
    if (got.agentId && !got.deny) await update($, agentSens, l => [...l.filter(x => x.agentId !== got.agentId), { agentId: got.agentId!, sensitivity: node.sensitivity, parent: e.parentAgentId, escalated: node.escalated }].slice(-AGENT_SENS_CAP))
    if ('item' in task) await logRoute($, { ...task.item, agentId: got.agentId, model: spawn.model ?? got.model ?? task.item.model, ...(got.deny ? { outcome: 'failed' as const, note: got.deny } : {}) })
    if (ran.deny) $.ui.toast(`✗ ${node.label}`)
    else {
      if (selected && selected !== e.model) await logDecision($, { decision: `babysitter moved to ${selected}`, why: 'This subagent only runs and waits on a side provider.', impact: 'low', at: startedAt })
      await recordRoute($, node.id, node.label || node.kind, route, e.tool_use_id)
    }
    return ran
  })

  // The main chat is running too while Claude answers you.
  on('turn.start', async ($, e, next) => {
    mark('turn.start', e.agentId ? 'turn.start:agent' : 'turn.start:main')
    refusedRoutes.delete(e.agentId ?? 'main')
    if (!e.agentId) {
      await mainTurnStarted($, e.turnId)
      $.ui.invalidate('prompt.section')
      mainTurn = `turn:${e.turnId}`
      const since = await $.clock.now()
      const claude = (await read($, costs)).claude
      turnStart = { id: e.turnId, since, ...claudeTotal(claude, await read($, prices)), outputs: Object.fromEntries(Object.entries(claude).map(([model, t]) => [model, t.output])), children: {} }
      await update($, main, m => ({ ...m, working: true, since, steps: 0, lastTool: undefined, trail: [] }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    mark('turn.complete')
    if (!e.agentId) markCount('turn.complete:main')
    refusedRoutes.delete(e.agentId ?? 'main')
    const usage = e.usage
    if (usage) {
      const known = !!(await read($, costs)).claude[usage.model]
      if (!known) void Promise.resolve().then(() => ensurePrices($))
      await update($, costs, c => ({
        ...c,
        claude: { ...c.claude, [usage.model]: addTokens(c.claude[usage.model] ?? zero(), { input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens }) },
      }))
    }
    if (e.agentId) {
      const agentId = e.agentId
      await reviewerDone($, agentId, e.answer ?? '', e.reason === 'answer')
      await settleRoute($, x => x.agentId === agentId, { outcome: e.reason === 'answer' ? 'done' : 'failed', ms: e.durationMs, tokens: usage ? usage.input_tokens + usage.output_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : undefined })
      if (usage) {
        if (turnStart) turnStart.children[usage.model] = (turnStart.children[usage.model] ?? 0) + usage.output_tokens
        await recordSpeed($, usage.model, usage.output_tokens, e.durationMs)
        speedAgents.add(e.agentId)
      }
      const endedAt = await $.clock.now()
      if (!(await read($, nodes)).some(x => x.agentId === e.agentId)) await adopt($, e.agentId)
      const list = await read($, nodes)
      const n = list.find(x => x.agentId === e.agentId && x.state === 'running')
      if (n) {
        const state: AgentNode['state'] = e.reason === 'answer' ? 'done' : 'failed'
        await setNode($, x => x.id === n.id, x => ({ ...x, state, endedAt, output: clip(e.answer, 2000) }))
        await remember($, n, state, endedAt)
        const took = n.startedAt ? ` · ${Math.round((endedAt - n.startedAt) / 1000)}s` : ''
        $.ui.toast(`${state === 'done' ? '✓' : '✗'} ${n.label}${took}`)
      }
    } else {
      if (turnStart?.id === e.turnId) {
        const at = await $.clock.now()
        const total = claudeTotal((await read($, costs)).claude, await read($, prices))
        const entry: TurnCost = { durationMs: at - turnStart.since, usd: total.usd === undefined || turnStart.usd === undefined ? undefined : total.usd - turnStart.usd, tokens: total.tokens - turnStart.tokens, at }
        await update($, turnCosts, all => [...all, entry].slice(-50))
        for (const [model, t] of Object.entries((await read($, costs)).claude)) {
          await recordSpeed($, model, t.output - (turnStart.outputs[model] ?? 0) - (turnStart.children[model] ?? 0), entry.durationMs)
        }
        turnStart = undefined
      }
      void update($, main, m => ({ ...m, working: false }))
      void refreshGit($)
      await mainTurnEnded($, e.turnId)
    }
    const l = await read($, live)
    if (l && l.agent === e.agentId) await update($, live, () => null)
    const key = e.agentId ?? 'main'
    const at = await $.clock.now()
    const act = (await read($, acts))[key]
    if (act?.state === 'running' && !act.toolUseId) {
      await update($, acts, all => ({ ...all, [key]: { ...act, state: 'failed' as const, endedAt: at } }))
      actTools.delete(key)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    mark('turn.step', e.agentId ? 'turn.step:agent' : 'turn.step:main')
    const effort = e.effort === undefined ? undefined : String(e.effort)
    if (!e.agentId && `${e.model}/${effort}` !== lastMain) {
      lastMain = `${e.model}/${effort}`
      void update($, main, m => ({ ...m, model: e.model, effort }))
    }
    // Code being written streams in as JSON pieces; show it before the tool runs.
    const blocks = new Map<number, { id: string; tool: string; json: string; shown: number }>()
    const show = async (b: { id: string; tool: string; json: string }) => {
      if (ranEdits.has(b.id)) return
      const mine: LiveEdit = {
        id: b.id,
        tool: b.tool,
        file: partialField(b.json, 'file_path') ?? partialField(b.json, 'notebook_path') ?? '',
        text: partialField(b.json, STREAMED[b.tool]!) ?? '',
        agent: e.agentId,
        seq: ++seq,
      }
      void update($, live, cur => (ranEdits.has(mine.id) || (cur && cur.seq > mine.seq) ? cur : mine))
      const key = e.agentId ?? 'main'
      const previous = (await read($, acts))[key]
      const at = actTools.get(key) === b.id ? previous?.at ?? await $.clock.now() : await $.clock.now()
      actTools.set(key, b.id)
      const newText = partialField(b.json, STREAMED[b.tool]!)
      const context = b.tool === 'Edit' && newText !== undefined
        ? await editContext($, b.id, mine.file, partialField(b.json, 'old_string') ?? '') : undefined
      if (!ranEdits.has(b.id) && actTools.get(key) === b.id) await setAct($, {
        key, tool: b.tool, title: mine.file, state: 'running', at, file: mine.file, text: mine.text,
        ...(b.tool === 'Write' ? { startLine: 1 } : {}), ...context,
      }, b.id)
    }
    for await (const c of next(e)) {
      if (c.kind === 'tool' && STREAMED[c.name]) {
        blocks.set(c.index, { id: c.id, tool: c.name, json: '', shown: 0 })
      } else if (c.kind === 'input') {
        const b = blocks.get(c.index)
        if (b) {
          b.json += c.json
          // Redraws grow apart as the text grows, so a huge Write stays linear in cost.
          if (b.json.length >= b.shown * 1.25 + 60) {
            b.shown = b.json.length
            await show(b)
          }
        }
      }
      yield c
    }
    for (const b of blocks.values()) await show(b)
  })

  on('tool.call', ($, call, next) => watchCall($, call as unknown as Loose, async () => {
    // One loose view of every tool's input: narrowing the full union here is too deep for tsc.
    const e = call as unknown as Loose
    mark('tool.call')
    if (e.tool === 'Workflow') {
      const r = await liveRouting($)
      const g = normalGuard(await read($, guard))
      if (!r.on.claude) return { deny: 'Claude crew is off; use an enabled provider.' }
      if (r.role === 'plan' && g.planSubagents === 'block') return { deny: planDeny(r) }
      const input = { prompt: String(e.script ?? ''), description: String(e.description ?? e.name ?? '') }
      // Named/on-disk workflows and side-run scripts defer to each actual spawn's prompt and model.
      const route = e.scriptPath || e.name || babysitting(input.prompt) ? {} : subagentRoute(r, g, input, refusedRoutes.has(e.agentId ?? 'main'), (await pastCaps($)).map(x => x.p))
      if (route.deny) { refusedRoutes.add(e.agentId ?? 'main'); return { deny: route.deny } }
      const ctx = routingCalls.get(e.tool_use_id)!
      ctx.workflow = input
      ctx.route = route
      if (route.reason) {
        workflowReasons.set(e.tool_use_id, route.reason)
        if (workflowReasons.size > 60) workflowReasons.delete(workflowReasons.keys().next().value!)
      }
      if (route.notice) ctx.notices.add(route.notice)
    }
    if (e.agentId && !(await read($, nodes)).some(n => n.agentId === e.agentId)) await adopt($, e.agentId)
    if (e.agentId && (await read($, nodes)).some(n => n.agentId === e.agentId && n.stopping)) {
      return { deny: 'Stopped by the owner from the agent panel. Do not call more tools: reply now with one line on where you got to.' }
    }
    const sw = await read($, toggles)
    if (e.tool === 'Skill' && skillMode(sw, String(e.skill ?? ''), bareToPlugin) === 'off') return { deny: `Skill ${e.skill} is OFF for this session (the owner's switch in the agent panel).` }
    if (toolMode(sw, e.tool) === 'off') return { deny: `${e.tool} is OFF for this session (the owner's switch in the agent panel).` }
    const locked = stageDeny((await read($, ui)).area, await read($, stage), e)
    if (locked) return { deny: locked }
    if (e.tool === REVIEW_TOOL) {
      const at = await $.clock.now()
      await update($, findings, list => mergeFinding(list, e, at))
      return { result: 'logged' }
    }
    if (e.tool === DECISION_TOOL) {
      const impact = e.impact === 'high' || e.impact === 'medium' ? e.impact : 'low'
      const item: DecisionItem = { decision: String(e.decision ?? ''), why: String(e.why ?? ''), impact, at: await $.clock.now() }
      await logDecision($, item)
      return { result: 'noted' }
    }
    if (e.tool === OLLAMA_TOOL) return ollamaRun($, e)
    if (e.tool === GEMINI_TOOL) return geminiTool($, e)
    if (e.tool === REVIEW_PREP_TOOL) {
      const text = await prepareReview($, { action: 'prepare', base: typeof e.base === 'string' && e.base.trim() ? e.base.trim() : undefined, goal: String(e.goal ?? ''), rounds: typeof e.rounds === 'number' ? Math.max(1, Math.min(5, Math.round(e.rounds))) : undefined }, await read($, routing), await read($, prices))
      return { result: `${text}\nDo not start it yourself: only ${ownerName()} starts it.` }
    }
    if (e.tool === QA_TOOL || e.tool === GRILL_TOOL) {
      if ((await read($, ui)).area === 'vibe') return { result: 'QA logging suppressed in Vibe mode' }
      const item: GrillItem = { question: String(e.question ?? ''), answer: String(e.answer ?? ''), kind: e.kind === 'instruction' ? 'instruction' : 'answer', at: await $.clock.now() }
      await update($, grill, list => [...list, item].slice(-40))
      return { result: 'logged' }
    }
    if (e.tool === 'Workflow') {
      const script = String(e.script ?? '')
      const name = /name:\s*['"]([^'"]+)['"]/.exec(script)?.[1] ?? String(e.name ?? 'Workflow')
      const about = /description:\s*['"]([^'"]+)['"]/.exec(script)?.[1] ?? ''
      const id = `wf:${e.tool_use_id}`
      const group: AgentNode = { id, label: name, kind: 'workflow', model: (await read($, main)).model, state: 'running', steps: 0, startedAt: await $.clock.now(), input: about, run: id, parentNode: e.agentId ? (await read($, nodes)).find(n => n.agentId === e.agentId)?.id : undefined }
      await update($, nodes, all => (all.some(n => n.id === id) ? all.map(n => (n.id === id ? { ...n, ...group, startedAt: n.startedAt } : n)) : [...all, group].slice(-60)))
    }
    if (!e.agentId) {
      const at = await $.clock.now()
      const arg = String(e.description ?? (typeof e.file_path === 'string' ? e.file_path.split('/').pop() : undefined) ?? e.pattern ?? (typeof e.command === 'string' ? e.command.trim().slice(0, 60) : undefined) ?? e.skill ?? e.query ?? '')
      void update($, main, m => ({ ...m, steps: (m.steps ?? 0) + 1, lastTool: e.tool, trail: [...(m.trail ?? []), { tool: e.tool.replace(/^mcp__.+?__/, ''), arg: arg || undefined, at }].slice(-10) }))
    }
    if (e.agentId) {
      const at = await $.clock.now()
      const tool = e.tool.replace(/^mcp__.+?__/, '')
      const arg = String(e.file_path ?? e.notebook_path ?? e.pattern ?? (typeof e.command === 'string' ? e.command.trim().split(/\s+/)[0] : undefined) ?? e.description ?? '').split('/').pop()
      void setNode($, n => n.agentId === e.agentId, n => ({ ...n, steps: n.steps + 1, lastTool: e.tool, trail: [...(n.trail ?? []), { tool, arg: arg || undefined, at }].slice(-12) }))
    }
    if (e.tool.startsWith('mcp__')) {
      const server = e.tool.split('__')[1] ?? e.tool
      if (server !== 'agent-overview') void update($, used, u => ({ ...u, mcp: bump(u.mcp, server) }))
    }

    // A declared Agent task runs at the effort the owner's table gives it.
    let sent = call
    if (e.tool === 'Agent' && e.subagent_type !== 'fork') {
      const d = parseDeclaration(String(e.description ?? ''))
      if (!isProblem(d)) {
        const policy0 = await read($, policy)
        const route = policy0.declare === 'off' ? undefined : resolveRoute(policy0, d.type, await openLanes($, d.sensitivity), d.sensitivity)
        const effort = lowerEffort(!route ? undefined : route.lane === 'claude' ? route.effort : FALLBACK[route.lane].effort, d.effort)
        if (effort && effort !== e.effort) sent = { ...call, effort } as typeof call
      }
    }
    let ran
    const r = await read($, routing)
    const refuse = (p: Provider, why: string) => {
      const alt = r.order.find(q => r.on[q] && q !== p && q !== 'ollama' && !(q === 'antigravity' && !agyJobOn(r, 'coding')))
      return { deny: `${nameOf(p)} ${why} (set by the owner in the agent panel's Routing tab). ${alt ? `Use ${nameOf(alt)} instead, or` : 'Use'} a Claude subagent.` }
    }
    const parentRow = e.agentId ? (await read($, nodes)).find(n => n.agentId === e.agentId) : undefined
    const parentNode = parentRow?.id
    const base = { id: e.tool_use_id, state: 'running', steps: 0, startedAt: await $.clock.now(), parentId: e.agentId, parentNode, run: parentRow?.run ?? mainTurn } as const
    // Every Antigravity MCP tool takes the same gate, not only the three that run tasks.
    if (/^mcp__antigravity__/.test(e.tool)) {
      if (r.role === 'claude') return refuse('antigravity', 'is paused: Claude only')
      if (!r.on.antigravity) return refuse('antigravity', 'is turned off')
      const chain = await chainInfo($, e.agentId)
      if (chain.escalated) return { deny: ESCALATED_DENY }
      const isCoding = e.tool === 'mcp__antigravity__gemini_bounded_task'
      const job = isCoding ? 'coding' : 'visual'
      if (!agyJobOn(r, job)) return refuse('antigravity', `has ${isCoding ? 'coding or text work' : 'visual checks'} disabled or out of quota`)
      // Public material only, like gemini_run: a subagent's chain is at least internal (so refused); the main thread is public unless the call says otherwise.
      const said = typeof (call as { sensitivity?: unknown }).sensitivity === 'string' ? (call as { sensitivity: string }).sensitivity : undefined
      const callText = JSON.stringify(call)
      const sensitivity = strictest([chain.sensitivity, said, /\bsensitivity:\s*client\b/i.test(callText) ? 'client' : undefined]) ?? 'public'
      const cloud = await cloudOk($, { text: callText, sensitivity, publicOnly: true })
      if (!cloud.allowed) return { deny: `Antigravity refused: ${cloud.why}. Keep this in Claude or on Ollama (set by the owner in the agent panel's Models tab, CONFIDENTIAL card).` }
      const preferred = agyJobModel(r, job)
      const model = typeof e.model === 'string' && e.model ? e.model : preferred
      const notice = agyModelNotice(r, await read($, guard), job, model)
      const sent = model !== e.model ? ({ ...call, model } as typeof call) : call
      const tool = e.tool.replace('mcp__antigravity__', '')
      const ask = clip(e.task ?? e.prompt ?? e.question ?? e.instructions ?? '', 600)
      ran = await track($, { ...base, label: tool, kind: 'Antigravity', model, provider: 'antigravity', input: ask }, () => mediaCall($, e.tool, () => next(sent)))
      if (notice && ran.deny === undefined) ran = { ...ran, context: [...(ran.context ?? []), notice] }
      const text = `${(ran as { text?: string }).text ?? ''}`
      if (ran.isError && /quota|RESOURCE_EXHAUSTED|429|rate.?limit/i.test(text)) {
        const alert = `quota hit ${/resets? (?:in|after) ([\dhms.]+)/i.exec(text)?.[1] ? `· resets in ${/resets? (?:in|after) ([\dhms.]+)/i.exec(text)?.[1]}` : 'just now'}`
        await antigravityUsage($)
        if ((await read($, providers).then(allOf)).antigravity.usageSource !== 'live') await update($, providers, all => ({ ...all, antigravity: { ...all.antigravity, alert } }))
        await watchQuota($)
      } else if (!ran.isError) {
        void antigravityUsage($).then(() => watchQuota($))
        const u = parseAgyUsage(`${(ran as { text?: string }).text ?? ''}${typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? '')}`)
        if (u) void update($, costs, c => ({ ...c, agy: { ...c.agy, [model]: addTokens(c.agy[model] ?? zero(), u) } }))
      }
    } else {
      // The Antigravity CLI never runs from Bash, in any form: only gemini_run carries the checks (switches, allowlist, sensitivity, images).
      if (e.tool === 'Bash') {
        const command = String(e.command ?? '')
        const why = await runsAgy($, command, await $.session.cwd().catch(() => ''))
        if (why) {
          if (r.role === 'claude') return refuse('antigravity', 'is paused: Claude only')
          if (!r.on.antigravity) return refuse('antigravity', 'is turned off')
          const chain = await chainInfo($, e.agentId)
          const cloud = await cloudOk($, { text: command, sensitivity: chain.sensitivity })
          if (!cloud.allowed) return { deny: `Antigravity refused: ${cloud.why}. Keep this in Claude or on Ollama (set by the owner in the agent panel's Models tab, CONFIDENTIAL card).` }
          return { deny: `Antigravity is not run from Bash (${why}). Use mcp__agent-overview__gemini_run for public material: it carries the allowlist, sensitivity and image checks.` }
        }
      }
      const ext = e.tool === 'Bash' ? externalOf(String(e.command ?? '')) : undefined
      if (ext && r.role === 'claude') return refuse(ext.provider, 'is paused: Claude only')
      if (ext && !r.on[ext.provider]) return refuse(ext.provider, 'is turned off')
      if (ext) {
        const picks = livePicks(r).filter(x => x.provider === ext.provider)
        const pick = picks.find(x => x.model === ext.model) ?? picks[0]
        const detached = e.run_in_background !== true && detachedCommand(String(e.command ?? ''))
        const command = withFlags(String(e.command ?? ''), ext.provider, { ...pick, run: detached ? base.id : undefined, disable: (await read($, guard)).codexImages === 'off' ? ['image_generation'] : undefined })
        const model = ext.model ?? pick?.model ?? r.models[ext.provider][0] ?? (await read($, providers).then(allOf))[ext.provider].current ?? nameOf(ext.provider)
        const label = String(e.description ?? nameOf(ext.provider))
        const home = await $.env.get('HOME').catch(() => undefined) ?? ''
        const dir = reviewCwd(String(e.command ?? ''), ext.provider, home)
        const snap = e.run_in_background === true || !dir ? undefined : await snapshot($, dir.cwd)
        // The shell opens stdin before a CLI's --cd flag takes effect.
        const input = clip(await sidePrompt($, String(e.command ?? ''), undefined, reviewCwd(String(e.command ?? ''), 'opencode', home)?.cwd) ?? e.command, 20000)
        const run = () => next(command === e.command ? call : { ...call, command } as typeof call)
        ran = e.run_in_background === true ? await run() : await track($, { ...base, startedAt: await $.clock.now(), label, kind: nameOf(ext.provider), model, effort: externalOf(command)?.effort, provider: ext.provider, input, snap, dir: dir?.cwd, detached }, run, detached)
        if (detached && !ran.deny && !ran.isError) await refreshSideRuns($)
        if (snap && !detached) await changesSince($, snap, { model, provider: ext.provider }, base.id)
        const out = `${(ran as { text?: string }).text ?? ''}${typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? '')}`.slice(-1500)
        // A successful run's answer can mention rate limits; only a failed one is a quota hit (the usage refresh catches the rest).
        // A local model has no quota to run out of.
        if (ran.isError && ext.provider !== 'ollama' && QUOTA_TEXT.test(out)) {
          await update($, providers, all => ({ ...all, [ext.provider]: { ...blank(), ...all[ext.provider], alert: 'quota hit · its run said so' } }))
          await watchQuota($)
        } else if (!ran.isError && !ran.deny) {
          await update($, providers, all => ({ ...all, [ext.provider]: { ...blank(), ...all[ext.provider], alert: all[ext.provider]?.alert === 'quota hit · its run said so' ? undefined : all[ext.provider]?.alert } }))
        }
        await watchQuota($)
        void refreshUsage($, ext.provider).then(() => watchQuota($)).catch(() => {})
      } else {
        ran = await mediaCall($, e.tool, () => next(sent))
      }
    }

    if (e.tool === 'Agent') {
      const result = ran.result as { status?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; totalDurationMs?: number } | undefined
      const u = result?.usage
      const tokens = u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : undefined
      // A background agent settles at its own turn.complete.
      if (ran.deny || ran.isError) await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'failed', note: String(ran.deny ?? ran.text ?? '').slice(0, 200) || undefined })
      else if (result?.status === 'completed') await settleRoute($, x => x.id === e.tool_use_id, { outcome: 'done', tokens, ms: result.totalDurationMs })
    }
    if (e.tool === 'Workflow') {
      const result = ran.result as { error?: unknown; status?: string } | undefined
      const failed = ran.deny || ran.isError || result?.error
      if (failed || result?.status === 'remote_launched') await setNode($, n => n.id === `wf:${e.tool_use_id}`, n => ({ ...n, state: failed ? 'failed' : 'done', endedAt: base.startedAt }))
    }
    // The skill.prompt hook was due once a Skill call went through.
    if (e.tool === 'Skill' && !ran.deny && !ran.isError) mark('tool.call:Skill')
    if (e.agentId && /^(?:Edit|Write|MultiEdit|NotebookEdit)$/.test(e.tool) && !ran.deny && !ran.isError) await setNode($, n => n.agentId === e.agentId, n => ({ ...n, ownEdits: true }))
    if (e.tool === 'Edit' || e.tool === 'Write') {
      const removed = e.tool === 'Edit' ? lineList(String(e.old_string ?? '')) : []
      const added = lineList(String((e.tool === 'Edit' ? e.new_string : e.content) ?? ''))
      const item: EditItem = {
        file: String(e.file_path ?? ''),
        lines: [...removed.map(l => `- ${l}`), ...added.map(l => `+ ${l}`)].slice(0, 12),
        agent: e.agentId,
        model: parentRow?.model ?? (await read($, main)).model,
        provider: parentRow?.provider ?? 'claude',
        added: added.length,
        removed: removed.length,
        before: removed.slice(0, 80),
        after: added.slice(0, 80),
        at: await $.clock.now(),
        isNew: e.tool === 'Write',
      }
      if (!ran.deny && !ran.isError) {
        await addEdits($, [item])
        if ((await read($, ui)).area === 'work' && /(^|\/)(adr|adrs|decisions)\/.+/i.test(item.file)) await saveStage($, s =>
          s && s.reached.includes('implement') && (item.at ?? -1) > (s.startedAt ?? -Infinity) && /\.md$/i.test(item.file) && !s.adr ? { ...s, adr: item.file } : s)
      }
    }

    return ran
  }))

  on('ui.render', { component: 'Pane', requestId: 'agent-overview' }, ($, e) => (mark('ui.render'), drawPane($, e)))

  // ---------- chat look: your prompts, Claude's replies and turn ends read differently from logs ----------

  // Your prompt: a blue bar, a soft panel and a ❯; long pastes keep the engine's own head/tail cut.
  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, async ($, e, next) => {
    const p = e.props as unknown as { text: string; origin: { kind: string } }
    if (!(await read($, guard)).chatLook) return next(e)
    if (!['composer', 'bridge'].includes(p.origin.kind) || p.text.length > 10000 || /^[!#]/.test(p.text)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box borderStyle="quote" borderColor="suggestion" flexDirection="column" marginTop={1}>
        <Box flexDirection="row" backgroundColor="userMessageBackground" paddingRight={1}>
          <Box width={2} flexShrink={0}>
            <Text color="suggestion" weight="bold">❯</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text color="text">{p.text}</Text>
          </Box>
        </Box>
      </Box>
    )
  })

  // Claude's reply: the engine's own drawing (markdown, links, error rows) inside an orange bar.
  on('ui.render', { component: 'AssistantMessage', surface: 'terminal' }, async ($, e, next) => {
    const drawn = await next(e)
    const p = e.props as unknown as { text: string; isSummary?: true }
    const t = p.text.trim()
    if (!(await read($, guard)).chatLook || p.isSummary || !t || t === 'No response requested.') return drawn
    const { Box } = $.ui.resolve(e)
    return (
      <Box borderStyle="quote" borderColor="claude" flexDirection="column">
        <Box marginTop={-1} flexDirection="column">{drawn}</Box>
      </Box>
    )
  })

  // Our own kept notes need one line, not the tool's full input and result.
  on('ui.render', { component: 'ToolUse', surface: 'terminal' }, async ($, e, next) => {
    const p = e.props
    if (![DECISION_TOOL, QA_TOOL, GRILL_TOOL].includes(p.tool) || p.isErrored || p.isInterrupted || !(await read($, guard)).chatLook) return next(e)
    const input = p.input as Partial<DecisionItem & GrillItem> | null
    const decision = p.tool === DECISION_TOOL
    const mark = input?.impact === 'high' ? '▲' : input?.impact === 'medium' ? '◆' : '·'
    const color = decision ? input?.impact === 'high' ? 'error' : input?.impact === 'medium' ? 'warning' : undefined : undefined
    const prefix = decision ? `${mark} decision · ` : `${input?.kind === 'instruction' ? 'I' : 'Q'} kept · `
    const text = fit(prefix + String((decision ? input?.decision : input?.question) ?? '').replace(/\s+/g, ' '), e.viewport?.columns ?? 80)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor wrap="truncate-end"><Text color={color}>{text.slice(0, 1)}</Text>{text.slice(1)}</Text>
  })

  on('ui.render', { component: 'ToolResult', surface: 'terminal' }, async ($, e, next) => {
    if (![DECISION_TOOL, QA_TOOL, GRILL_TOOL].includes(e.props.tool) || e.props.isErrored || !(await read($, guard)).chatLook) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // Keep the turn summary to one line.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, guard)).chatLook) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = e.props as unknown as { word: string; durationMs: number }
    const s = Math.round(p.durationMs / 1000)
    const cost = matchTurnCost(await read($, turnCosts), p.durationMs)
    const label = ` ${p.word} for ${s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}${cost?.usd !== undefined ? ` · ≈${money(cost.usd)}` : ''}${cost ? ` · ${tok(cost.tokens)} tokens` : ''} `
    return (
      <Box marginTop={1}>
        <Text dimColor wrap="truncate-end">{label.trim()}</Text>
      </Box>
    )
  })

  // Usage for every provider, dim, at the end of the hint line under the prompt.
  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, async ($, e, next) => {
    if (await contextHint($)) return next(e)
    if (!(await read($, guard)).usageTail) return next(e)
    const tail = usageTail(await read($, providers).then(allOf), await read($, routing), await $.clock.now())
    return tail ? next({ ...e, props: { ...e.props, tail } }) : next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const band = await drawBand($, e)
    if (e.surface !== 'desktop') return band ?? next(e)
    const E = tableOf($, e), rail = await officeRail($, E)
    if (!rail) return band ?? next(e)
    // No width here: the engine refuses its own drawing under a Box with a width.
    return <E.Box key="chat:band" flexDirection="column" justifyContent="flex-start" alignItems="stretch">
      {rail}
      {band ?? await next(e)}
    </E.Box>
  })
  registerVibe(on)
}
