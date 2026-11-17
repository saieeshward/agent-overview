import { atom, read, update } from 'claude-code'
import { saveStage } from '../modes'
import type { Finding, Impl, Mode, Ui } from '../../types'
import { normalGuard } from '../state'
import { babysitterRow, Card, Chip, SettingsRow, modeControls, saveGuard } from '../ui'
import type { $, E } from '../ui'
import { freshStage } from './stage'
import { chatSettings } from '../chat-settings'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const toggles = atom({ plugin: 'agent-overview', key: 'toggles' } as const, {} as Record<string, Mode>)
const findings = atom({ plugin: 'agent-overview', key: 'findings' } as const, [] as Finding[])
const impl = atom({ plugin: 'agent-overview', key: 'impl' } as const, { agents: [] } as Impl)

export async function syncWorkSkills($: $) {
  const u = await read($, ui), g = await read($, guard), t = await read($, toggles)
  let changed = false
  for (const [setting, key, previous] of [
    ['ponytail', 'plugin:ponytail', 'ponytailWas'],
    ['grill', 'skill:supermatt:grilling', 'grillingWas'],
  ] as const) {
    if (u.area === 'work') {
      if (u[previous] === undefined) await update($, ui, x => ({ ...x, [previous]: t[key] ?? null }))
      const mode: Mode = g.work[setting] ? 'on' : 'off'
      if (t[key] !== mode) {
        await update($, toggles, x => ({ ...x, [key]: mode }))
        changed = true
      }
    } else if (u[previous] !== undefined) {
      await update($, toggles, x => {
        const next = { ...x }
        if (u[previous] === null) delete next[key]
        else next[key] = u[previous]!
        return next
      })
      await update($, ui, x => ({ ...x, [previous]: undefined }))
      changed = true
    }
  }
  if (changed) {
    $.ui.invalidate('prompt.attachment')
    $.ui.invalidate('tool.describe')
    $.ui.invalidate('prompt.section')
  }
}

export async function workSettingsTab($: $, E: E, w: number, rows: number) {
  const shared = await babysitterRow($, E)
  const chat = await chatSettings($, E)
  E = await modeControls($, E, 'work')
  const g = await read($, guard), u = await read($, ui)
  const setting = (id: 'ponytail' | 'grill', name: string) => SettingsRow(E, `wsetting:${id}`, name, [false, true].map(on => <E.Button key={`wset:${id}:${on ? 'on' : 'off'}`} plain onPress={async () => {
    await saveGuard($, x => ({ ...x, work: { ...x.work, [id]: on } }))
    await syncWorkSkills($)
  }}>{Chip(E, on ? 'On' : 'Off', g.work[id] === on)}</E.Button>))
  return Card(E, 'work:settings', 'WORK SETTINGS', 'claude', <E.Box flexDirection="column" gap={1}>
    {shared}
    {setting('ponytail', 'Ponytail')}
    {setting('grill', 'Grill with docs')}
    {u.confirm === 'wset:reset' ? <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      <E.Text color="warning">Reset stages and clear review findings?</E.Text>
      <E.Button key="wset:reset:yes" plain onPress={async () => {
        await newTask($)
      }}>{Chip(E, 'Reset', true, 'error')}</E.Button>
      <E.Button key="wset:reset:no" plain onPress={() => update($, ui, x => ({ ...x, confirm: undefined }))}>{Chip(E, 'Cancel', false)}</E.Button>
    </E.Box> : <E.Button key="wset:reset" plain onPress={() => update($, ui, x => ({ ...x, confirm: 'wset:reset' }))}><E.Text color="warning">Reset stages</E.Text></E.Button>}
    {chat}
  </E.Box>)
}

export async function newTask($: $) {
  const now = await $.clock.now()
  await saveStage($, () => freshStage(now))
  await update($, findings, () => [])
  await update($, impl, () => ({ agents: [] }))
  await update($, ui, x => ({ ...x, workTab: 'plan' as const, findSel: undefined, confirm: undefined, profileEdit: false, reviewNote: undefined, reviewDraft: undefined }))
}
