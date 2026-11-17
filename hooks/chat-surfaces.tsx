import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { Act, AgentNode, AlertKind, ChatSurfaceState, DecisionItem, EditItem, Finding, MainInfo, Providers, Routing, SideLive, Stage, Ui } from '../types'
import { babysitterDrivers, displayAgents } from './babysitter'
import { stateOf, watchKey } from './graph'
import { agyJobOn, agyQuotaLine, routingHow, PROVIDERS, blank, colorOf, defaultRouting, nameOf, normalGuard, providerOf, tagOf, missingOf, without } from './state'
import { Chip, clock, fit, saveGuard, shortModel, tableOf } from './ui'
import type { $, E } from './ui'
import { applyPreset } from './presets'
import { seedPresets } from './preset-state'
import { NOT_INSTALLED, refreshUsage, watchQuota } from './providers'
import { handoff, performHandoff, undoHandoff } from './vibe/crew'
import { modeBusy } from './modes'
import { findingKey, workCaps, writesFiles } from './work/stage'
import { commandLocation, isTestCommand, literalWords, permissionContext, testFiles } from './chat-permission'
import { TEST_RE } from './vibe/data'

const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
const acts = atom({ plugin: 'agent-overview', key: 'acts' } as const, {} as Record<string, Act>)
const sideLive = atom({ plugin: 'agent-overview', key: 'sideLive' } as const, null as SideLive | null)
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, Object.fromEntries(PROVIDERS.map(p => [p.id, blank()])) as Providers)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const findings = atom({ plugin: 'agent-overview', key: 'findings' } as const, [] as Finding[])
const decisions = atom({ plugin: 'agent-overview', key: 'decisions' } as const, [] as DecisionItem[])
const chatSurface = atom({ plugin: 'agent-overview', key: 'chatSurface' } as const, { editVersion: 0, alerts: {} } as ChatSurfaceState)
let restoring = false

const oneLine = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim()
export const runDuration = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}m ${s % 60}s` }
const side = (n: AgentNode) => n.kind !== 'workflow' && (n.provider ?? providerOf(n.model)) !== 'claude'
export function claudeLeft(ps: Providers): number | undefined {
  const meters = ps.claude.meters.filter(m => m.label !== 'Context' && Number.isFinite(m.percent))
  return meters.length ? Math.max(0, 100 - Math.max(...meters.map(m => m.percent))) : undefined
}
export async function contextHint($: EngineInterface): Promise<string | undefined> {
  if (!normalGuard(await read($, guard)).chat.hint) return
  const u = await read($, ui), s = await read($, stage)
  if (u.area === 'work' && (!s || s.at === 'plan')) return 'plan locked · advance in panel'
  const ps = await read($, providers), left = claudeLeft(ps)
  if (left !== undefined && left < 20 && handoff(await read($, routing), ps, await workCaps($))) return `Claude ${Math.round(left)}% left · /handover`
  const high = u.area === 'work' && s?.at === 'review' ? (await read($, findings)).filter(f => f.severity === 'high' && !f.dismissed).length : 0
  if (high) return `review · ${high} high finding${high === 1 ? '' : 's'}`
  if (u.area === 'vibe' && (await read($, chatSurface)).waiting) return 'waiting on you'
}

export async function chatBandExtras($: $, E: E, width: number) {
  const g = normalGuard(await read($, guard)).chat, now = await $.clock.now()
  const list = displayAgents(await read($, nodes), await read($, edits))
  const running = list.filter(n => side(n) && stateOf(n, list) === 'running')
  const done = list.filter(n => side(n) && stateOf(n, list) !== 'running' && n.endedAt !== undefined && now >= n.endedAt && now - n.endedAt < 20000)
  const ps = await read($, providers), r = await read($, routing), u = await read($, ui)
  const left = claudeLeft(ps), low = g.stripQuota && left !== undefined && left < 20
  const candidate = low ? handoff(r, ps, await workCaps($)) : undefined
  const undo = g.stripQuota && u.vibeUndo && now < u.vibeUndo.until
  const handed = candidate && tagOf(r, candidate.provider) === 'main' && tagOf(r, 'claude') === 'saver'
  return [
    ...(g.stripRuns ? running.map(n => <E.Box key={`chat:run:${n.id}`} flexDirection="row" gap={1} minWidth={0} width="100%">
      <E.Box flexShrink={0}><E.Text color={colorOf(n.provider ?? providerOf(n.model))}>●</E.Text></E.Box>
      <E.Box flexGrow={1} flexShrink={1} minWidth={0}><E.Text wrap="truncate-end">
        {fit(`${nameOf(n.provider ?? providerOf(n.model))}·${shortModel(n.model)} · ${oneLine(n.label || n.input || n.kind)}`, Math.max(12, width - 9))}
      </E.Text></E.Box>
      <E.Box flexShrink={0}><E.Text dimColor>· {clock(now - (n.startedAt ?? now))}</E.Text></E.Box>
    </E.Box>) : []),
    ...(g.stripDone ? done.map(n => <E.Text key={`chat:done:${n.id}`} color={n.state === 'failed' ? 'error' : colorOf(n.provider ?? providerOf(n.model))} wrap="truncate-end">
      {nameOf(n.provider ?? providerOf(n.model))} {n.state === 'failed' ? 'failed' : 'done'} · {runDuration(n.endedAt! - (n.startedAt ?? n.endedAt!))}
    </E.Text>) : []),
    ...(low || undo ? [<E.Box key="chat:quota" flexDirection="row" flexWrap="wrap" gap={1}>
      {low ? <E.Text color="warning">Claude {Math.round(left!)}% left</E.Text> : null}
      {candidate && !handed ? <E.Button key="chat:handoff" plain onPress={() => performHandoff($)}>{Chip(E, 'Hand off', false, 'warning')}</E.Button> : null}
      {handed ? <E.Text dimColor>{nameOf(candidate.provider)} is Main</E.Text> : null}
      {low && !candidate ? <E.Text dimColor>no available crew</E.Text> : null}
      {undo ? <E.Button key="chat:undo" plain onPress={() => undoHandoff($)}>{Chip(E, 'Undo', false)}</E.Button> : null}
    </E.Box>] : []),
  ]
}

export const MENTIONS = { codex: 'codex', opencode: 'opencode', cmd: 'commandcode', commandcode: 'commandcode', gemini: 'antigravity', antigravity: 'antigravity' } as const
const mentionsIn = (text: string) => [...text.matchAll(/(^|\s)@(codex|opencode|commandcode|cmd|antigravity|gemini)(?=$|\s|[,:;!?])/gi)]
const mentionPick = (r: Routing, p: keyof Providers) => r.picks.find(x => x.provider === p) ?? { provider: p, model: r.models[p][0], effort: undefined }
const enabled = (r: Routing, p: keyof Providers) => r.on[p] && !r.paused?.[p] && r.role !== 'claude' && (p !== 'antigravity' || agyJobOn(r, 'coding') || agyJobOn(r, 'visual'))
export function mentionSuggestions(r: Routing, token: string) {
  return Object.entries(MENTIONS).filter(([alias, p]) => `@${alias}`.startsWith(token.toLowerCase()) && enabled(r, p)).map(([alias, p]) => {
    const pick = mentionPick(r, p)
    return { text: `@${alias}`, description: `${nameOf(p)} · ${pick.model ?? 'default model'}${pick.effort ? ` · ${pick.effort}` : ''}` }
  })
}
export function usageLines(ps: Providers, r: Routing) {
  return PROVIDERS.map(({ id, name }) => {
    const info = ps[id], meters = info.meters.filter(m => m.label !== 'Context')
    if (info.status === 'missing') return `${name}: ${info.error && info.error !== NOT_INSTALLED ? `not set up · ${oneLine(info.error)}` : NOT_INSTALLED}`
    const quota = meters.map(m => `${m.label} ${Number(Math.max(0, 100 - m.percent).toFixed(6))}% left${m.detail ? ` · ${oneLine(m.detail)}` : ''}`).join(' · ') || 'quota not reported'
    return `${name}: ${quota}${info.usageSource && info.usageSource !== 'live' ? ` · ${info.usageSource}` : ''}${r.paused?.[id] ? ' · paused' : !r.on[id] ? ' · off' : ''}${id === 'antigravity' && agyQuotaLine(r) ? ` · ${agyQuotaLine(r)}` : ''}${info.alert ? ` · ${oneLine(info.alert)}` : ''}`
  }).join('\n')
}

async function alert($: EngineInterface, kind: AlertKind, text: string) {
  if (restoring) return
  const g = normalGuard(await read($, guard)).chat, options = g.events[kind]
  if (!options.notify && !(g.sounds && options.sound)) return
  const now = await $.clock.now()
  let claimed = false
  await update($, chatSurface, s => {
    claimed = s.alerts[kind] === undefined || now - s.alerts[kind]! >= 60000
    return claimed ? { ...s, alerts: { ...s.alerts, [kind]: now } } : s
  })
  if (!claimed) return
  await Promise.allSettled([
    ...(options.notify ? [$.ui.notify(oneLine(text), { title: 'Agent panel' })] : []),
    ...(g.sounds && options.sound ? [$.audio.play({ asset: `sounds/${kind}.wav` }, { gain: .5 })] : []),
  ])
}
const exhausted = (p: Providers[keyof Providers]) => p.meters.some(m => m.label !== 'Context' && (m.limited || m.percent >= 100)) || !!p.alert && /quota|limit|exhaust|paused/i.test(p.alert)
async function askOwner($: EngineInterface, id: string, duration = 0) {
  if ((await read($, ui)).area !== 'vibe') return
  const now = await $.clock.now(), s = await read($, chatSurface)
  await update($, chatSurface, held => ({ ...held, waiting: id, questionSeen: id }))
  const since = s.vibeSince ?? (await read($, main)).since
  if (s.questionSeen !== id && Math.max(duration, since === undefined ? 0 : now - since) > 600000) await alert($, 'question', 'Claude is waiting on you')
}

const COMMANDS = [
  { name: 'handover', description: 'Hand Claude work to the crew', argumentHint: '[undo]' },
  { name: 'mode', description: 'Preview a mode switch', argumentHint: 'default|work|vibe' },
  { name: 'preset', description: 'List or select a routing preset', argumentHint: '[name]' },
  { name: 'guard', description: 'Set the routing guard', argumentHint: 'warn|enforce|off' },
  { name: 'usage', description: 'Quota by provider' }, { name: 'decisions', description: 'Last five decisions' },
] as const

export function registerChatSurfaces(on: On) {
  on('session.start', {}, async ($, e, next) => {
    restoring = true
    try {
      const result = await next(e)
      // Another plugin may own a name; that one command is skipped, not the rest.
      for (const spec of COMMANDS) await $.command.register({ ...spec, immediate: true }).catch(() => {})
      // A second cadence updates clocks and expires completions without animating the panel.
      $.clock.every(1000, () => { void (async () => {
        const list = await read($, nodes), now = await $.clock.now(), u = await read($, ui)
        if (list.some(n => side(n) && (n.state === 'running' || n.endedAt !== undefined && now - n.endedAt <= 21000)) || u.vibeUndo && now <= u.vibeUndo.until + 1000) $.ui.invalidate('ui.render')
      })().catch(() => {}) })
      return result
    } finally { restoring = false }
  })
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const u = await read($, ui), s = await read($, stage)
    const labels = [u.area === 'work' ? `Work · ${(s?.at ?? 'plan').replace(/^./, c => c.toUpperCase())}` : u.area === 'vibe' ? 'Vibe' : '', u.preset?.name ?? ''].filter(Boolean)
    return labels.length ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...labels] } }) : next(e)
  })
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await contextHint($)
    return hint ? next({ ...e, props: { ...e.props, hint, tail: undefined } }) : next(e)
  })
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || !normalGuard(await read($, guard)).chat.spinner || e.props.mode !== 'tool-use') return next(e)
    const raw = await read($, nodes), changes = await read($, edits), drivers = babysitterDrivers(raw, changes)
    const all = displayAgents(raw, changes), running = all.filter(n => side(n) && stateOf(n, all) === 'running')
    const activity = await read($, acts), key = watchKey(activity, all)
    const run = running.find(n => key === `node:${n.id}` || Object.values(activity).some(a => a.state === 'running' && a.key === key && (a.toolUseId === n.id || drivers.has(n.id) && a.toolUseId === drivers.get(n.id)!.id)))
    if (!run) return next(e)
    const live = await read($, sideLive), now = await $.clock.now()
    const seconds = Math.max(0, Math.floor((now - (run.startedAt ?? now)) / 1000))
    const message = `${nameOf(run.provider ?? providerOf(run.model))} ${oneLine(live?.id === run.id && live.file ? live.file : run.label || run.input || run.kind)} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    return next({ ...e, props: { ...e.props, word: message, message, suffix: '' } })
  })
  on('prompt.autocomplete', { token: /^@/ }, async ($, e, next) => {
    const result = await next(e)
    if (!normalGuard(await read($, guard)).chat.mentions) return result
    return { suggestions: [...result.suggestions, ...mentionSuggestions(without(await read($, routing), missingOf(await read($, providers))), e.token)] }
  })
  on('prompt.mention', async ($, e, next) => {
    if (normalGuard(await read($, guard)).chat.mentions && Object.hasOwn(MENTIONS, e.mention.toLowerCase())) return { type: null }
    return next(e)
  })
  on('prompt.submit', {}, async ($, e, next) => {
    const own = e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk' || e.origin.kind === 'plugin' && e.origin.asUser
    let found = own && !e.command && !e.isMeta ? mentionsIn(e.text) : []
    if (found.length && !normalGuard(await read($, guard)).chat.mentions) found = []
    let text = e.text
    if (found.length) {
      const r = await read($, routing), ps = [...new Set(found.map(m => MENTIONS[m[2]!.toLowerCase() as keyof typeof MENTIONS]))]
      const off = ps.find(p => !enabled(r, p))
      if (off) $.ui.toast(`${nameOf(off)} is ${r.paused?.[off] ? 'paused' : 'off'}; prompt unchanged`)
      else {
        const task = e.text.replace(/(^|\s)@(codex|opencode|commandcode|cmd|antigravity|gemini)(?=$|\s|[,:;!?])/gi, '$1').replace(/^\s*[:,;]\s*/, '').trim()
        if (task) text = [
          'Delegate this task as explicitly requested by the owner:',
          ...ps.map(p => { const pick = mentionPick(r, p); return `Run ${nameOf(p)} with ${routingHow(r, p, pick.model, pick.effort)} in one complete run with the full task and context. Respect the current Work stage and provider task permissions. Wait for the result, check what comes back, and report back.` }),
          `Task:\n${task}`,
        ].join('\n\n')
      }
    }
    const before = own && !e.isMeta && !e.command ? await read($, chatSurface) : undefined
    const reset = before && (before.waiting !== undefined || before.vibeSince !== undefined)
    if (reset) await update($, chatSurface, s => ({ ...s, waiting: undefined, vibeSince: undefined }))
    const result = await next(text === e.text ? e : { ...e, text })
    if (before && result.drop !== undefined) await update($, chatSurface, s => ({ ...s, waiting: before.waiting, vibeSince: before.vibeSince }))
    return result
  })
  on('command.run', { command: COMMANDS.map(c => c.name) }, async ($, e) => {
    const arg = e.args.trim()
    if (e.command === 'handover') {
      if (arg === 'undo') return { text: await undoHandoff($) ? 'Hand-off undone.' : 'No hand-off to undo.' }
      if (arg) return { text: 'Use /handover or /handover undo.' }
      const p = await performHandoff($)
      return { text: p ? `${nameOf(p)} is Main. Undo for 30s in the strip or /handover undo.` : 'No hand-off available.' }
    }
    if (e.command === 'mode') {
      const target = ({ default: 'overview', work: 'work', vibe: 'vibe' } as const)[arg.toLowerCase() as 'default' | 'work' | 'vibe']
      if (!target) return { text: 'Use /mode default|work|vibe.' }
      if (((await read($, ui)).area ?? 'overview') === target) return { text: `${arg.toLowerCase()} is active.` }
      await update($, ui, u => ({ ...u, pendingArea: target }))
      await $.ui.open({ id: 'agent-overview', title: 'Agent panel', focus: true })
      return { text: `${arg.toLowerCase()} preview opened. ${await modeBusy($) ? 'Finish or stop this turn, then press Switch.' : 'Press Switch in the panel to apply it next turn.'}` }
    }
    if (e.command === 'preset') {
      if (!arg) return { text: ['Custom', ...(await seedPresets($, await read($, routing))).map(p => p.name)].join('\n') }
      return { text: await applyPreset($, arg) ? `Preset: ${(await read($, ui)).preset?.name ?? 'Custom'}.` : `Unknown preset: ${oneLine(arg)}. Use /preset to list.` }
    }
    if (e.command === 'guard') {
      if (!['warn', 'enforce', 'off'].includes(arg)) return { text: 'Use /guard warn|enforce|off.' }
      await saveGuard($, g => ({ ...g, routingGuard: arg as 'warn' | 'enforce' | 'off' }))
      return { text: `Routing guard: ${arg}.` }
    }
    if (e.command === 'usage') {
      await refreshUsage($, undefined, true).then(() => watchQuota($)).catch(() => {})
      return { text: usageLines(await read($, providers), await read($, routing)) }
    }
    return { text: (await read($, decisions)).slice(-5).map(d => `${oneLine(d.decision)}${d.why ? ` · ${oneLine(d.why)}` : ''}`).join('\n') || 'No decisions.' }
  })
  on('state.set', { plugin: 'agent-overview', key: 'nodes' }, async ($, e, next) => {
    if (!e.value.some(side)) return next(e)
    const before = e.previous ?? await read($, nodes), result = await next(e)
    if (!result.value?.isSet) return result
    if (!e.value.some(n => side(n) && before.find(b => b.id === n.id)?.state !== n.state)) return result
    const list = displayAgents(e.value, await read($, edits))
    for (const n of list.filter(side)) {
      const old = before.find(x => x.id === n.id)
      if (old?.state === 'running' && n.state !== 'running' && n.startedAt !== undefined && n.endedAt !== undefined && n.endedAt - n.startedAt > 120000) await alert($, 'run', `${nameOf(n.provider ?? providerOf(n.model))} ${n.state === 'failed' ? 'failed' : 'done'} · ${runDuration(n.endedAt - n.startedAt)} · ${n.label}`)
      if (old?.state !== n.state && (n.state === 'running' || old?.state === 'running')) await update($, chatSurface, s => ({ ...s, editVersion: s.editVersion + 1 }))
    }
    return result
  })
  on('state.set', { plugin: 'agent-overview', key: 'findings' }, async ($, e, next) => {
    const before = e.previous ?? await read($, findings), result = await next(e)
    if (result.value?.isSet) for (const f of e.value) if (f.severity === 'high' && !f.dismissed && !before.some(b => findingKey(b) === findingKey(f) && b.severity === 'high' && !b.dismissed)) await alert($, 'review', `High finding · ${f.file}${f.line ? `:${f.line}` : ''} · ${f.text}`)
    return result
  })
  on('state.set', { plugin: 'agent-overview', key: 'providers' }, async ($, e, next) => {
    const before = e.previous ?? await read($, providers), result = await next(e)
    if (result.value?.isSet) for (const { id, name } of PROVIDERS) {
      if (id === 'antigravity' && e.value[id].agyQuota) {
        const r = await read($, routing), line = agyQuotaLine({ ...r, agyQuota: e.value[id].agyQuota })
        if (line && line !== agyQuotaLine({ ...r, agyQuota: before[id].agyQuota })) await alert($, 'quota', `${name}: ${line}`)
      } else if (!exhausted(before[id]) && exhausted(e.value[id])) await alert($, 'quota', `${name} is out of quota`)
    }
    return result
  })
  on('state.set', { plugin: 'agent-overview', key: 'routing' }, async ($, e, next) => {
    const before = e.previous ?? await read($, routing), result = await next(e)
    if (result.value?.isSet) for (const { id, name } of PROVIDERS) if (!before.paused?.[id] && e.value.paused?.[id]) await alert($, 'quota', `${name} is paused`)
    return result
  })
  on('state.set', { plugin: 'agent-overview', key: 'ui' }, async ($, e, next) => {
    const before = e.previous ?? await read($, ui), result = await next(e)
    if (result.value?.isSet && before.area !== e.value.area) await update($, chatSurface, s => ({ ...s, waiting: undefined, vibeSince: undefined }))
    return result
  })
  on('turn.start', {}, async ($, e, next) => {
    if (!e.agentId) {
      const vibe = (await read($, ui)).area === 'vibe', now = await $.clock.now()
      await update($, chatSurface, s => ({ ...s, waiting: undefined, vibeSince: vibe ? s.vibeSince ?? now : undefined }))
    }
    return next(e)
  })
  on('turn.complete', {}, async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && e.reason === 'answer' && /\?\s*[*_`]*\s*$/.test(e.answer)) await askOwner($, `answer:${e.turnId}`, e.durationMs)
    return result
  })
  on('tool.call', {}, async ($, e, next) => {
    const call = e as unknown as { tool: string; tool_use_id: string; command?: string; agentId?: string }
    const test = call.tool === 'Bash' && /\b(?:test|jest|vitest|pytest|mocha)\b/.test(call.command ?? '') && (TEST_RE.test(call.command ?? '') || isTestCommand(literalWords(call.command ?? '') ?? []))
    const version = test ? (await read($, chatSurface)).editVersion : 0
    const testPlace = test ? await commandLocation($, call.command ?? '') : undefined
    const provable = testPlace && isTestCommand(testPlace.words)
    const beforeFiles = provable ? await testFiles($, testPlace.cwd) : undefined
    if (call.tool === 'AskUserQuestion' && !call.agentId && (await read($, ui)).area === 'vibe') await update($, chatSurface, s => ({ ...s, waiting: call.tool_use_id }))
    try {
      const result = await next(e)
      if (!result.deny) {
        if (test) {
          const at = await $.clock.now(), afterFiles = !result.isError && provable ? await testFiles($, testPlace.cwd) : undefined
          await update($, chatSurface, s => ({ ...s, test: { at, version, passed: !!provable && !result.isError, cwd: testPlace?.cwd, files: beforeFiles === afterFiles ? afterFiles : undefined } }))
        } else if (!result.isReadOnly) {
          const write = call.tool === 'Bash' && writesFiles(call.command ?? '')
          const words = write ? literalWords(call.command ?? '') : undefined
          const indexOnly = words?.[0] === 'git' && ['add', 'commit', 'push'].includes(words[words[1] === '-C' ? 3 : 1] ?? '')
          if (/^(?:Edit|Write|MultiEdit|NotebookEdit)$/.test(call.tool) || write && !indexOnly) await update($, chatSurface, s => ({ ...s, editVersion: s.editVersion + 1 }))
        }
      }
      return result
    } finally {
      if (call.tool === 'AskUserQuestion' && !call.agentId) await update($, chatSurface, s => s.waiting === call.tool_use_id ? { ...s, waiting: undefined } : s)
    }
  })
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    if (e.tool === 'AskUserQuestion' && !e.agentId && e.tool_use_id && result.decision !== 'deny') await askOwner($, e.tool_use_id)
    if (result.decision === 'ask' && e.tool_use_id && !result.decider && normalGuard(await read($, guard)).chat.permission) {
      const text = await permissionContext($, e.tool, e.input)
      if (text) $.ui.notice(e.tool_use_id, text)
    }
    return result
  })
}
