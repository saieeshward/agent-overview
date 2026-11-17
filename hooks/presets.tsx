import { atom, read, update } from 'claude-code'
import type { Ui } from '../types'
import { BUILT_IN, defaultRouting } from './state'
import { activePreset, presetRouting, presetSnapshot, savedPresets, seedPresets, storePresets } from './preset-state'
import { Card, Chip, saveRouting } from './ui'
import type { $, E } from './ui'

const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)

export async function applyPreset($: $, name: string, reset = false) {
  const latest = await seedPresets($, await read($, routing))
  const p = latest.find(p => p.name === name) ?? latest.find(p => p.name.toLowerCase() === name.toLowerCase())
  if (!p && name.toLowerCase() === 'custom') { await activePreset($); return true }
  if (!p) return false
  const builtin = BUILT_IN.find(b => b.name === p.name)
  const next = reset && builtin ? { ...p, routing: presetSnapshot(builtin.apply(defaultRouting())) } : p
  if (next !== p) await storePresets($, latest.map(q => q.name === p.name ? next : q))
  // Switching must not write the incoming routing into the outgoing preset.
  await saveRouting($, r => presetRouting(next.routing, r), undefined, false)
  await activePreset($, p.name)
  return true
}

export async function presetsCard($: $, E: E) {
  const [saved, u] = await Promise.all([savedPresets($), read($, ui)])
  const current = saved.some(p => p.name === u.preset?.name) ? u.preset?.name : undefined
  const apply = (name: string, reset = false) => applyPreset($, name, reset)
  const store = async (value: string) => {
    const name = value.trim().slice(0, 24)
    if (!name) { await update($, ui, x => ({ ...x, saving: false })); return }
    const latest = await seedPresets($, await read($, routing))
    if (latest.some(p => p.name === name)) { $.ui.toast('Name in use'); return }
    await storePresets($, [...latest, { name, routing: presetSnapshot(await read($, routing)) }])
    await activePreset($, name)
  }
  return Card(E, 'card:presets', 'PRESETS', 'suggestion', <E.Box flexDirection="column">
    <E.Box flexDirection="row" gap={1} flexWrap="wrap">
      <E.Button key="preset:custom" plain onPress={() => activePreset($)}>{Chip(E, 'Custom', !current, 'suggestion')}</E.Button>
      {BUILT_IN.map(b => <E.Box key={`ps:${b.name}`} flexDirection="row" gap={1}>
        <E.Button key={`preset:${b.name}`} plain onPress={() => apply(b.name)}>{Chip(E, b.name, current === b.name, 'suggestion')}</E.Button>
        {current === b.name ? <E.Button key={`preset:reset:${b.name}`} plain onPress={() => apply(b.name, true)}><E.Text dimColor>reset</E.Text></E.Button> : null}
      </E.Box>)}
      {saved.filter(p => !BUILT_IN.some(b => b.name === p.name)).map(p => <E.Box key={`ps:${p.name}`} flexDirection="row" gap={1}>
        <E.Button key={`preset:saved:${p.name}`} plain onPress={() => apply(p.name)}>{Chip(E, p.name, current === p.name, 'claude')}</E.Button>
        {u.confirm === `preset:${p.name}` ? <E.Box flexDirection="row" gap={1}>
          <E.Text color="error">delete?</E.Text>
          <E.Button key={`preset:del:yes:${p.name}`} plain onPress={async () => {
            await storePresets($, (await savedPresets($)).filter(q => q.name !== p.name))
            if ((await read($, ui)).preset?.name === p.name) await activePreset($)
            else await update($, ui, x => ({ ...x, confirm: undefined }))
          }}><E.Text color="error" weight="bold">yes</E.Text></E.Button>
          <E.Button key={`preset:del:no:${p.name}`} plain onPress={() => update($, ui, x => ({ ...x, confirm: undefined }))}><E.Text dimColor>no</E.Text></E.Button>
        </E.Box> : <E.Button key={`preset:del:${p.name}`} plain onPress={() => update($, ui, x => ({ ...x, confirm: `preset:${p.name}` }))}><E.Text color="error">✕</E.Text></E.Button>}
      </E.Box>)}
      <E.Button key="preset:save" plain onPress={() => update($, ui, x => ({ ...x, saving: !x.saving }))}><E.Text color="suggestion">+ save current</E.Text></E.Button>
    </E.Box>
    {u.saving ? <E.Input key="preset:name" placeholder="name this setup" submitLabel="save" onSubmit={store} /> : null}
  </E.Box>)
}
