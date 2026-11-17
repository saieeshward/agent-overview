import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Routing, Ui, VibeEvent, VibeLog } from '../../types'
import { PROVIDERS, nameOf, tagOf } from '../state'
import { CODEX_IMAGES } from '../ui'

export const REACTION_MS = 6000
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const vibe = atom({ plugin: 'agent-overview', key: 'vibe' } as const, { acts: [], combo: 0, commits: 0, pushes: 0, best: 0, phase: '' } as VibeLog)
export async function emitVibe($: EngineInterface, event: Omit<VibeEvent, 'at'>) {
  if ((await read($, ui)).area !== 'vibe') return
  const at = await $.clock.now()
  await update($, vibe, v => ({ ...v, events: [...(v.events ?? []), { ...event, at }].slice(-30) }))
}
export async function routingEvents($: EngineInterface, before: Routing, after: Routing, event?: Omit<VibeEvent, 'at'>) {
  if (event) return emitVibe($, event)
  for (const { id: p } of PROVIDERS) {
    if (before.on[p] !== after.on[p]) await emitVibe($, { kind: after.on[p] ? 'provider-on' : 'provider-off', provider: p })
    if (tagOf(before, p) !== tagOf(after, p)) await emitVibe($, { kind: 'tag', provider: p, tag: tagOf(after, p) })
  }
  if (JSON.stringify([before.order, before.picks]) !== JSON.stringify([after.order, after.picks])) await emitVibe($, { kind: 'priority' })
}
export const activeEvents = (events: VibeEvent[], now: number) => events.filter(e => e.at <= now && now - e.at < REACTION_MS)

export function eventLabel(e: VibeEvent): string {
  const who = nameOf(e.provider ?? 'claude')
  if (e.kind === 'handoff' || e.kind === 'tag' && e.tag === 'main') return `${who} is main`
  if (e.kind === 'tag') return e.tag === 'saver' ? `${who} on saver` : `${who} back to normal`
  if (e.kind === 'provider-off') return `${who} off`
  if (e.kind === 'provider-on') return `${who} on`
  if (e.kind === 'priority') return 'Order changed'
  if (e.kind === 'decision') return 'New decision'
  const key = e.key ?? 'Power-up', name = key === 'feature:codex-images' ? CODEX_IMAGES : key.split(':').at(-1)!.replace(/^mcp__.+?__/, '').replace(/_/g, ' ').replace(/\bqa\b/i, 'QA')
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${e.mode === 'force' ? 'forced' : e.mode ?? 'on'}`
}
