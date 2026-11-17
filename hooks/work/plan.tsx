import { atom, read, update } from 'claude-code'
import { saveStage } from '../modes'
import type { GrillItem, MainInfo, Providers, Stage, Ui } from '../../types'
import { blank, normalGuard } from '../state'
import { Card, Chip, LEVELS, modeControls, shortModel } from '../ui'
import type { $, E } from '../ui'
import { saveQa } from '../view'
import { seeStage, advance, planCounts, taskQa } from './stage'

const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const grill = atom({ plugin: 'agent-overview', key: 'grill' } as const, [] as GrillItem[])
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {
  claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(),
} as Providers)

export async function planTab($: $, E: E, w: number, rows: number) {
  const Action = await modeControls($, E, 'work')
  const s = await read($, stage), retained = await read($, grill), qa = taskQa(retained, s), m = await read($, main)
  const earlier = retained.filter(q => !qa.includes(q))
  const live = !s || s.at === 'plan', counts = planCounts(qa), u = await read($, ui)
  const showEarlier = u.folded?.['plan:earlier'] === false
  const models = (await read($, providers)).claude.models
  const chat = m.model.replace(/\[.*\]$/, '')
  const options = models.map(x => ({ value: x.id, label: shortModel(x.id) }))
  if (chat && !options.some(x => x.value === chat)) options.push({ value: chat, label: shortModel(chat) })
  const efforts = models.find(x => x.id === chat)?.efforts ?? LEVELS
  let question = 0
  return Card(E, 'work:plan', 'PLAN', 'claude', <E.Box flexDirection="column" gap={1}>
    {!live ? <E.Text dimColor>read-only · the work is at {s.at.toUpperCase()}</E.Text> : null}
    {qa.length ? <E.Text>{counts.answers} answered · {counts.open} open</E.Text> : null}
    {live ? <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      {options.length ? <E.Select key="plan:model" label="model " options={options} value={chat} onSelect={async (v: string) => {
        const current = await read($, main)
        const args = v + (/\[.*\]$/.exec(current.model)?.[0] ?? '')
        await $.command.run({ command: 'model', args })
        await update($, main, x => ({ ...x, model: args }))
      }} /> : <E.Text dimColor>model {shortModel(chat) || 'not loaded yet'}</E.Text>}
      {efforts.length ? <E.Select key="plan:effort" label="effort " options={efforts.map(v => ({ value: v, label: v }))} value={m.effort} onSelect={async (v: string) => {
        await $.command.run({ command: 'effort', args: v })
        await update($, main, x => ({ ...x, effort: v }))
      }} /> : <E.Text dimColor>effort {m.effort ?? 'default'}</E.Text>}
    </E.Box> : <E.Text dimColor>{shortModel(chat) || 'main chat'} · {m.effort ?? 'default'}</E.Text>}
    {qa.length ? qa.map((q, i) => {
      const instruction = q.kind === 'instruction', open = planCounts([q]).open > 0
      const color = instruction ? 'planMode' : 'suggestion'
      return Card(E, `plan:q:${i}`, `${instruction ? 'Instruction' : `Q${++question}`} · ${q.question}`, open ? 'warning' : color, <E.Box flexDirection="column">
        <E.Text color={open ? 'warning' : undefined}>{q.answer || 'awaiting an answer'}</E.Text>
      </E.Box>)
    }) : <E.Text dimColor>no answers</E.Text>}
    {earlier.length ? <E.Box flexDirection="column" gap={1}>
      <E.Button key="plan:earlier" plain onPress={() => update($, ui, x => ({ ...x, folded: { ...x.folded, 'plan:earlier': showEarlier } }))}>{showEarlier ? '▾' : '▸'} Earlier Q&A ({earlier.length})</E.Button>
      {showEarlier ? earlier.map((q, i) => Card(E, `plan:earlier:${i}`, q.question, 'subtle', <E.Text>{q.answer || 'awaiting an answer'}</E.Text>)) : null}
      {showEarlier && live && !m.working ? <Action.Button key="plan:include-earlier" plain onPress={async () => {
        if ((await read($, main)).working) return
        await saveStage($, x => x?.at === 'plan' ? { ...x, qaSince: 0 } : x)
      }}>Use in this task</Action.Button> : null}
    </E.Box> : null}
    {live && m.working ? <E.Text dimColor>Advance after this turn</E.Text> : live ? <Action.Button key="plan:advance" plain onPress={async () => {
      if ((await read($, main)).working) return
      const current = await read($, stage), qa = taskQa(await read($, grill), current)
      if (current && current.at !== 'plan') return
      if (planCounts(qa).open && (await read($, ui)).confirm !== 'plan:advance') {
        await update($, ui, x => ({ ...x, confirm: 'plan:advance' }))
        return
      }
      const head = await $.process.run(['git', 'rev-parse', 'HEAD'], { timeoutMs: 5000 }).then(r => r.exitCode === 0 ? r.stdout.trim() || undefined : undefined, () => undefined)
      if ((await read($, guard)).work.grill && qa.some(q => !q.documented && q.answer.trim()) && !await saveQa($, current?.qaSince ?? current?.startedAt)) return
      await saveStage($, x => seeStage(advance(x, 'implement', { since: head }), 'implement'))
      await update($, ui, x => ({ ...x, workTab: 'implement' as const, confirm: undefined }))
      $.ui.invalidate('prompt.section')
    }}>{Chip(Action, counts.open && u.confirm === 'plan:advance' ? `Advance with ${counts.open} open? ▸` : 'Advance to Implement ▸', true)}</Action.Button> : null}
    {live && u.confirm === 'plan:advance' ? <Action.Button key="plan:cancel" plain onPress={() => update($, ui, x => ({ ...x, confirm: undefined }))}><E.Text dimColor>Cancel</E.Text></Action.Button> : null}
  </E.Box>)
}
