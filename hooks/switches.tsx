import type { Mode } from '../types'
import type { $, E } from './ui'
import { Chip, displayName } from './ui'
import { setToggle, toggleMode } from './toggles'

const COLORS: Record<Mode, string> = { off: 'inactive', on: 'success', force: 'warning' }
export function triState($: $, E: E, key: string, cur: Mode, id = key, inherited = false) {
  return <E.Box flexDirection="row" gap={1}>{(['off', 'on', 'force'] as Mode[]).map(mode =>
    <E.Button key={`mode:${id}:${mode}`} plain dimColor={inherited && mode === cur} onPress={() => setToggle($, key, mode)}>
      {inherited && mode === cur ? <E.Text dimColor>↳{mode === 'off' ? 'Off' : mode === 'on' ? 'On' : 'Force'} </E.Text> : Chip(E, mode === 'off' ? 'Off' : mode === 'on' ? 'On' : 'Force', mode === cur && !inherited, inherited ? 'subtle' : COLORS[mode])}
    </E.Button>
  )}</E.Box>
}

export function skillRow($: $, E: E, key: string, t: Record<string, Mode>, id = key, after?: any, narrow = false) {
  const mode = toggleMode(t, key)
  return <E.Box key={`skill:${id}`} flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" marginLeft={after ? 4 : 2} flexWrap={narrow ? undefined : 'wrap'} gap={narrow ? 0 : 1}>
    <E.Text dimColor={mode === 'off'} wrap="truncate-end">{displayName(key.split(':').slice(2).join(':'))}{t[key] === undefined ? <E.Text dimColor> · same as plugin</E.Text> : null}</E.Text>
    <E.Box flexDirection="row" gap={after ? 2 : 1} flexShrink={0}>
      <E.Box width={after ? E.desk ? 22 : 18 : undefined} flexShrink={0}>{triState($, E, key, mode, id, t[key] === undefined)}</E.Box>
      {after ? <E.Box width={14} flexShrink={0}>{after}</E.Box> : null}
    </E.Box>
  </E.Box>
}
