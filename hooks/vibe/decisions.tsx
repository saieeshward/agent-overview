import { atom, read, update } from 'claude-code'
import type { DecisionItem, Ui } from '../../types'
import { ago, Chip, fit, IMPACT } from '../ui'
import type { $, E } from '../ui'
import { stopPlayback } from './loop'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const decisions = atom({ plugin: 'agent-overview', key: 'decisions' } as const, [] as DecisionItem[])

export async function restoreDecisions($: $) {
  const session = await $.session.id(), sameSession = (await read($, ui)).modeSession === session
  const saved = await $.store.get(`decisions:${session}`).catch(() => undefined)
  await update($, decisions, list => Array.isArray(saved) ? saved.filter(d => d && typeof d.decision === 'string' && typeof d.why === 'string' && Number.isFinite(d.at) && ['low', 'medium', 'high'].includes(d.impact)).slice(-300) as DecisionItem[] : sameSession ? list : [])
}

export async function decisionsTab($: $, E: E, w: number, rows: number) {
  stopPlayback()
  const [u, items, now] = await Promise.all([read($, ui), read($, decisions), $.clock.now()])
  const filter = u.vibeFilter ?? 'all'
  const shown = [...items].sort((a, b) => b.at - a.at).filter(d => filter === 'all' || d.impact === filter)
  const older = u.folded?.['vibe:older'] === false, visible = older ? shown : shown.slice(0, 20)
  const impact = items.some(d => d.impact === 'high') ? 'high' : items.some(d => d.impact === 'medium') ? 'medium' : 'low'
  return <E.Box key="vibe:decisions" flexDirection="column" gap={1}>
    {items.length ? <E.Box flexDirection="row" flexWrap="wrap" gap={1}>{(['all', 'high', 'medium', 'low'] as const).map(f => <E.Button key={`vfilter:${f}`} plain onPress={() => update($, ui, u => ({ ...u, vibeFilter: f }))}>
      {Chip(E, `${f} ${f === 'all' ? items.length : items.filter(d => d.impact === f).length}`, f === filter, f === 'all' ? 'claude' : IMPACT[f].color)}
    </E.Button>)}</E.Box> : null}
    {!items.length ? <E.Text dimColor>no decisions</E.Text> : <E.Box flexDirection="column" borderStyle="round" borderColor={IMPACT[impact].color} paddingX={1}>
    {!shown.length ? <E.Text dimColor>no {filter} decisions</E.Text> : visible.map(d => {
      const key = `${d.at}:${items.indexOf(d)}`, open = u.vibeExpanded?.includes(key), color = IMPACT[d.impact].color
      return <E.Box key={`vdec:${key}`} flexDirection="column">
        <E.Box flexDirection="row" gap={E.desk ? 1 : 0} alignItems="center">
          <E.Box width={E.desk ? 4 : 3} flexShrink={0}><E.Button key={`vdec:open:${key}`} plain onPress={() => update($, ui, x => ({ ...x, vibeExpanded: open ? (x.vibeExpanded ?? []).filter(k => k !== key) : [...(x.vibeExpanded ?? []), key] }))}>{open ? '▾' : '▸'}</E.Button></E.Box>
          <E.Box flexGrow={1} flexShrink={1}><E.Text wrap="truncate-end"><E.Text color={color} weight="bold">{IMPACT[d.impact].mark} </E.Text>{fit(d.decision, Math.max(8, w - 15))}</E.Text></E.Box>
          <E.Box width={5} flexShrink={0} alignItems="flex-end"><E.Text dimColor>{ago(now - d.at)}</E.Text></E.Box>
        </E.Box>
        {open ? <E.Box paddingLeft={E.desk ? 6 : 5}><E.Text dimColor>{d.why}</E.Text></E.Box> : null}
      </E.Box>
    })}</E.Box>}
    {shown.length > 20 ? <E.Button key="vdec:older" plain onPress={() => update($, ui, x => ({ ...x, folded: { ...x.folded, 'vibe:older': older } }))}>{older ? 'Show recent' : `Older decisions (${shown.length - 20})`}</E.Button> : null}
  </E.Box>
}
