import { atom, read, update } from 'claude-code'
import type { HookCheck } from '../types'
import { Card } from './ui'
import type { $, E } from './ui'

// Which of this mod's hooks actually run in this session. A plugin above (Claude Code's own
// cc-plugin-sec-default) can continue past a hook, so a hook that is registered may never run.
const hookcheck = atom({ plugin: 'agent-overview', key: 'hookcheck' } as const, { session: '', ran: {}, bypassed: {} } as HookCheck)

// The hooks the panel's features stand on, and what stops working when one is bypassed.
export const TRACKED: { event: string; feature: string }[] = [
  { event: 'session.start', feature: 'tools, commands and timers' },
  { event: 'prompt.submit', feature: 'routing delivered with your prompts' },
  { event: 'prompt.compose', feature: 'routing in the system prompt (prompt.submit delivers it instead)' },
  { event: 'prompt.attachment', feature: 'OFF hiding skills and tools from the listing (calls are still refused)' },
  { event: 'skill.prompt', feature: 'OFF for a slash-typed skill, and skill use counts (Skill tool calls are still refused)' },
  { event: 'tool.describe', feature: 'OFF and FORCE notes in tool descriptions' },
  { event: 'tool.call', feature: 'OFF refusals, side-run tracking, ollama_run and gemini_run' },
  { event: 'agent.spawn', feature: 'task routing and the routing guard' },
  { event: 'command.run', feature: 'slash commands' },
  { event: 'turn.start', feature: 'turn tracking' },
  { event: 'turn.step', feature: 'live edits and the chat model' },
  { event: 'turn.complete', feature: 'subagent results and costs' },
  { event: 'ui.render', feature: 'the panel and chat look' },
  { event: 'classic.SessionStart', feature: "a plugin's OFF switch stripping its start-up text" },
  { event: 'classic.SubagentStart', feature: "a plugin's OFF switch stripping its text from subagents" },
]

// When a hook should have run by now: if its occasion came and it never ran, it was bypassed.
const OCCASION: Record<string, (ran: Record<string, number>) => boolean> = {
  'prompt.compose': ran => !!ran['turn.step:main'],
  'prompt.attachment': ran => (ran['turn.complete:main'] ?? 0) >= 2,
  'skill.prompt': ran => !!ran['tool.call:Skill'],
  'classic.SessionStart': ran => !!ran['session.start'] && !!ran['turn.start:main'],
  'classic.SubagentStart': ran => !!ran['turn.start:agent'],
}

export type HookState = { event: string; feature: string; status: 'live' | 'bypassed' | 'unseen'; by?: string }

export function hookStatus(c: HookCheck): HookState[] {
  return TRACKED.map(({ event, feature }) => {
    const by = c.bypassed[event]
    if (c.ran[event]) return { event, feature, status: 'live' as const }
    if (by) return { event, feature, status: 'bypassed' as const, by }
    if (OCCASION[event]?.(c.ran)) return { event, feature, status: 'bypassed' as const, by: 'a plugin above (never ran when due)' }
    return { event, feature, status: 'unseen' as const }
  })
}

export const hookSummary = (c: HookCheck) => {
  const all = hookStatus(c)
  const live = all.filter(x => x.status === "live").length
  return { live, total: all.length, bypassed: all.filter(x => x.status === 'bypassed'), unseen: all.filter(x => x.status === 'unseen') }
}

export const isBypassed = (c: HookCheck, event: string) => hookStatus(c).find(x => x.event === event)?.status === 'bypassed'

// Debug log lines: "agent-overview: prompt.compose bypassed by cc-plugin-sec-default (tier user); beneath runs".
export function parseBypass(log: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of log.matchAll(/agent-overview: ([\w.]+) bypassed by ([\w@.:-]+)/g)) out[m[1]!] = m[2]!
  return out
}

// Marking is in memory only: a hook must not wait on the engine just to say it ran.
// The record reaches state from session.start and a slow timer, never from inside a hook.
const ran = new Map<string, number>()
let session = ''
export function mark(...events: string[]) {
  for (const ev of events) ran.set(ev, Math.min(99, (ran.get(ev) ?? 0) + 1))
}
export const markCount = mark
const merged = (c: HookCheck): HookCheck => {
  const all = { ...c.ran }
  for (const [ev, n] of ran) all[ev] = Math.max(all[ev] ?? 0, n)
  return { ...c, ran: all }
}
export async function flushCheck($: $) {
  const c = await read($, hookcheck)
  const next = merged(c)
  if (JSON.stringify(next.ran) !== JSON.stringify(c.ran)) await update($, hookcheck, x => merged(x)).catch(() => {})
}

// At session start: a new session starts a fresh record, and the debug log (when the session writes one) names bypasses.
export async function startCheck($: $) {
  const id = await $.session.id().catch(() => '')
  if (id !== session) ran.clear()
  session = id
  mark('session.start')
  await update($, hookcheck, c => merged(c.session === id ? c : { session: id, ran: {}, bypassed: {} }))
  void readDebugLog($)
}

export async function readDebugLog($: $) {
  const session = await $.session.id().catch(() => '')
  if (!session) return
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${(await $.env.get('HOME').catch(() => undefined)) ?? ''}/.claude`
  const file = `${dir}/debug/${session}.txt`
  if (!(await $.fs.exists(file).catch(() => false))) return
  const r = await $.process.run(['/usr/bin/grep', '-o', '-m', '400', '-E', 'agent-overview: [a-zA-Z.]+ bypassed by [^ ]+', file], { timeoutMs: 4000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) return
  const found = parseBypass(r.stdout)
  if (!Object.keys(found).length) return
  await update($, hookcheck, c => ({ ...c, bypassed: { ...c.bypassed, ...found } }))
}

export async function hooksCard($: $, E: E) {
  mark('ui.render')
  const c = merged(await read($, hookcheck))
  const s = hookSummary(c)
  return Card(E, 'card:settings:hooks', 'HOOKS', s.bypassed.length ? 'warning' : 'subtle', <E.Box flexDirection="column">
    <E.Text weight="bold">Hooks: {s.live} of {s.total} live{s.unseen.length ? <E.Text dimColor> · {s.unseen.length} not due yet</E.Text> : null}</E.Text>
    {s.bypassed.map(x => <E.Box key={`hook:${x.event}`} flexDirection="column">
      <E.Text color="warning" wrap="truncate-end">✗ {x.event} <E.Text dimColor>bypassed by {x.by}</E.Text></E.Text>
      <E.Text dimColor wrap="wrap">{'   '}not working: {x.feature}</E.Text>
    </E.Box>)}
    {s.unseen.length ? <E.Text dimColor wrap="wrap">not due yet: {s.unseen.map(x => x.event).join(', ')}</E.Text> : null}
  </E.Box>, { aside: <E.Text dimColor>this session</E.Text> })
}

// A line for the switches: what OFF still does when the hooks that hide things are bypassed.
const LOST: Record<string, string> = {
  'prompt.attachment': 'hide skills and tools from the listing',
  'skill.prompt': 'stop a slash-typed skill',
  'classic.SessionStart': "strip a plugin's start-up text",
}
export async function switchNote($: $) {
  const c = merged(await read($, hookcheck))
  const gone = Object.keys(LOST).filter(ev => isBypassed(c, ev))
  if (!gone.length) return ''
  return `OFF still refuses calls, but cannot ${gone.map(ev => LOST[ev]).join(', or ')} (${gone.join(', ')} bypassed by a plugin above).`
}
