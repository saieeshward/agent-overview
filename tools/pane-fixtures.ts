import { speedKey } from '../hooks/speed'
import { displayHistory } from '../hooks/babysitter'
import type { Area, Motion, Provider, Providers, StageId, Tab, Ui, VibeEvent, VibeStyle, VibeTab, WorkTab } from '../types'
import { BUILT_IN, blank, defaultRouting, normalGuard, withPicks } from '../hooks/state'
import { freshStage } from '../hooks/work/stage'
import { FIXTURES } from '../hooks/vibe/fixtures'

export const NOW = FIXTURES.busy.now
export type OfficeFixture = 'day' | 'sunset' | 'night' | 'idle' | 'kanban-plan' | 'kanban-build' | 'kanban-review' | 'kanban-ship' | 'notes' | 'sign' | 'outbox' | 'done' | 'cups' | 'prints' | 'server' | 'clock' | 'fail' | 'pass' | 'push' | 'delegation' | 'cat-failure' | 'settled' | 'crowded'
export const OFFICE_FIXTURES: OfficeFixture[] = ['day', 'sunset', 'night', 'idle', 'kanban-plan', 'kanban-build', 'kanban-review', 'kanban-ship', 'notes', 'sign', 'outbox', 'done', 'cups', 'prints', 'server', 'clock', 'fail', 'pass', 'push', 'delegation', 'cat-failure', 'settled', 'crowded']
export type Preview = { area: Area; tab: string; scenario: string; busy?: boolean; empty?: boolean; stage?: StageId; style?: VibeStyle; target?: Area; confirm?: boolean; subagent?: boolean; editing?: boolean; event?: Omit<VibeEvent, 'at'>; provider?: Provider; prices?: boolean; expanded?: boolean; detail?: boolean; undo?: boolean; unavailable?: boolean; chat?: boolean; office?: OfficeFixture; motion?: Motion; list?: boolean; caps?: boolean; quota?: boolean; pendingBusy?: boolean; current?: Area }
export const PREVIEWS: Preview[] = [
  { area: 'overview', tab: 'plugins', scenario: 'nits-plugins', expanded: true },
  { area: 'overview', tab: 'models', scenario: 'nits-models' },
  { area: 'overview', tab: 'agents', scenario: 'nits-history' },
  { area: 'overview', tab: 'dashboard', scenario: 'nits-inherited' },
  { area: 'vibe', tab: 'powerups', scenario: 'nits-inherited' },
  { area: 'vibe', tab: 'decisions', scenario: 'nits-decisions', expanded: true },
  ...['earlier', 'earlier-open', 'earlier-included'].map(suffix => ({ area: 'work' as const, tab: 'plan', stage: 'plan' as const, scenario: `nits-${suffix}` })),
  ...['chat', 'chat-after', 'agents'].map(suffix => ({ area: 'work' as const, tab: 'review', stage: 'review' as const, busy: true, scenario: `nits-review-${suffix}` })),
  { area: 'vibe', tab: 'live', style: 'office', busy: true, scenario: 'nits-office-fail' },
  ...(['provider-on', 'provider-off', 'handoff'] as const).map(kind => ({ area: 'vibe' as const, tab: 'live', style: 'arcade' as const, busy: true, event: { kind, provider: 'codex' as const }, scenario: `nits-arcade-${kind}` })),
  { area: 'overview', tab: 'models', scenario: 'model-speeds' },
  { area: 'vibe', tab: 'crew', scenario: 'model-speeds' },
  ...(['agy-split-ready', 'agy-split-visual-out'] as const).flatMap(scenario => [
    { area: 'overview' as const, tab: 'dashboard', scenario },
    { area: 'overview' as const, tab: 'models', provider: 'antigravity' as const, scenario },
    { area: 'vibe' as const, tab: 'crew', scenario },
  ]),
  { area: 'overview', tab: 'models', provider: 'antigravity', scenario: 'agy-split-both-out' },
  ...(['dashboard', 'agents', 'models', 'settings'] as Tab[]).map(tab => ({ area: 'overview' as const, tab, busy: true, scenario: `babysitter-${tab}` })),
  { area: 'overview', tab: 'agents', busy: true, list: true, scenario: 'babysitter-list' },
  { area: 'overview', tab: 'agents', detail: true, busy: true, scenario: 'babysitter-detail' },
  { area: 'overview', tab: 'agents', scenario: 'babysitter-history' },
  { area: 'overview', tab: 'agents', list: true, busy: true, scenario: 'babysitter-prelaunch' },
  { area: 'overview', tab: 'dashboard', scenario: 'babysitter-finished' },
  { area: 'work', tab: 'implement', stage: 'implement', busy: true, scenario: 'babysitter-implement' },
  { area: 'work', tab: 'settings', scenario: 'babysitter-work-settings' },
  ...(['office', 'arcade'] as VibeStyle[]).map(style => ({ area: 'vibe' as const, tab: 'live', busy: true, style, scenario: `babysitter-${style}` })),
  { area: 'vibe', tab: 'crew', scenario: 'babysitter-crew' },
  { area: 'vibe', tab: 'settings', scenario: 'babysitter-vibe-settings' },
  { area: 'vibe', tab: 'crew', scenario: 'model-picker-crew' },
  { area: 'vibe', tab: 'crew', scenario: 'model-picker-crew-add' },
  { area: 'overview', tab: 'models', scenario: 'model-picker-models' },
  { area: 'overview', tab: 'models', provider: 'commandcode', scenario: 'model-picker-provider' },
  { area: 'overview', tab: 'models', provider: 'commandcode', scenario: 'model-picker-provider-add' },
  ...(['presets-own', 'presets-saved', 'presets-custom'] as const).flatMap(scenario => [
    { area: 'overview' as const, tab: 'models', scenario },
    { area: 'vibe' as const, tab: 'crew', scenario },
  ]),
  { area: 'overview', tab: 'settings', scenario: 'routing-guard-settings' },
  { area: 'vibe', tab: 'crew', scenario: 'routing-guard-crew' },
  { area: 'overview', tab: 'agents', scenario: 'routing-guard-graph', busy: true },
  { area: 'overview', tab: 'agents', scenario: 'routing-guard-list', busy: true, list: true },
  { area: 'overview', tab: 'agents', scenario: 'routing-guard-detail', busy: true, detail: true },
  ...(['source', 'plan', 'implement', 'review', 'settings'] as WorkTab[]).map(tab => ({ area: 'work' as const, current: 'overview' as const, tab, stage: tab === 'implement' ? 'implement' as const : tab === 'plan' ? 'plan' as const : 'review' as const, scenario: 'work-preview' })),
  { area: 'work', current: 'vibe', tab: 'review', stage: 'review', editing: true, scenario: 'work-preview-editor' },
  { area: 'work', current: 'overview', tab: 'review', stage: 'review', scenario: 'review-selected-preview' },
  { area: 'work', current: 'overview', tab: 'review', stage: 'ship', scenario: 'work-preview-ship' },
  { area: 'work', current: 'overview', tab: 'plan', empty: true, scenario: 'work-preview-empty' },
  ...(['source', 'plan', 'implement', 'review', 'settings'] as WorkTab[]).map(tab => ({ area: 'work' as const, current: 'overview' as const, tab, stage: 'review' as const, busy: true, scenario: 'work-preview-busy' })),
  ...(['live', 'crew', 'powerups', 'decisions', 'settings'] as VibeTab[]).map(tab => ({ area: 'vibe' as const, current: 'overview' as const, tab, scenario: 'vibe-preview' })),
  ...(['live', 'crew', 'powerups', 'decisions', 'settings'] as VibeTab[]).map(tab => ({ area: 'vibe' as const, current: 'work' as const, tab, stage: 'review' as const, busy: true, scenario: 'vibe-preview-busy' })),
  { area: 'vibe', current: 'overview', tab: 'live', style: 'arcade', scenario: 'vibe-preview-arcade' },
  ...(['office', 'arcade'] as const).flatMap(style => [
    ...(['full', 'still'] as const).flatMap(motion => [
      { area: 'vibe' as const, tab: 'live', style, busy: true, motion, scenario: `${style}-fail-${motion}` },
      { area: 'vibe' as const, tab: 'live', style, busy: true, motion, scenario: `${style}-collide-${motion}` },
    ]),
    { area: 'vibe' as const, tab: 'live', style, busy: true, motion: 'still' as const, event: { kind: 'handoff' as const, provider: 'codex' as const }, scenario: `${style}-handoff-still` },
    { area: 'vibe' as const, tab: 'live', style, motion: 'still' as const, scenario: `${style}-between` },
  ]),
  { area: 'vibe', tab: 'powerups', scenario: 'skill-override' },
  { area: 'vibe', tab: 'live', style: 'office', busy: true, motion: 'still', event: { kind: 'tag', tag: 'main', provider: 'antigravity' }, scenario: 'office-inspector-main' },
  { area: 'vibe', tab: 'powerups', scenario: 'real-inventory' },
  { area: 'vibe', tab: 'powerups', scenario: 'real-inventory-expanded' },
  { area: 'vibe', tab: 'powerups', scenario: 'skill-inherited' },
  { area: 'overview', tab: 'dashboard', scenario: 'skill-inherited' },
  ...(['office', 'arcade'] as const).map(style => ({ area: 'vibe' as const, tab: 'live', style, busy: true, scenario: `${style}-failure-aged` })),
  ...(['office', 'arcade'] as const).map(style => ({ area: 'vibe' as const, tab: 'live', style, busy: true, scenario: `${style}-busy-stale` })),
  ...(['office', 'arcade'] as const).map(style => ({ area: 'vibe' as const, tab: 'live', style, busy: true, motion: 'still' as const, scenario: `${style}-collide-stale` })),
  { area: 'overview', tab: 'agents', scenario: 'agents-list', busy: true, list: true },
  { area: 'overview', tab: 'agents', scenario: 'agents-history' },
  { area: 'vibe', tab: 'live', scenario: 'resume-implement-waiting', stage: 'implement', target: 'work' },
  ...(['dashboard', 'settings'] as const).map(tab => ({ area: 'overview' as const, tab, scenario: 'caps', caps: true })),
  ...(['dashboard', 'models'] as const).map(tab => ({ area: 'overview' as const, tab, scenario: 'quota-paused', quota: true })),
  { area: 'overview', tab: 'dashboard', scenario: 'quota-window', quota: true },
  ...(['overview', 'work', 'vibe'] as Area[]).map(area => ({ area, tab: area === 'overview' ? 'dashboard' : area === 'work' ? 'implement' : 'live', scenario: 'pending-while-busy', pendingBusy: true, busy: true })),
  ...(['plan', 'implement', 'ship'] as StageId[]).map(stage => ({ area: 'vibe' as const, tab: 'live', scenario: `resume-${stage}`, stage, target: 'work' as const })),
  ...OFFICE_FIXTURES.map(office => ({ area: 'vibe' as const, tab: 'live', style: 'office' as const, scenario: `office3d-${office}`, office, busy: true })),
  ...(['dashboard', 'agents', 'models', 'activity', 'plugins', 'settings'] as Tab[]).flatMap(tab => [
    { area: 'overview' as const, tab, scenario: 'empty-session', empty: true },
    { area: 'overview' as const, tab, scenario: 'busy-five-agents', busy: true },
  ]),
  ...(['claude', 'codex', 'opencode', 'antigravity', 'commandcode'] as Provider[]).map(provider => ({ area: 'overview' as const, tab: 'models', provider, scenario: `provider-${provider}` })),
  { area: 'overview', tab: 'dashboard', scenario: 'price-editor', prices: true },
  { area: 'overview', tab: 'plugins', scenario: 'expanded-plugins', expanded: true },
  { area: 'overview', tab: 'agents', scenario: 'agent-detail', detail: true },
  { area: 'overview', tab: 'activity', scenario: 'turn-ending', empty: true, chat: true },
  ...(['source', 'plan', 'implement', 'review', 'settings'] as WorkTab[]).map(tab => ({ area: 'work' as const, tab, scenario: 'empty-session', empty: true, stage: tab === 'review' ? 'review' as const : tab === 'implement' ? 'implement' as const : 'plan' as const })),
  { area: 'work', tab: 'source', scenario: 'busy-five-agents', stage: 'implement', busy: true },
  { area: 'work', tab: 'plan', scenario: 'plan-with-qa', stage: 'plan' },
  { area: 'work', tab: 'plan', scenario: 'plan-busy', stage: 'plan', busy: true },
  { area: 'work', tab: 'plan', scenario: 'archived-qa', stage: 'plan' },
  { area: 'work', tab: 'settings', scenario: 'reset-confirmation', stage: 'plan' },
  { area: 'work', tab: 'review', scenario: 'typed-instructions', stage: 'review', editing: true },
  { area: 'work', tab: 'review', scenario: 'review-selected-busy', stage: 'review', busy: true },
  { area: 'work', tab: 'review', scenario: 'review-selected-subagent', stage: 'review', subagent: true },
  { area: 'work', tab: 'review', scenario: 'review-no-high', stage: 'review' },
  { area: 'work', tab: 'plan', scenario: 'new-task', stage: 'ship' },
  { area: 'work', tab: 'implement', scenario: 'implement-finished', stage: 'implement' },
  { area: 'work', tab: 'implement', scenario: 'fix-round-running', stage: 'implement', busy: true },
  { area: 'work', tab: 'implement', scenario: 'fix-round-finished', stage: 'implement' },
  { area: 'work', tab: 'implement', scenario: 'claude-running', stage: 'implement', busy: true },
  { area: 'work', tab: 'implement', scenario: 'one-agent-running', stage: 'implement', busy: true },
  { area: 'work', tab: 'review', scenario: 'review-running', stage: 'review', busy: true },
  { area: 'work', tab: 'review', scenario: 'review-subagent-running', stage: 'review', subagent: true },
  { area: 'work', tab: 'review', scenario: 'review-finished', stage: 'review' },
  { area: 'work', tab: 'review', scenario: 'ship-gate-editor', stage: 'review', editing: true },
  { area: 'work', tab: 'source', scenario: 'commit-files', stage: 'ship' },
  { area: 'work', tab: 'source', scenario: 'commit-diff', stage: 'ship' },
  { area: 'work', tab: 'review', scenario: 'committed', stage: 'ship' },
  { area: 'work', tab: 'review', scenario: 'pushed', stage: 'ship' },

  { area: 'work', tab: 'implement', scenario: 'implement-running', stage: 'implement', busy: true },
  { area: 'work', tab: 'review', scenario: 'review-findings', stage: 'review' },
  { area: 'work', tab: 'review', scenario: 'edit-profiles', stage: 'review', editing: true },
  { area: 'work', tab: 'settings', scenario: 'settings', stage: 'plan' },
  { area: 'work', tab: 'review', scenario: 'ship-gate', stage: 'review' },
  { area: 'work', tab: 'review', scenario: 'shipped', stage: 'ship' },
  { area: 'work', tab: 'review', scenario: 'commit-pending', stage: 'ship', busy: true },
  { area: 'work', tab: 'plan', scenario: 'advance-open', stage: 'plan' },
  { area: 'work', tab: 'settings', scenario: 'grill-off', stage: 'plan' },
  ...(['office', 'arcade'] as VibeStyle[]).flatMap(style => [
    { area: 'vibe' as const, tab: 'live', scenario: `${style}-busy`, style, busy: true },
    { area: 'vibe' as const, tab: 'live', scenario: `${style}-idle`, style, empty: true },
    { area: 'vibe' as const, tab: 'live', scenario: `${style}-all-idle`, style, empty: true },
    { area: 'vibe' as const, tab: 'live', scenario: `${style}-mixed-working-idle`, style, busy: true },
  ]),
  ...(['crew', 'powerups'] as VibeTab[]).flatMap(tab => [
    { area: 'vibe' as const, tab, scenario: 'crew-and-powers' },
    { area: 'vibe' as const, tab, scenario: 'empty-session', empty: true },
  ]),
  ...(['office', 'arcade'] as VibeStyle[]).flatMap(style => ([
    { kind: 'provider-off', provider: 'codex' }, { kind: 'provider-on', provider: 'codex' },
    { kind: 'tag', provider: 'codex', tag: 'main' }, { kind: 'tag', provider: 'claude', tag: 'saver' },
    { kind: 'tag', provider: 'codex', tag: 'normal' }, { kind: 'priority', provider: 'codex' },
    { kind: 'handoff', provider: 'codex' }, { kind: 'powerup', key: 'plugin:ponytail', mode: 'force' }, { kind: 'decision' },
  ] as Omit<VibeEvent, 'at'>[]).map(event => ({ area: 'vibe' as const, tab: 'live', style, busy: true, event, scenario: `${style}-${event.kind}${event.tag ? `-${event.tag}` : ''}` }))),
  { area: 'vibe', tab: 'crew', scenario: 'handoff-undo', undo: true },
  { area: 'vibe', tab: 'crew', scenario: 'no-fallback', unavailable: true },
  { area: 'vibe', tab: 'decisions', scenario: 'expanded-decision', expanded: true },
  { area: 'vibe', tab: 'live', scenario: 'resume-work', stage: 'review', target: 'work' },
  { area: 'vibe', tab: 'decisions', scenario: 'decisions-feed' },
  { area: 'vibe', tab: 'decisions', scenario: 'older-decisions' },
  { area: 'vibe', tab: 'decisions', scenario: 'empty-session', empty: true },
  { area: 'vibe', tab: 'settings', scenario: 'settings' },
  { area: 'vibe', tab: 'settings', scenario: 'office-only', style: 'office' },
  { area: 'vibe', tab: 'settings', scenario: 'arcade-only', style: 'arcade' },
  { area: 'overview', tab: 'dashboard', scenario: 'enter-work', target: 'work', confirm: true, empty: true },
  { area: 'vibe', tab: 'live', scenario: 'resume-stage', target: 'work', confirm: true, stage: 'review' },
  { area: 'vibe', tab: 'settings', scenario: 'one-style' },
  ...(['overview', 'work', 'vibe'] as Area[]).map(area => ({ area, tab: area === 'overview' ? 'dashboard' : area === 'work' ? 'plan' : 'live', scenario: 'switch-confirmation', target: area === 'overview' ? 'work' as const : area === 'work' ? 'vibe' as const : 'overview' as const })),
  ...(['overview', 'work', 'vibe'] as Area[]).map(area => ({ area, tab: area === 'overview' ? 'dashboard' : area === 'work' ? 'implement' : 'live', scenario: 'switch-blocked', busy: true, stage: 'implement' as const })),
  { area: 'work', tab: 'implement', scenario: 'subagent-still-running', subagent: true, stage: 'implement' },
]

const hash = (n: number) => n.toString(16).padStart(40, '0')
export const LOG = [
  ['*', 6, [5, 4], 'HEAD -> refs/heads/ux-pass, refs/remotes/origin/ux-pass', 'Merge readable graphics'],
  ['| *', 4, [3], 'refs/heads/scene-sizing', 'Fill the scene pane'],
  ['* |', 5, [3], '', 'Confirm mode changes'],
  ['*', 3, [2], 'tag: refs/tags/preview', 'Add the Work stage rail'],
  ['*', 2, [1], '', 'Show live model usage'],
  ['*', 1, [], '', 'Create the agent panel'],
].map(([g, n, parents, refs, subject]) => `${g} \x1f${hash(n as number)}\x1f${(parents as number[]).map(hash).join(' ')}\x1f${refs}\x1f${subject}\x1fAda\x1f5 minutes ago`).join('\n')

export function fixture(p: Preview): Record<string, any> {
  const d = FIXTURES.busy, r = defaultRouting(), guard = normalGuard(undefined)
  if (p.motion) guard.vibe.motion = p.motion
  if (p.area === 'vibe' && p.tab === 'settings' && p.style) guard.vibe.styles = [p.style]
  const agents = p.empty ? [] : d.agents.map(a => ({ ...a, kind: 'task', run: 'turn:preview', agentId: a.provider === 'claude' ? a.id : undefined, state: p.busy || p.subagent && a.provider === 'claude' ? 'running' : 'done', endedAt: p.busy ? undefined : NOW - 1000 }))
  r.order = ['codex', 'opencode', 'antigravity', 'commandcode']
  r.picks = d.agents.map(a => ({ provider: a.provider, model: a.model, effort: a.effort }))
  r.on = { claude: true, codex: true, opencode: true, antigravity: true, commandcode: true, ollama: false }
  r.tags = { claude: 'main' }
  if (p.event?.kind === 'provider-off') r.on[p.event.provider!] = false
  if (p.event?.kind === 'tag') r.tags = { ...r.tags, claude: 'normal', [p.event.provider!]: p.event.tag }
  if (p.event?.kind === 'handoff' || p.undo) r.tags = { claude: 'saver', codex: 'main' }
  if (p.unavailable) for (const q of r.order) r.on[q] = false
  const providers = Object.fromEntries(d.usage.map(u => [u.provider, { ...blank(), status: 'ok', plan: u.provider === 'opencode' ? 'Go' : 'Pro', usageSource: 'live', usageAt: NOW, checkedAt: NOW,
    models: [{ id: d.agents.find(a => a.provider === u.provider)!.model, efforts: u.provider === 'commandcode' ? ['low', 'medium', 'high'] : ['low', 'medium', 'high', 'xhigh', 'max'] }],
    meters: u.provider === 'commandcode' ? [
      { label: 'Monthly', percent: 20.5, detail: '12.3 of 60 credits · resets in 18d' },
      { label: '5-hour', percent: 15, detail: '1.5 of 10 credits · resets in 2h' },
      { label: 'Weekly', percent: 18, detail: '5.4 of 30 credits · resets in 3d' },
    ] : u.provider === 'opencode' ? [
      { label: '5-hour', percent: 100 * 4.1 / 12, detail: '$4.10 of $12 · resets in 2h' },
      { label: 'Weekly', percent: 21, detail: '$6.30 of $30 · resets in 3d' },
      { label: 'Monthly', percent: 17.5, detail: '$10.50 of $60 · resets in 18d' },
    ] : [{ label: '5-hour', percent: u.provider === 'claude' && p.tab === 'crew' ? 87 : u.percent, detail: 'resets in 2h' }, ...(u.provider === 'claude' ? [{ label: 'Context', percent: 46 }] : [])],
  }])) as Providers
  if (p.scenario.startsWith('agy-split-')) {
    r.agyCoding = true
    r.agyQuota = [
      { label: 'Gemini 5h', percent: p.scenario.endsWith('-out') ? 100 : 0.9916961193084717, detail: 'resets in 4h 36m' },
      { label: 'Gemini wk', percent: 4.633784294128418, detail: 'resets in 2d 2h' },
      { label: 'Argon wk', percent: p.scenario.endsWith('both-out') ? 100 : 31.384223699569702, detail: 'resets in 4d 6h' },
    ]
    providers.antigravity = { ...providers.antigravity!, meters: r.agyQuota, agyQuota: r.agyQuota, models: [
      ...['gemini-4-argon', 'gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5'].flatMap(m => ['high', 'medium', 'low'].map(e => ({ id: `${m}-${e}` }))),
      { id: 'gpt-oss-120b-medium' },
    ] }
    if (p.scenario.endsWith('both-out')) {
      r.on.antigravity = false
      r.paused = { antigravity: { why: 'Antigravity jobs out of quota', at: NOW, until: NOW + 16560000 } }
    }
  }
  const ui: Ui = { tab: (p.area === 'overview' ? p.tab : 'dashboard') as Tab, pick: 'claude', area: p.current ?? p.area,
    workTab: (p.area === 'work' ? p.tab : 'plan') as WorkTab, vibeTab: (p.area === 'vibe' ? p.tab : 'live') as VibeTab,
    vibeStyle: p.style ?? 'office', profileEdit: p.editing, reviewProfile: p.scenario.startsWith('ship-gate') ? 'ship' : undefined, confirm: p.scenario === 'advance-open' ? 'plan:advance' : undefined, editing: p.provider,
    agents: p.list ? 'list' : undefined, pendingArea: p.current ? p.area : p.pendingBusy ? p.area === 'work' ? 'vibe' : 'work' : undefined, cap: p.caps ? 'claude' : undefined, view: p.prices ? 'prices' : undefined, detail: p.detail ? agents.find(a => a.provider === 'codex')?.id : undefined,
    vibeExpanded: p.expanded ? FIXTURES.review.decisions.map((d, i) => `${d.at}:${i}`) : undefined,
    folded: p.caps ? { 'cost:models': false } : p.expanded ? { 'pl:ponytail': false, 'pl:supermatt': false, 'srv:antigravity': false } : undefined,
    vibeUndo: p.undo ? { until: NOW + 30000, before: { ...r, tags: { claude: 'main', codex: 'normal' } }, after: r } : undefined,
  }
  if (p.scenario.startsWith('model-picker-')) {
    providers.commandcode!.models = [
      { id: 'deepseek/deepseek-v4.1-flash', efforts: ['low', 'medium', 'high'] },
      ...Array.from({ length: 79 }, (_, i) => ({ id: `deepseek/model-${String(i + 1).padStart(3, '0')}` })),
      { id: 'moonshotai/kimi-k3' },
      ...Array.from({ length: 19 }, (_, i) => ({ id: `moonshotai/model-${String(i + 1).padStart(3, '0')}` })),
      ...Array.from({ length: 18 }, (_, i) => ({ id: `z-ai/model-${String(i + 1).padStart(3, '0')}` })),
      { id: 'legacy' },
    ]
    Object.assign(r, withPicks(r, [
      ...r.picks.filter(a => a.provider !== 'commandcode'),
      { provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', effort: 'high' },
      { provider: 'commandcode', model: 'moonshotai/kimi-k3', effort: 'medium' },
      { provider: 'commandcode', model: 'z-ai/model-018' },
    ]))
    if (p.scenario.endsWith('-add')) ui.addModel = `${p.area === 'vibe' ? 'crew' : 'models'}:commandcode`
  }
  if (p.caps) guard.caps = { claude: 5, codex: 3 }
  if (p.quota) { r.paused = { codex: { at: NOW, until: NOW + 7200000, why: 'quota' } }; providers.opencode!.alert = 'quota hit'; r.on.codex = false; r.on.antigravity = false }
  if (p.scenario === 'quota-window') Object.assign(providers.opencode!.meters[0]!, { limited: true, percent: 100, detail: '$12.00 of $12 · resets in 2h' })
  if (p.detail) Object.assign(agents.find(a => a.provider === 'codex')!, { input: 'Build the pane', output: 'The pane is ready.' })
  if (p.scenario.startsWith('routing-guard-')) {
    r.tags = { claude: 'normal', codex: 'main' }
    const claude = agents.find(a => a.provider === 'claude')!
    const reason = p.detail ? 'Reason: this review needs the existing Claude context.' : 'Routing: Main is Codex. Prefer handing tasks to it; use Claude subagents when a task needs Claude.'
    Object.assign(claude, { offRoute: reason, input: 'Review the routing changes.' })
    if (p.detail) { ui.detail = claude.id; guard.routingGuard = 'enforce' }
  }
  const at = p.stage ?? 'plan', reached = ['plan', 'implement', 'review', 'ship'].slice(0, ['plan', 'implement', 'review', 'ship'].indexOf(at) + 1)
  if (p.scenario === 'model-speeds') r.optimize = 'speed'
  const modelSpeeds = p.scenario === 'model-speeds' ? Object.fromEntries(r.picks.slice(1).map((a, i) => [speedKey(a.model), Array.from({ length: i === 0 ? 1 : 3 }, () => ({ outputTokens: (70 + i * 5) * 10, milliseconds: 10000 }))])) : {}
  const state: Record<string, any> = { modelSpeeds, ui, guard, routing: r, providers, nodes: agents,
    main: { model: 'claude-opus-5-5', effort: 'high', working: !!p.busy, since: NOW - 60000, steps: p.busy ? 34 : 0, lastTool: p.busy ? 'Agent' : undefined },
    git: { branch: 'ux-pass', commit: hash(6), dirty: p.empty ? 0 : 3, ahead: '↑2' },
    stage: p.area === 'work' || p.stage ? { ...freshStage(), at, reached, startedAt: NOW - 60000, since: at === 'plan' ? undefined : hash(3), shipBase: at === 'ship' ? hash(3) : undefined, seen: reached } : null,
    impl: { agents: r.picks.map(a => ({ ...a, on: true })), launchedAt: p.empty ? undefined : NOW - 60000 },
    edits: p.empty ? [] : [{ file: '/repo/hooks/view.tsx', added: 24, removed: 7, lines: ['+ readable layout'], provider: 'codex', model: 'gpt-6.1-sol', at: NOW - 1000 }, { file: '/repo/hooks/vibe/live.tsx', added: 12, removed: 3, lines: ['+ pane sizing'], provider: 'claude', at: NOW - 3000 }],
    acts: p.empty ? {} : { main: { key: 'main', tool: 'Bash', title: 'npx -y -p typescript tsc -p .', state: p.busy ? 'running' : 'done', at: NOW - 2000, output: ['Type check passed'] } },
    costs: { rows: [], claude: {}, agy: {}, engineUsd: p.empty ? 0 : 2.35 },
    decisions: p.empty ? [] : FIXTURES.review.decisions,
    grill: p.empty ? [] : [{ question: 'When may the owner switch modes?', answer: 'Between turns, with an explicit confirmation.', at: NOW - 40000 }, { question: 'How much room should the scene take?', answer: 'Use the full pane width and preserve the aspect ratio.', at: NOW - 30000 }, { question: 'Do background agents prevent switching?', answer: '', at: NOW - 20000 }],
    findings: p.empty ? [] : [{ file: 'hooks/view.tsx', line: 240, severity: 'high', text: 'Recheck the running turn when Switch is pressed, so an already open confirmation cannot bypass the guard.', by: ['Claude', 'Codex'], at: NOW - 5000 }, { file: 'hooks/vibe/live.tsx', line: 38, severity: 'medium', text: 'Give the interactive scene an explicit width and height from the pane.', by: ['Antigravity'], at: NOW - 4000 }],
    vibe: { acts: p.empty ? [] : d.acts, commits: 2, pushes: 1, combo: 14, best: 164, phase: '', events: p.event ? [{ ...p.event, at: NOW - 200 }] : [] },
    installed: { plugins: p.empty ? [] : [{ name: 'ponytail', enabled: true, where: 'claude', skills: ['ponytail', 'ponytail-audit'] }, { name: 'supermatt', enabled: true, where: 'claude', skills: ['grilling'] }], mcpServers: ['agent-overview', 'antigravity'], skills: 3, tools: ['mcp__antigravity__gemini_visual_qa'] },
    pins: p.empty ? [] : ['plugin:ponytail', 'plugin:supermatt', 'tool:mcp__antigravity__gemini_visual_qa'], toggles: { 'plugin:ponytail': 'force', 'plugin:supermatt': 'off' },
    history: { since: NOW - (p.empty ? 180000 : 60000), items: [] },
  }
  if (p.scenario.startsWith('presets-')) {
    state.presets = [...BUILT_IN.map(b => ({ name: b.name, builtIn: true, routing: b.apply(r) })),
      { name: 'UI work', routing: withPicks({ ...r, tags: { codex: 'main', claude: 'saver' } }, r.picks.filter(p => p.provider !== 'opencode')) }]
    const name = p.scenario === 'presets-own' ? 'Cheap' : p.scenario === 'presets-saved' ? 'UI work' : undefined
    ui.preset = name ? { name } : undefined
    if (name) state.routing = state.presets.find((p: any) => p.name === name).routing
  }
  if (p.scenario === 'reset-confirmation') ui.confirm = 'wset:reset'
  if (p.scenario === 'archived-qa') state.stage = freshStage(NOW)
  if (p.scenario.startsWith('review-selected')) ui.findSel = ['hooks/view.tsx:240']
  if (p.scenario === 'review-no-high') state.findings = state.findings.filter((f: any) => f.severity !== 'high')
  if (p.scenario === 'new-task') ui.workTab = 'review'
  if (p.scenario === 'resume-implement-waiting') state.impl.launchedAt = undefined
  if (p.scenario === 'agents-history') {
    ui.agents = 'history'
    state.history.items = agents.map(a => ({ session: 'preview', at: a.startedAt! - 120000, label: a.label, model: a.model, provider: a.provider, state: 'done', ms: 45000, steps: a.steps }))
  }
  if (p.scenario.startsWith('fix-round')) {
    Object.assign(state.stage, { round: 2, reached: ['plan', 'implement', 'review'], seen: ['plan', 'implement', 'review'] })
    state.impl.launchedAt = NOW - 15000
    state.nodes = [
      { ...agents[0], id: 'old-run', startedAt: NOW - 60000, state: 'done', label: 'First implementation' },
      ...agents.slice(0, 2).map((a, i) => ({ ...a, startedAt: NOW - 10000 + i, label: i ? 'Verify the selected fixes' : 'Fix selected review findings' })),
    ]
  }
  if (p.scenario === 'claude-running') state.nodes = []
  if (p.scenario === 'one-agent-running') state.nodes = [{ ...agents[0], steps: 1 }]
  if (p.scenario.startsWith('review-') && !p.empty) {
    Object.assign(state.stage, { reviewStartedAt: NOW - 60000, reviewCount: 3 })
    if (p.scenario === 'review-finished') state.findings = []
  }
  if (p.scenario === 'commit-files' || p.scenario === 'commit-diff') ui.source = { commit: hash(6), ...(p.scenario === 'commit-diff' ? { file: 'hooks/view.tsx' } : {}) }
  if (p.scenario === 'pushed' || p.scenario === 'shipped') {
    state.git.ahead = ''
    state.acts.push = { key: 'push', tool: 'Bash', title: 'git push origin ux-pass', state: 'done', at: NOW - 100, output: ['ux-pass -> ux-pass'] }
  }
  if (p.caps) {
    const row = { provider: 'codex', model: 'gpt-6.1-sol', period: 'today', input: 400000, output: 60000, cacheRead: 0, cacheWrite: 0 }
    state.costs.rows = [row]; state.costs.base = []; state.ui.folded = { 'cost:models': false }
  }
  if (p.scenario === 'grill-off') state.guard.work.grill = false
  if (p.scenario === 'shipped') state.acts.pr = { key: 'pr', tool: 'Bash', title: 'gh pr create', state: 'done', at: NOW, output: ['https://github.com/example/panel/pull/42'] }
  if (p.scenario === 'one-style') guard.vibe.styles = ['office']
  if (p.scenario === 'older-decisions') state.decisions = Array.from({ length: 24 }, (_, i) => ({ decision: `Retained choice ${i + 1}`, why: 'Session decision history', impact: 'low', at: NOW - (24 - i) * 60000 }))
  if (p.scenario === 'skill-override') state.toggles['skill:ponytail:ponytail-audit'] = 'on'
  if (p.scenario === 'skill-override' || p.scenario === 'skill-inherited') ui.folded = { 'power:plugin:ponytail:children': false, 'sw:plugin:ponytail': false }
  if (p.scenario.startsWith('real-inventory')) {
    state.installed.plugins = state.installed.plugins.filter((plugin: { name: string }) => plugin.name !== 'supermatt')
    state.installed.plugins.push(
      { name: 'supermatt', enabled: true, where: 'claude', skills: ['grilling', 'design', 'research', 'review', 'plan', 'build', 'test', 'docs', 'ship', 'refactor', 'debug', 'explain', 'audit'] },
      { name: 'disabled-plugin', enabled: false, where: 'claude', skills: ['disabled-skill'] },
      ...['documents', 'spreadsheets', 'pdf', 'media', 'browser'].map(name => ({ name, enabled: true, where: 'claude', skills: [name] })),
    )
    const servers = ['ccd_session', 'claude_browser', 'terminal', 'visualize', '1a59c906-04da-521d-baad-123456789abc']
    state.installed.mcpServers.push(...servers)
    state.installed.tools.push(...servers.flatMap(server => Array.from({ length: server === 'claude_browser' ? 19 : 3 }, (_, i) => `mcp__${server}__tool_${i}`)))
    state.installed.skills = 23
    state.pins = ['plugin:ponytail', 'tool:mcp__antigravity__gemini_visual_qa', 'plugin:supermatt', 'plugin:disabled-plugin']
    if (p.scenario.endsWith('-expanded')) ui.folded = { 'power:plugin:supermatt:children': false }
  }
  if (p.scenario.endsWith('-failure-aged')) state.nodes[0] = { ...state.nodes[0], state: 'failed', startedAt: NOW - 240000, endedAt: NOW - 120000 }
  if (p.scenario.endsWith('-stale')) state.providers.commandcode.usageAt = NOW - 7200000
  if (p.scenario.includes('-between')) state.main.working = false
  if (p.scenario.includes('-fail-') || p.scenario.includes('-collide-')) {
    state.vibe.lastTest = 'fail'
    state.vibe.acts = FIXTURES.failing.acts
    state.nodes[0] = { ...state.nodes[0], state: 'failed', endedAt: NOW - 200 }
  }
  if (p.scenario.includes('-collide-')) {
    r.tags = { claude: 'saver', codex: 'main' }
    state.vibe.events = [{ kind: 'tag', provider: 'claude', tag: 'saver', at: NOW - 200 }, { kind: 'priority', at: NOW - 200 }, { kind: 'decision', at: NOW - 200 }]
  }
  if (p.office) {
    const f = p.office, hour = f === 'sunset' ? 18 : f === 'night' || f === 'idle' ? 23 : 14
    const date = new Date(NOW); date.setHours(hour, 37, 0, 0)
    state.now = date.getTime()
    const now = state.now, age = now - NOW
    state.nodes = agents.map(a => ({ ...a, startedAt: a.startedAt! + age, endedAt: a.endedAt === undefined ? undefined : a.endedAt + age }))
    state.history.since = now - 60000
    state.decisions = []
    state.vibe = { acts: [], commits: 0, pushes: 0, pendingCommits: 0, combo: 0, best: 0, phase: '', events: [], startedAt: now - 60000 }
    state.acts = {}; state.edits = []
    state.main = { ...state.main, lastTool: 'Edit' }
    if (f.startsWith('kanban-') || f === 'crowded') {
      const at = f === 'kanban-build' || f === 'crowded' ? 'implement' : f.slice(7)
      state.stage = { at, reached: [at], round: 1 }
    }
    if (f === 'notes' || f === 'crowded') state.decisions = FIXTURES.review.decisions.map(a => ({ ...a, at: now - 20000 }))
    if (f === 'sign' || f === 'crowded') state.vibe.lastFailAt = now - 12 * 86400000
    if (f === 'outbox' || f === 'crowded') Object.assign(state.vibe, { commits: 4, pendingCommits: 4 })
    if (f === 'done' || f === 'crowded') state.nodes = state.nodes.map((a: any, i: number) => i < 3 ? { ...a, state: 'done', endedAt: now - 1000 } : a)
    if (f === 'cups' || f === 'crowded') state.vibe.startedAt = now - 3 * 3600000
    if (f === 'prints' || f === 'crowded') state.vibe.visualChecks = 3
    if (f === 'pass' || f === 'fail') {
      state.vibe.lastTest = f
      state.vibe.acts = [{ tool: 'Bash', title: 'npm test', kind: 'test', state: f === 'fail' ? 'failed' : 'done', at: now - 200, tests: f }]
      if (f === 'fail') state.vibe.lastFailAt = now - 200
    }
    if (f === 'cat-failure') state.nodes[0] = { ...state.nodes[0], state: 'failed', endedAt: now - 200 }
    if (f === 'delegation') {
      state.nodes = state.nodes.map((a: any) => ({ ...a, startedAt: now - 10000 }))
      state.nodes[0].startedAt = now - 200
      state.main.lastTool = 'Agent'
    }
    if (f === 'push') Object.assign(state.vibe, { commits: 4, pushes: 1, pendingCommits: 0, lastPushAt: now - 200 })
    if (f === 'settled') state.vibe.events = [{ kind: 'powerup', at: now - 6000 }]
    if (f === 'idle') {
      state.main = { ...state.main, working: false }; state.nodes = []
      state.history.since = now - 180000; state.vibe.startedAt = now - 180000
    }
  }
  if (p.scenario.endsWith('-all-idle')) {
    state.main = { ...state.main, working: false, waiting: false }
    state.nodes = []; state.acts = {}; state.edits = []; state.decisions = []
    state.vibe = { ...state.vibe, acts: [], events: [] }
    state.history.since = state.now - 180000
  }
  if (p.scenario.endsWith('-mixed-working-idle')) {
    state.main = { ...state.main, working: false, waiting: false }
    state.nodes = state.nodes.map((a: any, i: number) => i < 2 ? a : { ...a, state: 'done', endedAt: state.now - 120000 })
    state.routing.tags.commandcode = 'saver'
  }
  if (p.scenario.startsWith('babysitter-')) {
    const done = p.scenario === 'babysitter-finished' || p.scenario === 'babysitter-history'
    state.nodes = (['codex', 'opencode', 'commandcode', 'antigravity'] as Provider[]).flatMap((provider, i) => {
      const driver = { id: `driver:${i}`, agentId: `claude:${i}`, provider: 'claude', model: 'claude-opus-5-5', label: `review:${provider}`, kind: 'task', run: 'turn:preview', steps: 2, startedAt: NOW - 50000 + i, state: done ? 'done' : 'running', ...(done ? { endedAt: NOW - 2000 } : {}) }
      return [driver, ...(p.scenario === 'babysitter-prelaunch' ? [] : [{ id: `driven:${i}`, parentNode: driver.id, parentId: driver.agentId, provider, model: providers[provider]!.models[0]!.id, label: 'Run side review', kind: 'task', run: driver.run, steps: 7, startedAt: NOW - 40000 + i, state: done ? 'done' : 'running', ...(done ? { endedAt: NOW - 3000 } : {}) }])]
    })
    state.main.working = !done && !!p.busy
    state.edits = []; state.acts = {}; state.decisions = []; state.vibe.acts = []
    state.providers.claude.models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'].map(id => ({ id }))
    if (p.detail) ui.detail = 'driven:0'
    if (p.scenario === 'babysitter-history') {
      ui.agents = 'history'
      const items = state.nodes.map((n: any) => ({ at: n.startedAt, label: n.label, model: n.model, provider: n.provider, state: 'done', ms: n.endedAt - n.startedAt, session: 'preview' }))
      state.history.items = displayHistory(items, state.nodes)
      state.nodes = []
    }
  }
  if (p.scenario === 'nits-history') {
    ui.agents = 'history'; state.nodes = []
    state.history.items = Array.from({ length: 40 }, (_, i) => ({ session: 'preview', at: NOW - (40 - i) * 60000, label: `Review task ${i + 1}`, model: 'gpt-6.1-sol', provider: 'codex', state: 'done', ms: 45000, steps: 8 }))
  }
  if (p.scenario === 'nits-inherited') {
    state.toggles['plugin:ponytail'] = 'off'
    ui.folded = { 'sw:plugin:ponytail': false, 'power:plugin:ponytail:children': false }
  }
  if (p.scenario.startsWith('nits-earlier')) {
    state.stage = freshStage(NOW)
    state.grill = state.grill.filter((q: any) => q.answer)
    if (p.scenario === 'nits-earlier-open') ui.folded = { 'plan:earlier': false }
    if (p.scenario === 'nits-earlier-included') state.stage.qaSince = 0
  }
  if (p.scenario.startsWith('nits-review-')) {
    state.nodes = []
    if (p.scenario !== 'nits-review-chat') state.stage.reviewStartedAt = NOW - 10000
    if (p.scenario === 'nits-review-agents') state.nodes = agents.slice(0, 2).map(a => ({ ...a, startedAt: NOW - 5000, state: 'running' }))
  }
  if (p.scenario === 'nits-office-fail' || p.scenario.startsWith('nits-arcade-')) {
    state.vibe.lastTest = 'fail'; state.vibe.acts = FIXTURES.failing.acts
    state.nodes[0] = { ...state.nodes[0], state: 'failed', endedAt: NOW - 200 }
    state.vibe.events.push({ kind: 'tag', provider: 'codex', tag: 'saver', at: NOW - 200 }, { kind: 'priority', at: NOW - 200 }, { kind: 'decision', at: NOW - 200 }, { kind: 'powerup', at: NOW - 200 })
    if (p.scenario === 'nits-office-fail') state.vibe.events.push({ kind: 'provider-on', provider: 'codex', at: NOW - 200 })
  }
  return state
}
