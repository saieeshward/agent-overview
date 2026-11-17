import { atom, read } from 'claude-code'
import type { Costs, Prices, Provider, Providers, Stage, StageId } from '../../types'
import { rowCost, sessionRows } from '../cost'
import { blank, defaultRouting } from '../state'
import { colorOf, graphicWidth, heat, leftOf, money, nameOf } from '../ui'
import type { $, E } from '../ui'

const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {
  claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(),
} as Providers)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const costs = atom({ plugin: 'agent-overview', key: 'costs' } as const, { rows: [], claude: {}, agy: {} } as Costs)
const prices = atom({ plugin: 'agent-overview', key: 'prices' } as const, { catalog: {}, overrides: {} } as Prices)
const STAGES: StageId[] = ['plan', 'implement', 'review', 'ship']
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function sessionCost(c: Costs, pr: Prices) {
  const record = (rows: Costs['claude'], provider: Provider) => Object.entries(rows).reduce((total, [model, t]) => total + (rowCost({ ...t, provider, model, period: 'session' }, pr) ?? 0), 0)
  return Math.max(record(c.claude, 'claude'), c.engineUsd ?? 0)
    + (c.base ? sessionRows(c.rows, c.base).reduce((total, r) => total + (r.credits ? 0 : rowCost(r, pr) ?? 0), 0) : 0)
    + record(c.agy, 'antigravity')
}

function railSvg(s: Stage, width: number) {
  const step = width / 4, current = STAGES.indexOf(s.at)
  let body = ''
  STAGES.forEach((id, i) => {
    const cx = step * (i + .5), done = s.reached.includes(id) && id !== s.at, active = id === s.at
    if (i) body += `<line x1="${cx - step + 12}" y1="12" x2="${cx - 12}" y2="12" stroke="${i <= current ? '#10A37F' : '#8b949e'}" stroke-width="2"/>`
    const color = active ? '#D97757' : done ? '#10A37F' : '#8b949e'
    body += `<g>${active ? `<circle cx="${cx}" cy="12" r="9" fill="#D97757" opacity=".15"><animate attributeName="r" values="9;14;9" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".15;.04;.15" dur="2s" repeatCount="indefinite"/></circle>` : ''}<circle cx="${cx}" cy="12" r="5" fill="${active || done ? color : 'none'}" stroke="${color}"/><text x="${cx}" y="39" text-anchor="middle" fill="${color}">${done ? '✓ ' : ''}${id.toUpperCase()}</text></g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48"><style>text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:bold}.on{fill:#24292f}.future{fill:#656d76}@media(prefers-color-scheme:dark){.on{fill:#e6e6e6}.future{fill:#8b949e}}</style>${body}</svg>`
}

function usageSvg(all: Providers, providers: Provider[], width: number) {
  const step = width / Math.max(1, providers.length), font = Math.min(13, step / 7.2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="76" viewBox="0 0 ${width} 76"><style>text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:${font}px;fill:#aaa}</style>${providers.map((p, i) => {
    const info = all[p], meters = info.meters.filter(m => m.label !== 'Context'), left = info.alert ? 0 : meters.length ? Math.max(0, Math.min(100, 100 - Math.max(...meters.map(m => m.percent)))) : undefined
    const x = i * step + 4, bar = step - 12, color = { claude: '#D97757', codex: '#10A37F', opencode: '#a78bfa', commandcode: '#F59E0B', antigravity: '#4285F4' }[p]
    const label = info.alert ? 'quota hit' : left === undefined ? 'no quota data' : `${p === 'opencode' && info.usageSource !== 'live' ? '≈' : ''}${Math.round(left)}% left`
    const name = p === 'commandcode' && step < 100 ? `Command<tspan x="${x}" dy="13">Code</tspan>` : esc(nameOf(p))
    return `<text x="${x}" y="13" style="fill:${color}">${name}</text><rect x="${x}" y="32" width="${bar}" height="12" rx="3" fill="#555"/>${left === undefined ? '' : `<rect x="${x}" y="32" width="${bar * left / 100}" height="12" rx="3" fill="${color}"/>`}<text x="${x}" y="65">${esc(label)}</text>`
  }).join('')}</svg>`
}

export async function workHeader($: $, E: E, w: number) {
  const [s, all, r, c, pr] = await Promise.all([read($, stage), read($, providers), read($, routing), read($, costs), read($, prices)])
  const now = await $.clock.now()
  const ctx = all.claude.meters.find(m => m.label === 'Context')
  const enabled = (['claude', ...r.order] as Provider[]).filter(p => all[p].status !== 'missing' && (p === 'claude' || r.on[p]))
  const railWidth = E.desk ? graphicWidth(E) : w
  const rail = !s ? <E.Text dimColor>no stage yet</E.Text> : E.desk
    ? <E.Svg source={railSvg(s, railWidth)} width={railWidth} height={48} alt={`Stage: ${s.at.toUpperCase()} (round ${s.round})`} />
    : <E.Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
      {STAGES.map((id, i) => {
        const current = id === s.at, reached = s.reached.includes(id), color = current ? 'claude' : reached ? 'success' : 'inactive'
        return <E.Box key={`stage:${id}`} flexDirection="row" alignItems="center">
          {i ? <E.Text color={s.reached.includes(STAGES[i - 1]!) && reached ? 'success' : undefined} dimColor={!reached}>{w < 56 ? reached ? ' ━ ' : ' ─ ' : reached ? '━━▸' : '───'}</E.Text> : null}
          <E.Text color={color} weight={current ? 'bold' : undefined} dimColor={!reached}>{current ? '● ' : reached ? '✓ ' : '○ '}{id.toUpperCase()}</E.Text>
        </E.Box>
      })}
    </E.Box>
  return <E.Box key="work:header" flexDirection="column" gap={1}>
    {rail}
    {s && s.round > 1 ? <E.Box flexDirection="row" columnGap={2} alignItems="center">
      {s.round > 1 ? <E.Text color="warning">↺ round {s.round}</E.Text> : null}
    </E.Box> : null}
    {E.desk ? <E.Svg source={usageSvg(all, enabled, railWidth)} width={railWidth} height={76} alt={`Usage: ${enabled.map(nameOf).join(', ')}`} /> : <E.Box key="work:usage" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {enabled.map(p => <E.Text key={`work:usage:${p}`}>
        <E.Text color={colorOf(p)} weight="bold">{nameOf(p)} </E.Text>{leftOf(E, all[p], p, 5, now)}
      </E.Text>)}
    </E.Box>}
    <E.Box flexDirection="row" justifyContent="flex-end" gap={2} width="100%">
      <E.Text weight="bold">{money(sessionCost(c, pr))} session</E.Text>
      {ctx ? <E.Text color={heat(ctx.percent)}>ctx {Math.round(ctx.percent)}%</E.Text> : null}
    </E.Box>
  </E.Box>
}
