import { atom, read, update } from 'claude-code'
import type { Lane, Policy, Providers, RouteLogItem, TaskType, Ui } from '../types'
import { CLAUDE_MODELS, EFFORTS, GEMINI_MODELS, LANES, OLLAMA_DEFAULT, TASK_TYPES, defaultPolicy, laneName, savePolicy } from './policy'
import { allOf, blank, isEmbedder } from './state'
import { Card, Chip, Fold, SettingsRow, ago, fit, padR, shortModel, tok } from './ui'
import type { $, E } from './ui'

const policy = atom({ plugin: 'agent-overview', key: 'policy' } as const, defaultPolicy())
const routeLog = atom({ plugin: 'agent-overview', key: 'routeLog' } as const, [] as RouteLogItem[])
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {
  claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(), ollama: blank(),
} as Providers)
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)

const LANE_COLOR: Record<Lane, string> = { claude: 'claude', ollama: '#C026D3', gemini: '#4285F4' }
const OUTCOME_COLOR: Record<RouteLogItem['outcome'], string> = { running: 'suggestion', done: 'success', failed: 'error', denied: 'error', warned: 'warning', escalated: 'warning' }

function modelsFor(lane: Lane, all: Providers, current: string) {
  const list = lane === 'claude'
    ? [...CLAUDE_MODELS, ...all.claude.models.map(m => m.id).filter(id => /^claude-/.test(id))]
    : lane === 'gemini' ? GEMINI_MODELS
      : [OLLAMA_DEFAULT, ...(all.ollama?.models ?? []).map(m => m.id).filter(m => !isEmbedder(m))]
  return [...new Set([current, ...list].filter(Boolean))]
}

export async function taskRoutingCard($: $, E: E, w: number) {
  const p = await read($, policy)
  const all = await read($, providers).then(allOf)
  const typeW = 16
  const set = (t: TaskType, change: (x: Policy['table'][TaskType]) => Policy['table'][TaskType]) => savePolicy($, x => ({ ...x, table: { ...x.table, [t]: change(x.table[t]) } }))
  const row = (t: TaskType) => {
    const x = p.table[t]
    return <E.Box key={`task:${t}`} flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
      <E.Box width={typeW} flexShrink={0}><E.Text weight="bold" wrap="truncate-end">{t}</E.Text></E.Box>
      <E.Select key={`task:lane:${t}`} options={LANES.map(value => ({ value, label: laneName(value) }))} value={x.lane}
        onSelect={(lane: Lane) => set(t, y => lane === y.lane ? y : { lane, model: modelsFor(lane, all, '')[0]!, ...(lane === 'claude' ? { effort: 'medium' } : {}) })} />
      <E.Select key={`task:model:${t}`} options={modelsFor(x.lane, all, x.model).map(value => ({ value, label: shortModel(value) }))} value={x.model}
        onSelect={(model: string) => set(t, y => ({ ...y, model }))} />
      {x.lane === 'claude'
        ? <E.Select key={`task:effort:${t}`} options={EFFORTS.map(value => ({ value }))} value={x.effort ?? 'medium'} onSelect={(effort: string) => set(t, y => ({ ...y, effort }))} />
        : <E.Text dimColor>{x.lane === 'ollama' ? 'ollama_run · → Haiku' : 'gemini_run · → Sonnet'}</E.Text>}
    </E.Box>
  }
  return Card(E, 'card:tasks', 'TASK ROUTING', 'planMode', <E.Box flexDirection="column" gap={E.desk ? 1 : 0}>
    {SettingsRow(E, 'tasks:declare', 'Declarations', (['warn', 'block', 'off'] as const).map(mode =>
      <E.Button key={`tasks:declare:${mode}`} plain onPress={() => savePolicy($, x => ({ ...x, declare: mode }))}>{Chip(E, mode[0]!.toUpperCase() + mode.slice(1), p.declare === mode)}</E.Button>))}
    <E.Text dimColor wrap="wrap">{fit('Every Agent spawn starts its description "task:<type> sensitivity:<client|internal|public>". Warn flags a missing one, Block refuses it.', Math.max(40, w * 3))}</E.Text>
    {TASK_TYPES.map(row)}
  </E.Box>, { aside: <E.Button key="tasks:reset" plain onPress={() => savePolicy($, x => ({ ...x, table: defaultPolicy().table }))}><E.Text dimColor>reset to eval defaults</E.Text></E.Button> })
}

export async function routeLogCard($: $, E: E, w: number, now: number) {
  const list = (await read($, routeLog)).slice(-50).reverse()
  const folded = (await read($, ui)).folded ?? {}
  const modelW = Math.max(10, Math.min(22, w - 60))
  return Fold($, E, folded, 'routelog', 'ROUTING LOG', 'subtle', () => <E.Box flexDirection="column">
    {list.length ? list.map(x => <E.Box key={`rl:${x.id}:${x.at}`} flexDirection="column">
      <E.Text wrap="truncate-end">
        <E.Text color={OUTCOME_COLOR[x.outcome]}>{padR(x.outcome, 9)}</E.Text>
        <E.Text dimColor>{padR(ago(now - x.at), 4)} </E.Text>
        <E.Text weight="bold">{padR(x.type ?? (x.declared === 'ok' ? '' : `(${x.declared})`), 15)}</E.Text>
        <E.Text dimColor>{padR(x.sensitivity ?? '—', 9)}</E.Text>
        <E.Text color={LANE_COLOR[x.lane]}>{padR(`${laneName(x.lane)} ${shortModel(x.model || '—')}`, modelW + 7)}</E.Text>
        <E.Text dimColor>{padR(x.effort ?? '', 7)}{x.tokens !== undefined ? ` ${tok(x.tokens)} tok` : ''}{x.ms !== undefined ? ` ${Math.round(x.ms / 1000)}s` : ''}</E.Text>
      </E.Text>
      {x.note && x.outcome !== 'done' ? <E.Text dimColor wrap="truncate-end">{'   ↳ '}{x.note}</E.Text> : null}
    </E.Box>) : <E.Text dimColor>no routed tasks yet</E.Text>}
  </E.Box>, { aside: <E.Text dimColor>last {list.length} of 50</E.Text> })
}
