import { atom, read, update } from 'claude-code'
import type { Ui, VibeTab } from '../../types'
import { Chip } from '../ui'
import type { $, E } from '../ui'
import { crewTab } from './crew'
import { powerupsTab } from './powerups'
import { liveTab } from './live'
import { decisionsTab } from './decisions'
import { vibeSettingsTab } from './settings'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)

const TABS: [VibeTab, string][] = [['live', 'Live'], ['crew', 'Crew'], ['powerups', 'Powers'], ['decisions', 'Decisions'], ['settings', 'Settings']]

export async function vibeView($: $, E: E, w: number, rows: number) {
  const u = await read($, ui)
  const tab = u.vibeTab ?? 'live'
  return <E.Box flexDirection="column" gap={1}>
    <E.Box flexDirection="row" flexWrap="wrap" gap={E.desk ? 1 : 0}>
      {TABS.map(([id, label]) => <E.Button key={`vtab:${id}`} plain onPress={() => update($, ui, u => ({ ...u, vibeTab: id }))}>{Chip(E, label, id === tab)}</E.Button>)}
    </E.Box>
    {tab === 'crew' ? await crewTab($, E, w) : tab === 'powerups' ? await powerupsTab($, E, w) : tab === 'decisions' ? await decisionsTab($, E, w, rows) : tab === 'settings' ? await vibeSettingsTab($, E, w, rows) : await liveTab($, E, w, rows)}
  </E.Box>
}
