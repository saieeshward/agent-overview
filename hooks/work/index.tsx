import { atom, read, update } from 'claude-code'
import { saveStage, storeMode } from '../modes'
import type { Area, Stage, Ui, WorkTab } from '../../types'
import { Chip } from '../ui'
import type { $, E } from '../ui'
import { freshStage, seeStage } from './stage'
import { workHeader } from './rail'
import { sourceTab } from './source'
import { planTab } from './plan'
import { implementTab } from './implement'
import { reviewTab } from './review'
import { syncWorkSkills, workSettingsTab } from './settings'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)

const TABS: [WorkTab, string][] = [['source', 'Source'], ['plan', 'Plan'], ['implement', 'Implement'], ['review', 'Review'], ['settings', 'Settings']]

export async function onAreaChange($: $, from: Area, to: Area) {
  if (from !== to && to === 'work') {
    const now = await $.clock.now()
    const s = await saveStage($, s => s ?? freshStage(now))
    await update($, ui, u => ({ ...u, workTab: s?.at === 'ship' ? 'review' : s?.at ?? 'plan' }))
  }
  if (from !== to && (from === 'work' || to === 'work')) {
    await syncWorkSkills($)
    $.ui.invalidate('prompt.section')
  }
  if (from !== to) { await storeMode($); $.ui.invalidate('tool.describe') }
}

export async function workView($: $, E: E, w: number, rows: number) {
  const u = await read($, ui)
  const s = await read($, stage)
  const preview = u.area !== 'work'
  const tabs = TABS.filter(([id]) => preview || (id !== 'implement' && id !== 'review') || s?.reached.includes(id))
  const tab = tabs.some(([id]) => id === u.workTab) ? u.workTab! : s?.at === 'ship' ? 'review' : s?.at ?? 'plan'
  const body = tab === 'plan' ? await planTab($, E, w, rows)
    : tab === 'implement' ? await implementTab($, E, w, rows)
      : tab === 'review' ? await reviewTab($, E, w, rows)
        : tab === 'settings' ? await workSettingsTab($, E, w, rows)
          : await sourceTab($, E, w, rows)
  return <E.Box flexDirection="column" gap={1}>
    <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      {tabs.map(([id, label]) => {
        const unread = !preview && (id === 'implement' || id === 'review') && !s?.seen?.includes(id)
        return <E.Button key={`wtab:${id}`} plain onPress={async () => {
        if ((await read($, ui)).area === 'work' && (id === 'implement' || id === 'review')) await saveStage($, s => s ? seeStage(s, id) : s)
        await update($, ui, u => ({ ...u, workTab: id }))
      }}>{Chip(E, (id === 'review' && s?.at === 'ship' ? 'Ship' : label) + (id !== tab && unread ? ' ◆' : ''), id === tab || unread, id !== tab ? 'warning' : 'claude')}</E.Button>
      })}
    </E.Box>
    {await workHeader($, E, w)}
    {body}
  </E.Box>
}
