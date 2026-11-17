import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { AgentNode, Area, Look, MainInfo, Stage, Ui } from '../types'
import { providerOf } from './state'
import { stateOf } from './graph'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const look = atom({ plugin: 'agent-overview', key: 'look' } as const, { area: 'overview', turns: [] } as Look)
export async function modeBusy($: EngineInterface) {
  const m = await read($, main), list = await read($, nodes)
  return !!m.working || list.some(n => n.kind !== 'workflow' && (n.provider ?? providerOf(n.model)) === 'claude'
    && stateOf(n, list) === 'running' && (m.since === undefined || n.startedAt === undefined || n.startedAt >= m.since))
}
async function modeKey($: EngineInterface) { return `mode:${await $.session.id()}` }
export async function restoreMode($: EngineInterface) {
  const id = await $.session.id(), u = await read($, ui)
  const saved = await $.store.get(`mode:${id}`).catch(() => undefined) as { area?: Area; stage?: Stage | null } | undefined
  if (saved && ['overview', 'work', 'vibe'].includes(saved.area ?? '')) {
    await update($, stage, () => saved.stage && ['plan', 'implement', 'review', 'ship'].includes(saved.stage.at) && Array.isArray(saved.stage.reached) ? saved.stage : null)
    await update($, ui, x => ({ ...x, area: saved.area, modeSession: id, pendingArea: undefined }))
  } else if (u.modeSession && u.modeSession !== id) {
    await update($, stage, () => null)
    await update($, ui, x => ({ ...x, area: 'overview' as const, modeSession: id, pendingArea: undefined }))
  } else await update($, ui, x => ({ ...x, modeSession: id }))
  await storeMode($)
}
// Every mode change passes here, so the chat look's copy of the area follows it.
export async function storeMode($: EngineInterface) {
  const area = (await read($, ui)).area ?? 'overview'
  await $.store.set(await modeKey($), { area, stage: await read($, stage) }).catch(() => {})
  if ((await read($, look)).area !== area) await update($, look, l => ({ ...l, area }))
}
export async function saveStage($: EngineInterface, change: (s: Stage | null) => Stage | null) {
  const next = await update($, stage, change)
  await storeMode($)
  $.ui.invalidate('prompt.section')
  return next
}
