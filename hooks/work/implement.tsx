import { atom, read, update } from 'claude-code'
import { saveStage } from '../modes'
import type { Act, AgentNode, EditItem, GrillItem, Impl, MainInfo, Stage, TurnCost, Ui } from '../../types'
import { displayAgents } from '../babysitter'
import { agyModelNotice, defaultRouting, normalGuard } from '../state'
import { Card, Chip, Rule, clock, colorOf, fit, fitStart, modeControls, money, nameOf, plural, shortModel, tok, submitPrompt } from '../ui'
import type { $, E } from '../ui'
import { seeStage, advance, adrOf, agentBlock, implAgents, implementPrompt, runBusy, taskQa, workCaps } from './stage'
import { relativeFile, repoRoot } from './git'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const impl = atom({ plugin: 'agent-overview', key: 'impl' } as const, { agents: [] } as Impl)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const grill = atom({ plugin: 'agent-overview', key: 'grill' } as const, [] as GrillItem[])
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
const acts = atom({ plugin: 'agent-overview', key: 'acts' } as const, {} as Record<string, Act>)
const turnCosts = atom({ plugin: 'agent-overview', key: 'turnCosts' } as const, [] as TurnCost[])
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)


export async function implementTab($: $, E: E, w: number, rows: number) {
  E = await modeControls($, E, 'work')
  const s = await read($, stage), held = await read($, impl), ed = await read($, edits)
  const r = await read($, routing), over = await workCaps($), g = await read($, guard)
  const live = s?.at === 'implement', agents = implAgents(r, held, over)
  const excluded = r.picks.flatMap(p => {
    const why = agentBlock(r, p.provider, over) ?? (p.provider === 'claude' && r.role === 'plan' ? 'Plans only' : undefined)
    return why ? [{ ...p, why }] : []
  })
  const selected = agents.filter(a => a.on), now = await $.clock.now()
  const since = held.launchedAt
  const busy = runBusy(since, await read($, main), await read($, nodes)), root = await repoRoot($)
  const running = since === undefined ? [] : displayAgents(await read($, nodes), ed).filter(n => n.kind !== 'workflow' && (n.startedAt ?? -1) >= since)
  const files = new Map<string, { added: number; removed: number; provider?: EditItem['provider'] }>()
  if (since !== undefined) for (const e of ed.filter(e => (e.at ?? -1) >= since)) {
    const f = files.get(e.file) ?? { added: 0, removed: 0, provider: e.provider }
    files.set(e.file, { added: f.added + (e.added ?? 0), removed: f.removed + (e.removed ?? 0), provider: e.provider ?? f.provider })
  }
  const commands = since === undefined ? [] : Object.values(await read($, acts)).filter(a => a.tool === 'Bash' && a.at >= since).sort((a, b) => b.at - a.at).slice(0, 8)
  const costs = since === undefined ? [] : (await read($, turnCosts)).filter(t => t.at >= since)
  const tokens = costs.reduce((n, t) => n + t.tokens, 0)
  const change = async (edit: (list: Impl['agents']) => Impl['agents']) => {
    await update($, impl, x => ({ ...x, agents: edit(agents.map(a => ({ ...a }))) }))
  }
  const move = (i: number, by: number) => change(list => {
    const to = i + by
    if (to >= 0 && to < list.length) [list[i], list[to]] = [list[to]!, list[i]!]
    return list
  })
  const active = running.filter(n => n.state === 'running').length
  const toReview = live && since !== undefined && !busy ? <E.Button key="impl:review" plain onPress={async () => {
    await saveStage($, x => seeStage(advance(x, 'review'), 'review'))
    await update($, ui, x => ({ ...x, workTab: 'review' as const }))
  }}>{Chip(E, 'Advance to Review ▸', true)}</E.Button> : null
  const mark = (state: string) => state === 'done' ? '✓' : state === 'failed' ? '✗' : '●'
  return Card(E, 'work:implement', 'IMPLEMENT', 'claude', <E.Box flexDirection="column" gap={1}>
    {!live ? <E.Text dimColor>read-only · the work is at {(s?.at ?? 'plan').toUpperCase()}</E.Text> : null}
    <E.Box flexDirection="column" gap={1}>
      {agents.length ? agents.map((a, i) => <E.Box key={`impl:agent:${i}`} flexDirection="column">
        <E.Box flexDirection="row" alignItems="center" gap={1}>
          {live ? <E.Button key={`impl:on:${i}`} plain onPress={() => change(list => list.map((x, n) => n === i ? { ...x, on: !x.on } : x))}><E.Text color={a.on ? 'success' : 'inactive'}>{a.on ? '✓' : '○'}</E.Text></E.Button> : <E.Text dimColor>{a.on ? '✓' : '○'}</E.Text>}
          <E.Text dimColor>{i + 1}</E.Text>
          <E.Box flexGrow={1} flexShrink={1} minWidth={8}><E.Text color={colorOf(a.provider)} wrap="truncate-end">{fit(shortModel(a.model), w - 25)}</E.Text></E.Box>
          {live ? <E.Box flexDirection="row" gap={1}>
          <E.Button key={`impl:up:${i}`} plain onPress={() => move(i, -1)}><E.Text dimColor={i === 0}>↑</E.Text></E.Button>
          <E.Button key={`impl:down:${i}`} plain onPress={() => move(i, 1)}><E.Text dimColor={i === agents.length - 1}>↓</E.Text></E.Button>
          </E.Box> : null}
        </E.Box>
        <E.Text dimColor>{nameOf(a.provider)} · {a.effort ?? 'default'}</E.Text>
        {a.provider === 'antigravity' && agyModelNotice(r, g, 'coding', a.model) ? <E.Text color="warning">{agyModelNotice(r, g, 'coding', a.model)}</E.Text> : null}
      </E.Box>) : <E.Text dimColor>no models</E.Text>}
    </E.Box>
    {excluded.map(a => <E.Box key={`impl:excluded:${a.provider}/${a.model}`}><E.Text dimColor>{shortModel(a.model)} · {nameOf(a.provider)} · {a.why}</E.Text></E.Box>)}
    {live && busy ? <E.Text dimColor>{active ? `Running · ${plural(active, 'agent')}` : 'Running'}</E.Text> : live && (since === undefined || (s?.round ?? 1) === 1) ? <E.Button key="impl:launch" plain onPress={async () => {
      if (runBusy((await read($, impl)).launchedAt, await read($, main), await read($, nodes))) return
      const selected = implAgents(await read($, routing), { agents }, await workCaps($)).filter(a => a.on)
      if (!selected.length) return
      const at = await $.clock.now()
      if (!await submitPrompt($, implementPrompt(selected, adrOf(s, ed), taskQa(await read($, grill), s)))) return
      await update($, impl, x => ({ ...x, agents, launchedAt: at }))
    }}>{selected.length ? Chip(E, since === undefined ? 'Launch ▸' : 'Relaunch', since === undefined) : <E.Text dimColor>Launch ▸ · select an agent</E.Text>}</E.Button> : null}
    {since === undefined ? <E.Text dimColor>not launched</E.Text> : <E.Box flexDirection="column" gap={1}>
      {Rule(E, 'AGENTS', w - 6)}
      {running.length ? running.map(n => <E.Box key={`impl:run:${n.id}`} flexDirection="column">
        <E.Box flexDirection="row" gap={1} alignItems="center">
          <E.Text color={n.state === 'failed' ? 'error' : n.state === 'done' ? 'success' : 'warning'}>{mark(n.state)}</E.Text>
          <E.Box flexGrow={1} flexShrink={1}><E.Text color={colorOf(n.provider ?? 'claude')}>{shortModel(n.model)}</E.Text></E.Box>
          <E.Text dimColor>{plural(n.steps, 'step')} · {clock((n.endedAt ?? now) - (n.startedAt ?? now))}</E.Text>
        </E.Box>
        <E.Text dimColor>{n.label}</E.Text>
      </E.Box>) : <E.Text dimColor>no agents</E.Text>}
      {toReview}
      {Rule(E, 'FILES CHANGED', w - 6)}
      {[...files].length ? [...files].map(([file, f]) => <E.Box key={`impl:file:${file}`} flexDirection="row" gap={1}>
        <E.Box width={Math.max(12, w - 30)}><E.Text color={f.provider ? colorOf(f.provider) : undefined}>{fitStart(relativeFile(file, root), Math.max(12, w - 30))}</E.Text></E.Box>
        <E.Text color="success">+{f.added}</E.Text><E.Text color="error">−{f.removed}</E.Text>
      </E.Box>) : <E.Text dimColor>no file changes</E.Text>}
      {Rule(E, 'COMMANDS', w - 6)}
      {commands.length ? commands.map(a => <E.Text key={`impl:cmd:${a.key}`}><E.Text color={a.state === 'failed' ? 'error' : a.state === 'done' ? 'success' : 'warning'}>{mark(a.state)} </E.Text>{fit(a.title, w - 9)}</E.Text>) : <E.Text dimColor>no commands</E.Text>}
      {tokens > 0 ? <E.Text dimColor>{tok(tokens)} tokens · {money(costs.reduce((n, t) => n + (t.usd ?? 0), 0))}</E.Text> : null}
    </E.Box>}

  </E.Box>)
}
