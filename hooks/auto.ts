import type { EngineInterface } from 'claude-code'
import { savePolicy } from './policy'
import { saveRouting } from './ui'

// The owner wants Antigravity working in every project without pressing anything (2026-11-22). Once, its Visual and
// Coding jobs and the every-project allowlist entry ('/') are switched on; the store marker keeps it to once, so a
// later "off" in the panel sticks. Client work and confidential paths are still refused before the allowlist.
export const AUTO_AGY_KEY = 'auto:antigravity-on'
export async function autoAntigravity($: EngineInterface): Promise<boolean> {
  if (await $.store.get(AUTO_AGY_KEY).catch(() => undefined)) return false
  await saveRouting($, x => ({ ...x, agyVisual: true, agyCoding: true }))
  await savePolicy($, x => ({ ...x, allow: x.allow.includes('/') ? x.allow : ['/', ...x.allow] }))
  await $.store.set(AUTO_AGY_KEY, 1).catch(() => {})
  return true
}
