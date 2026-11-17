import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Preset, Routing, Ui } from '../types'
import { BUILT_IN, normalRouting } from './state'

const presets = atom({ plugin: 'agent-overview', key: 'presets' } as const, [] as Preset[])
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)

export async function savedPresets($: EngineInterface): Promise<Preset[]> {
  const stored = await $.store.get('presets').catch(() => undefined)
  return Array.isArray(stored) ? stored as Preset[] : await read($, presets)
}

export async function storePresets($: EngineInterface, next: Preset[]) {
  await update($, presets, () => next)
  await $.store.set('presets', next).catch(() => {})
  return next
}

// Quota pauses belong to the chat, not to its preset's on/off preferences.
export function presetSnapshot(r: Routing, saved?: Routing): Routing {
  const { agyQuota, ...choices } = r
  return normalRouting({ ...choices, on: { ...r.on, ...Object.fromEntries(Object.keys(r.paused ?? {}).map(p => [p, saved?.on?.[p as keyof Routing['on']] ?? true])) }, paused: {} })
}

export function presetRouting(saved: Routing, current: Routing): Routing {
  const r = normalRouting(saved)
  return { ...r, agyQuota: current.agyQuota, paused: current.paused, on: { ...r.on, ...Object.fromEntries(Object.keys(current.paused ?? {}).map(p => [p, false])) } }
}

export async function seedPresets($: EngineInterface, r: Routing) {
  const saved = await savedPresets($)
  // Seed both before editing any preset so an unvisited built-in keeps the original model list.
  const next = [...saved.map(p => BUILT_IN.some(b => b.name === p.name) ? { ...p, builtIn: true } : p),
    ...BUILT_IN.filter(b => !saved.some(p => p.name === b.name)).map(b => ({ name: b.name, builtIn: true, routing: presetSnapshot(b.apply(r)) }))]
  return storePresets($, next)
}

export async function activePreset($: EngineInterface, name?: string) {
  await update($, ui, x => ({ ...x, preset: name ? { name } : undefined, saving: false, confirm: undefined, vibeUndo: undefined }))
  const id = await $.session.id().catch(() => '')
  if (id) await $.store.set(`preset:${id}`, name ?? null).catch(() => {})
}

export async function restorePresets($: EngineInterface) {
  const saved = await savedPresets($)
  await update($, presets, () => saved)
  const id = await $.session.id().catch(() => '')
  const name = id ? await $.store.get(`preset:${id}`).catch(() => undefined) : undefined
  await activePreset($, typeof name === 'string' && saved.some(p => p.name === name) ? name : undefined)
}

export async function savePresetRouting($: EngineInterface, r: Routing) {
  const name = (await read($, ui)).preset?.name
  if (!name) return
  const saved = await savedPresets($)
  // A preset deleted by another chat stays deleted.
  if (!saved.some(p => p.name === name)) { await activePreset($); return }
  await storePresets($, saved.map(p => p.name === name ? { ...p, routing: presetSnapshot(r, p.routing) } : p))
}
