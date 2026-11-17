import { atom, read, update } from 'claude-code'
import type { Installed, Mode, Ui } from '../../types'
import { Chip, saveGuard, CODEX_IMAGES, pinLabel, plural } from '../ui'
import type { $, E } from '../ui'
import { normalGuard } from '../state'
import { emitVibe } from './events'
import { C, canvas, rect, toCells, toSvg } from './engine'
import { toggleMode } from '../toggles'
import { skillRow, triState } from '../switches'
import { stopPlayback } from './loop'

const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const installed = atom({ plugin: 'agent-overview', key: 'installed' } as const, { plugins: [], mcpServers: [], skills: 0 } as Installed)
const toggles = atom({ plugin: 'agent-overview', key: 'toggles' } as const, {} as Record<string, Mode>)
const pins = atom({ plugin: 'agent-overview', key: 'pins' } as const, [] as string[])
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
export function powerups(inst: Installed, pins: string[]) {
  const enabled = (key: string) => {
    const plugin = /^(?:plugin|skill):([^:]+)/.exec(key)?.[1]
    const server = /^server:(.+)$/.exec(key)?.[1] ?? /^tool:mcp__(.+?)__/.exec(key)?.[1]
    return !(plugin && inst.plugins.some(p => p.where === 'claude' && p.name === plugin && p.enabled === false))
      && !(server && (server === 'agent-overview' || /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(server)))
  }
  return [...new Set(['feature:codex-images', ...pins.filter(enabled).map(key => key.startsWith('skill:') ? `plugin:${key.split(':')[1]}` : key)])]
}
export const powerLabel = (key: string) => key === 'feature:codex-images' ? CODEX_IMAGES : pinLabel(key)
export async function powerupsTab($: $, E: E, w: number) {
  stopPlayback()
  const [inst, t, ps, g, u] = await Promise.all([read($, installed), read($, toggles), read($, pins), read($, guard), read($, ui)])
  const items = powerups(inst, ps)
  const cols = E.desk ? w >= 110 ? 3 : w >= 76 ? 2 : 1 : w >= 140 ? 3 : w >= 90 ? 2 : 1
  const controls = (key: string) => {
    if (key !== 'feature:codex-images') return triState($, E, key, toggleMode(t, key))
    const mode = g.codexImages
    const color = mode === 'force' ? 'warning' : mode === 'on' ? 'success' : 'inactive'
    return <E.Box flexDirection="row" gap={1}>{(['off', 'on', 'force'] as Mode[]).map(value => <E.Button key={`power:${value}:${key}`} plain onPress={async () => {
      await saveGuard($, x => ({ ...x, codexImages: value }))
      $.ui.invalidate('prompt.section')
      await emitVibe($, { kind: 'powerup', key, mode: value })
    }}>{Chip(E, value === 'off' ? 'Off' : value === 'on' ? 'On' : 'Force', mode === value, color)}</E.Button>)}</E.Box>
  }
  return <E.Box key="vibe:powerups" flexDirection="row" flexWrap="wrap" gap={1}>
    {!items.length ? <E.Text dimColor>no power-ups</E.Text> : items.map(key => {
      const children = key.startsWith('plugin:') ? [...new Set([
        ...(inst.plugins.find(p => p.where === 'claude' && p.name === key.slice(7))?.skills ?? []),
        ...ps.filter(k => k.startsWith(`skill:${key.slice(7)}:`)).map(k => k.split(':').slice(2).join(':')),
      ])] : []
      const tools = key.startsWith('server:') ? (inst.tools ?? []).filter(t => t.startsWith(`mcp__${key.slice(7)}__`)).length : 0
      const fold = `power:${key}:children`, open = u.folded?.[fold] === false
      const mode = key === 'feature:codex-images' ? g.codexImages : toggleMode(t, key), color = mode === 'force' ? 'warning' : mode === 'on' ? 'success' : 'inactive'
      const c = canvas(28, 22, C.PAPER), tint = mode === 'force' ? C.gold : mode === 'on' ? C.codex : C.darkGrey
      rect(c, 2, 1, 24, 19, tint); rect(c, 5, 3, 18, 12, C.wall)
      rect(c, 7, 0, 14, 3, C.lightGrey); rect(c, 21, 4, 2, 2, mode === 'off' ? C.darkGrey : C.lime)
      for (let x = 6; x < 24; x += 3) rect(c, x, 17, 2, 4, mode === 'force' ? C.cream : C.gold)
      const mini = canvas(14, 12, C.PAPER)
      for (let y = 0; y < 12; y++) for (let x = 0; x < 14; x++) mini.px[y * 14 + x] = c.px[Math.min(21, Math.floor(y * 22 / 12)) * 28 + x * 2]!
      const source = toSvg([c], { fps: 1 }).replace('</svg>', mode === 'force' && g.vibe.motion !== 'still' ? '<rect x="1" y="1" width="26" height="19" fill="none" stroke="#E7BD58" stroke-width="1"><animate attributeName="opacity" values="1;.2;1" dur="1.8s" repeatCount="indefinite"/></rect></svg>' : '</svg>')
      return <E.Box key={`power:${key}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} paddingY={E.desk && w >= 60 ? 1 : 0} gap={1} width={Math.floor((w - cols + 1) / cols)}>
        <E.Box flexDirection="row" gap={1} alignItems="center">
          {E.desk ? <E.Svg key={`power:cartridge:${key}`} source={source} width={120} height={94} alt={`${mode} cartridge`} /> : <E.Raster key={`power:cartridge:${key}`} {...toCells(mini, 14)} />}
          <E.Box flexDirection="column" flexShrink={0} minWidth={16} width={Math.max(16, Math.floor((w - cols + 1) / cols) - 20)}>
            <E.Text color={color} weight="bold" wrap="truncate-end">{powerLabel(key)}</E.Text>
            <E.Text dimColor wrap="truncate-end">{key.startsWith('skill:') ? `${key.split(':')[1]} · skill` : key.startsWith('tool:') ? `${/^tool:mcp__(.+?)__/.exec(key)?.[1] ?? ''} · tool` : key.split(':')[0]}</E.Text>
          </E.Box>
        </E.Box>
        {controls(key)}
        {children.length ? <E.Button key={`power:fold:${key}`} plain onPress={() => update($, ui, x => ({ ...x, folded: { ...x.folded, [fold]: open } }))}>{open ? '▾' : '▸'} {plural(children.length, 'skill')}</E.Button> : tools ? <E.Text dimColor>{plural(tools, 'tool')}</E.Text> : null}
        {open ? children.map(child => skillRow($, E, `skill:${key.slice(7)}:${child}`, t, undefined, undefined, true)) : null}
      </E.Box>
    })}
  </E.Box>
}
