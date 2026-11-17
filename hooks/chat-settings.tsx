import { atom, read } from 'claude-code'
import type { AlertKind, ChatSettings } from '../types'
import { normalGuard } from './state'
import { Chip, SettingsRow, saveGuard } from './ui'
import type { $, E } from './ui'

const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
export const ALERT_ROWS: [AlertKind, string][] = [
  ['run', 'Run finished'], ['review', 'High finding'], ['quota', 'Quota or pause'], ['question', 'Vibe question'],
]

export async function chatSettings($: $, E: E) {
  const held = normalGuard(await read($, guard)), g = held.chat
  const toggle = (key: string, value: boolean, change: (g: ChatSettings, on: boolean) => ChatSettings) => [false, true].map(on =>
    <E.Button key={`chat:${key}:${on}`} plain onPress={() => saveGuard($, held => ({ ...held, chat: change(held.chat, on) }))}>
      {Chip(E, on ? 'On' : 'Off', value === on)}
    </E.Button>)
  return <E.Box key="chat:settings" flexDirection="column" gap={1}>
    <E.Text weight="bold">Prompt and alerts</E.Text>
    {SettingsRow(E, 'chat:row:office', 'Office rail', (['off', 'slim', 'glass', 'heads', 'dock', 'peek', 'line', 'ticker'] as const).map(office =>
      <E.Button key={`chat:office:${office}`} plain onPress={() => saveGuard($, held => ({ ...held, chat: { ...held.chat, office } }))}>
        {Chip(E, { off: 'Off', slim: 'Slim', glass: 'Glass', heads: 'Heads', dock: 'Dock', peek: 'Peek', line: 'Line', ticker: 'Ticker' }[office], g.office === office)}
      </E.Button>))}
    {SettingsRow(E, 'chat:row:look', 'Message look', [false, true].map(on =>
      <E.Button key={`chat:look:${on}`} plain onPress={async () => { await saveGuard($, x => ({ ...x, chatLook: on })); $.ui.invalidate('ui.render') }}>
        {Chip(E, on ? 'On' : 'Off', held.chatLook === on)}
      </E.Button>))}
    {SettingsRow(E, 'chat:row:theme', 'Chat theme', (['mode', 'overview', 'work', 'vibe'] as const).map(theme =>
      <E.Button key={`chat:theme:${theme}`} plain onPress={async () => { await saveGuard($, x => ({ ...x, chat: { ...x.chat, theme } })); $.ui.invalidate('ui.render') }}>
        {Chip(E, { mode: 'Mode', overview: 'Default', work: 'Work', vibe: 'Vibe' }[theme], g.theme === theme)}
      </E.Button>))}
    {SettingsRow(E, 'chat:row:divider', 'Vibe divider', (['chase', 'boat'] as const).map(style =>
      <E.Button key={`chat:divider:${style}`} plain onPress={() => saveGuard($, x => ({ ...x, chat: { ...x.chat, vibeDivider: style } }))}>
        {Chip(E, style === 'chase' ? 'Chase' : 'Boat', g.vibeDivider === style)}
      </E.Button>))}
    {([
      ['railPreset', 'Preset on rail'], ['hint', 'Context hint'], ['stripRuns', 'Run strip'], ['stripDone', 'Finished runs'], ['stripQuota', 'Quota hand-off'],
      ['spinner', 'Provider spinner'], ['mentions', 'Provider mentions'], ['permission', 'Permission context'], ['sounds', 'Sounds'],
    ] as [Exclude<keyof ChatSettings, 'events' | 'office' | 'vibeDivider' | 'theme'>, string][]).map(([key, name]) => SettingsRow(E, `chat:row:${key}`, name,
      toggle(key, g[key], (held, on) => ({ ...held, [key]: on }))))}
    {ALERT_ROWS.map(([kind, name]) => SettingsRow(E, `chat:event:${kind}`, name, <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      <E.Text dimColor>Notify</E.Text>
      {toggle(`${kind}:notify`, g.events[kind].notify, (held, on) => ({ ...held, events: { ...held.events, [kind]: { ...held.events[kind], notify: on } } }))}
      <E.Text dimColor>Sound</E.Text>
      {toggle(`${kind}:sound`, g.events[kind].sound, (held, on) => ({ ...held, events: { ...held.events, [kind]: { ...held.events[kind], sound: on } } }))}
    </E.Box>))}
  </E.Box>
}
