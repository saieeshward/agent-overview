import { atom, read } from 'claude-code'
import type { $, E } from '../ui'
import { babysitterRow, Chip, SettingsRow, modeControls, saveGuard } from '../ui'
import { normalGuard } from '../state'
import { SCENES } from './scenes'
import { stopPlayback } from './loop'
import { chatSettings } from '../chat-settings'

const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))

export async function vibeSettingsTab($: $, E: E, w: number, rows: number) {
  const shared = await babysitterRow($, E)
  const chat = await chatSettings($, E)
  E = await modeControls($, E, 'vibe')
  stopPlayback()
  const g = normalGuard(await read($, guard))
  return <E.Box key="vibe:settings" flexDirection="column" gap={1}>
    {shared}
    <E.Text weight="bold">Styles in use</E.Text>
    {(['office', 'arcade'] as const).map(style => SettingsRow(E, `vstyle:row:${style}`, SCENES[style].name, [false, true].map(on => {
      const enabled = g.vibe.styles.includes(style), last = !on && enabled && g.vibe.styles.length === 1
      return last ? <E.Text key={`vstyle:${style}:off`} dimColor>{Chip(E, 'Off', false)}</E.Text> : <E.Button key={`vstyle:${style}:${on ? 'on' : 'off'}`} plain onPress={() => saveGuard($, held => {
        const styles = on ? [...new Set([...held.vibe.styles, style])] : held.vibe.styles.length === 1 ? held.vibe.styles : held.vibe.styles.filter(s => s !== style)
        return { ...held, vibe: { ...held.vibe, styles } }
      })}>{Chip(E, on ? 'On' : 'Off', enabled === on)}</E.Button>
    })))}
    {SettingsRow(E, 'vibe:motion', 'Motion', (['full', 'calm', 'still'] as const).map(motion => <E.Button key={`vmotion:${motion}`} plain onPress={() => saveGuard($, held => ({ ...held, vibe: { ...held.vibe, motion } }))}>
      {Chip(E, motion[0]!.toUpperCase() + motion.slice(1), g.vibe.motion === motion)}
    </E.Button>))}
    {chat}
  </E.Box>
}
