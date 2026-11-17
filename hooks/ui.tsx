import { atom, read, update } from 'claude-code'
import type { EngineInterface, SelectOption } from 'claude-code'
import type { Area, DecisionItem, Guard, Meter, ModelRow, Provider, Providers, Routing, Ui, VibeEvent } from '../types'
import { allOf, agyBucket, agyJobModel, agyQuotaLine, colorOf, normalGuard, normalRouting, defaultRouting, storeRouting, usageAge, withPicks } from './state'
import { savePresetRouting } from './preset-state'
import { watchQuota } from './providers'

import { speedOf } from './speed'
import type { ModelSpeeds } from '../types'

import { routingEvents } from './vibe/events'

const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {} as Providers)

export type $ = EngineInterface
export type E = any // the surface's element table, from $.ui.resolve(e)

// Mode actions stay inert in previews, including callbacks drawn before a mode change.
export async function modeControls($: $, E: E, area: Area): Promise<E> {
  const preview = ((await read($, ui)).area ?? 'overview') !== area
  const guarded = (run: (...args: any[]) => any) => async (...args: any[]) => {
    if (preview || ((await read($, ui)).area ?? 'overview') !== area) return
    return run(...args)
  }
  return {
    ...E, modePreview: preview,
    Button: (p: any) => E.Button({ ...p, dimColor: preview || p.dimColor, onPress: guarded(p.onPress) }),
    Select: (p: any) => preview
      ? E.Text({ key: p.key, dimColor: true, children: `${p.label ?? ''}${p.options.find((o: SelectOption) => o.value === p.value)?.label ?? p.value ?? ''}` })
      : E.Select({ ...p, onSelect: guarded(p.onSelect) }),
    Input: (p: any) => preview
      ? E.Text({ key: p.key, dimColor: true, children: p.value || p.placeholder || '' })
      : E.Input({ ...p, onInput: p.onInput ? guarded(p.onInput) : undefined, onSubmit: guarded(p.onSubmit) }),
  }
}

export function optimizeControls($: $, E: E, r: Routing) {
  return SettingsRow(E, 'optimize', 'Optimize for', (['quality', 'balanced', 'speed'] as const).map(optimize =>
    <E.Button key={`optimize:${optimize}`} plain onPress={() => saveRouting($, x => ({ ...x, optimize }))}>{Chip(E, optimize[0]!.toUpperCase() + optimize.slice(1), (r.optimize ?? 'quality') === optimize)}</E.Button>))
}

export function adversaryControls($: $, E: E, r: Routing) {
  // Defaults for /review-adversarial, which runs only when the owner asks: a Claude reviewer (Opus 5.5 always offered) and rounds.
  const claude = r.picks.filter(p => p.provider === 'claude')
  const choices = claude.some(p => p.model === 'claude-opus-5-5') ? claude : [{ provider: 'claude' as const, model: 'claude-opus-5-5' }, ...claude]
  return <E.Box flexDirection="column" gap={1}>
    {SettingsRow(E, 'adversary', 'Adversarial review (on request)', [
      <E.Button key="adversary:off" plain onPress={() => saveRouting($, x => ({ ...x, adversary: null }))}>{Chip(E, 'Default', !r.adversary)}</E.Button>,
      ...choices.map(pick => <E.Button key={`adversary:${pick.provider}/${pick.model}`} plain onPress={() => saveRouting($, x => ({ ...x, adversary: { provider: pick.provider, model: pick.model, rounds: x.adversary?.rounds ?? 2 } }))}>{Chip(E, shortModel(pick.model), r.adversary?.provider === pick.provider && r.adversary.model === pick.model, colorOf(pick.provider))}</E.Button>),
    ])}
    {r.adversary ? SettingsRow(E, 'adversary:rounds', 'Review rounds', [1, 2, 3, 4, 5].map(rounds =>
      <E.Button key={`adversary:rounds:${rounds}`} plain onPress={() => saveRouting($, x => ({ ...x, adversary: x.adversary ? { ...x.adversary, rounds } : null }))}>{Chip(E, String(rounds), r.adversary!.rounds === rounds)}</E.Button>)) : null}
  </E.Box>
}

export function modelSpeed(E: E, speeds: ModelSpeeds, model: string) {
  const speed = speedOf(speeds, model)
  return <E.Text dimColor={speed.dim} wrap="truncate-end">{speed.text}</E.Text>
}

export async function saveRouting($: $, change: (r: Routing) => Routing, event?: Omit<VibeEvent, 'at'>, rememberPreset = true) {
  const before = normalRouting(await read($, routing))
  let next = await update($, routing, r => normalRouting(change(normalRouting(r))))
  if (before.agyCodingModel !== next.agyCodingModel || before.agyVisualModel !== next.agyVisualModel || before.agyCoding !== next.agyCoding || before.agyVisual !== next.agyVisual) {
    const info = (await read($, providers).then(allOf)).antigravity
    if (info.agyQuota) {
      const thirdParty = [next.agyCodingModel, next.agyVisualModel].some(m => agyBucket(m) === 'Claude/GPT')
      await update($, providers, ps => ({ ...ps, antigravity: { ...ps.antigravity, meters: info.agyQuota!.filter(m => thirdParty || !m.label.startsWith('Claude/GPT ')) } }))
      await watchQuota($)
      next = await read($, routing)
    }
  }
  $.ui.invalidate('prompt.section')
  await storeRouting($, next)
  if (rememberPreset) await savePresetRouting($, next)
  await routingEvents($, before, next, event)
  return next
}

// The host accepts tab and newline, but refuses other control characters in drawn text.
const printable = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

export function selectOptions(options: readonly SelectOption[], value?: string) {
  const seen = new Set<string>()
  const all = options.filter(o => {
    if (typeof o.value !== 'string' || !o.value.trim() || seen.has(o.value)) return false
    seen.add(o.value)
    return true
  })
  // The host refuses the whole pane when a Select has more than 64 options: keep the selected one and the first others.
  return all.length > 64 ? [...all.filter(o => o.value === value), ...all.filter(o => o.value !== value)].slice(0, 64) : all
}

export function agyControls($: $, E: E, r: Routing, models: ModelRow[], width: number, prefix = 'agy') {
  return <E.Box flexDirection="column" gap={1}>
    {(['visual', 'coding'] as const).map(job => {
      const on = job === 'coding' ? r.agyCoding : r.agyVisual, value = agyJobModel(r, job)
      const field = job === 'coding' ? 'agyCodingModel' : 'agyVisualModel'
      const options = selectOptions([{ value }, ...models.map(m => ({ value: m.id }))], value)
        .map(o => ({ ...o, label: fit(shortModel(o.value).replace(/^gemini-/, '').replace(/-/g, ' '), Math.max(12, width - 10)) }))
      return <E.Box key={`${prefix}:${job}:row`} flexDirection="row" gap={1} alignItems="center">
        <E.Button key={`${prefix}:${job}`} hotkey={prefix === 'agy' ? job === 'coding' ? '3' : '2' : undefined} plain onPress={() => saveRouting($, x => job === 'coding' ? { ...x, agyCoding: !x.agyCoding } : { ...x, agyVisual: !x.agyVisual })}>
          {Chip(E, job === 'coding' ? 'Coding' : 'Visual', on, job === 'coding' ? 'warning' : '#4285F4')}
        </E.Button>
        <E.Box flexShrink={1}><E.Select key={`${prefix}:${job}:model`} wrap="truncate-end" options={options} value={value} onSelect={(model: string) => saveRouting($, x => ({ ...x, [field]: model }))} /></E.Box>
      </E.Box>
    })}
    {agyQuotaLine(r) ? <E.Text color="warning" wrap="truncate-end">{agyQuotaLine(r)}</E.Text> : null}
  </E.Box>
}

export function modelEfforts(p: Provider, models: ModelRow[], model: string) {
  return models.find(m => m.id === model)?.efforts ?? ({
    claude: LEVELS, codex: LEVELS, opencode: ['minimal', 'low', 'medium', 'high', 'max'],
    commandcode: ['low', 'medium', 'high'], antigravity: [], ollama: [],
  })[p]
}

export function saveModel($: $, provider: Provider, model: string, previous?: string) {
  return saveRouting($, r => {
    if (r.picks.some(p => p.provider === provider && p.model === model)) return r
    const picks = [...r.picks]
    if (previous !== undefined) {
      const at = picks.findIndex(p => p.provider === provider && p.model === previous)
      if (at < 0) return r
      picks[at] = { ...picks[at]!, model, effort: undefined }
    } else {
      const at = picks.reduce((last, p, i) => p.provider === provider ? i : last, -1)
      picks.splice(at < 0 ? picks.length : at + 1, 0, { provider, model })
    }
    return withPicks(r, picks)
  })
}

// Picker navigation is UI state; only choosing a model changes routing.
export function modelPicker($: $, E: E, u: Ui, key: string, models: ModelRow[], value: string | undefined, onSelect: (model: string) => any, width = 32) {
  const options = [...new Set(models.map(m => m.id).filter(id => id.trim()))]
  if (value && !options.includes(value)) options.unshift(value)
  if (!options.length) return <E.Text dimColor>no models</E.Text>
  const label = (id: string) => fit(shortModel(id), Math.max(8, width - 6))
  if (options.length <= 64) return <E.Select key={key} wrap="truncate-end" options={options.map(id => ({ value: id, label: label(id) }))} value={value} onSelect={onSelect} />
  const makerOf = (id: string) => id.includes('/') ? id.slice(0, id.indexOf('/')) : 'other'
  const held = u.modelPickers?.[key]
  const state = held?.model === value ? held : undefined
  const navigate = (change: Partial<NonNullable<Ui['modelPickers']>[string]>) => update($, ui, x => ({ ...x, modelPickers: { ...x.modelPickers, [key]: { ...state, model: value, ...change } } }))
  const groups = [...new Set(options.map(makerOf))].sort()
  const bounded = (ids: string[], step: string, target: string | undefined, choose: (id: string) => any) => {
    const controls = []
    let shown = ids
    // Extra range levels keep even a very large catalogue reachable under the host's limit.
    for (let depth = 0; shown.length > 64; depth++) {
      const size = Math.max(64, Math.ceil(shown.length / 64))
      const pages = Array.from({ length: Math.ceil(shown.length / size) }, (_, i) => {
        const items = shown.slice(i * size, (i + 1) * size)
        const first = items[0]!.split('/').pop()!, last = items[items.length - 1]!.split('/').pop()!
        const end = Math.max(3, Math.floor((width - 7) / 2))
        return { value: items[0]!, label: `${fit(first, end)}–${fitStart(last, end)}`, items }
      })
      const page = pages.find(p => target && p.items.includes(target)) ?? pages[0]!
      controls.push(<E.Select key={`${key}:${step}${depth ? `:${depth}` : ''}`} options={pages.map(({ value, label }) => ({ value, label }))} value={page.value} onSelect={choose} />)
      shown = page.items
    }
    return { shown, controls }
  }
  const { shown: makers, controls: makerRanges } = bounded(groups, 'makers', state?.makers ?? (value ? makerOf(value) : undefined), makers => navigate({ makers, maker: undefined, range: undefined }))
  const maker = makers.includes(state?.maker ?? '') ? state!.maker! : value && makers.includes(makerOf(value)) ? makerOf(value) : makers[0]!
  const ids = options.filter(id => makerOf(id) === maker).sort((a, b) => a.localeCompare(b))
  const { shown, controls: ranges } = bounded(ids, 'range', state?.range ?? value, range => navigate({ range }))
  return <E.Box key={`${key}:picker`} flexDirection="column">
    {makerRanges}
    <E.Select key={`${key}:maker`} options={makers.map(value => ({ value }))} value={maker} onSelect={(maker: string) => navigate({ maker, range: undefined })} />
    {ranges}
    <E.Select key={key} wrap="truncate-end" options={shown.map(id => ({ value: id, label: label(id.includes('/') ? id.slice(id.indexOf('/') + 1) : id) }))} value={shown.includes(value ?? '') ? value : undefined} onSelect={onSelect} />
  </E.Box>
}

function safeChildren(children: any, textOnly = false) {
  const keys = new Set<string>()
  return [children].flat(Infinity).map(child => typeof child === 'string' ? printable(child) : child).filter(child => {
    if (!child || typeof child !== 'object') return true
    if (textOnly && child.type !== 'Text') throw new Error('Button children must be text')
    const key = child.props?.key
    if (typeof key !== 'string') return true
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

// Desktop draws a proportional font and ships the whole tree on every redraw: give it the code font, where the
// cell math against bodyColumns holds, and mark the table so helpers skip the terminal-only animation.
export function tableOf($: $, e: any): E {
  const t = $.ui.resolve(e) as E
  const desk = e.surface !== 'terminal'
  // A desktop button draws its own label, so a filled chip inside one shows no fill: draw that button primary instead.
  const isFill = (c: any) => c?.type === 'Text' && c.props?.color === 'inverseText' && !!c.props?.backgroundColor
  const button = (p: any) => {
    p = { ...p, children: safeChildren(p.children, true) }
    if (!desk || ![p.children].flat(Infinity).some(isFill)) return t.Button(p)
    const { plain: _, ...rest } = p
    return t.Button({ ...rest, variant: 'primary' })
  }
  return {
    ...t, desk,
    pixelWidth: Math.max(1, (e.props?.bodyColumns ?? e.viewport?.columns ?? 60) * 8),
    Box: (p: any) => t.Box({ ...p, children: safeChildren(p.children) }),
    Text: (p: any) => t.Text({ ...(desk ? { mono: true } : {}), ...p, children: safeChildren(p.children) }),
    Button: button,
    Code: (p: any) => t.Code({ ...p, source: printable(p.source) }),
    // All Select sites use this table, including Work's model and effort pickers.
    ...(t.Select ? { Select: (p: any) => {
      const options = selectOptions(p.options, p.value)
      return options.length ? t.Select({ ...p, options }) : null
    } } : {}),
    ...(t.Svg ? { Svg: (p: any) => typeof p.source === 'string' && p.source.trim() && p.source.length <= 131072
      ? t.Svg(p) : t.Text({ mono: true, dimColor: true, children: `${p.alt} (SVG unavailable)` }) } : {}),
  }
}

// The host measures columns in its code font; Svg dimensions are CSS pixels.
export const graphicWidth = (E: E, inset = 0) => Math.max(1, E.pixelWidth - inset * 8)

const EIGHTHS = ' ▏▎▍▌▋▊▉'

export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
export const TAGS = [{ value: 'main', label: 'Main' }, { value: 'normal', label: 'Normal' }, { value: 'saver', label: 'Saver' }]
export const displayName = (name: string) => {
  const label = name.replace(/^gemini_/, '').replace(/_/g, ' ').replace(/\bqa\b/gi, 'QA')
  return label.charAt(0).toUpperCase() + label.slice(1)
}
export const pinLabel = (key: string) => {
  const tool = /^tool:mcp__(.+?)__(.+)$/.exec(key)
  return tool ? `${displayName(tool[1]!)} · ${displayName(tool[2]!)}` : displayName(key.replace(/^skill:[^:]+:/, '').replace(/^(plugin|server):/, ''))
}
export const CODEX_IMAGES = 'Codex image generation'
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const usageDetail = (detail = '') => /\bused\b/.test(detail) ? detail : detail.replace(/^(.*?\bof\b[^·]+?)(\s*·|$)/, '$1 used$2')

export const fit = (s: string, n: number) => (n <= 0 ? '' : s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`)
export const fitStart = (s: string, n: number) => (n <= 0 ? '' : s.length <= n ? s : `…${s.slice(s.length - n + 1)}`)
export const padR = (s: string, n: number) => fit(s, n).padEnd(n)
export const padL = (s: string, n: number) => fit(s, n).padStart(n)
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const ago = (ms: number) => (ms < 60000 ? (ms < 3000 ? 'now' : `${Math.round(ms / 1000)}s`) : ms < 3600000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 3600000)}h`)
export const bar = (percent: number, width: number) => {
  const p = Math.max(0, Math.min(100, percent))
  const cells = (p / 100) * width
  const full = Math.floor(cells)
  const part = EIGHTHS[Math.round((cells - full) * 8)] ?? ''
  const head = full < width ? (part === ' ' ? '' : part) : ''
  return '█'.repeat(full) + head + '░'.repeat(Math.max(0, width - full - (head ? 1 : 0)))
}
export const pips = (percent: number, n: number) => {
  const k = Math.round((Math.max(0, Math.min(100, percent)) / 100) * n)
  return '▰'.repeat(k) + '▱'.repeat(n - k)
}
export const heat = (p: number) => (p >= 85 ? 'error' : p >= 60 ? 'warning' : 'success')
export const base = (path: string) => path.split('/').filter(Boolean).slice(-2).join('/')
export const file = (path: string) => path.split('/').filter(Boolean).pop() ?? path
export const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '')

export async function saveGuard($: $, change: (g: Guard) => Guard) {
  const held = await read($, guard)
  const saved = await $.store.get('guard').catch(() => undefined)
  const next = await update($, guard, () => change(normalGuard(saved ?? held)))
  await $.store.set('guard', next).catch(() => {})
  if (next.routingGuard !== held.routingGuard || next.babysitterModel !== held.babysitterModel) $.ui.invalidate('prompt.section')
}

export async function babysitterRow($: $, E: E, width = 32) {
  const g = normalGuard(await read($, guard)), u = await read($, ui)
  const models = (await read($, providers).then(allOf)).claude?.models ?? []
  return SettingsRow(E, 'setting:babysitterModel', 'Babysitter model', modelPicker($, E, u, 'babysitter:model', models.filter(m => /^claude-(?:sonnet|haiku|opus)-/.test(m.id)), g.babysitterModel, model => saveGuard($, x => ({ ...x, babysitterModel: model })), width))
}

// A titled card: a round frame in an accent colour, the title inside its top row.
export const Card = (E: E, key: string, title: string, color: string, body: any, opts: { aside?: any; width?: number; grow?: boolean } = {}) => (
  <E.Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={opts.width} flexGrow={opts.grow ? 1 : undefined} flexShrink={1}>
    <E.Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1} marginBottom={E.desk ? 1 : 0}>
      <E.Text color={color} weight="bold">{title}</E.Text>
      {opts.aside ?? null}
    </E.Box>
    {body}
  </E.Box>
)

// A card whose title folds it: ▾ open, ▸ closed. The choice is kept in ui.folded.
export function Fold($: $, E: E, folded: Record<string, boolean>, key: string, title: string, color: string, body: () => any, opts: { aside?: any; width?: number; open?: boolean } = {}) {
  const isOpen = folded[key] === undefined ? opts.open ?? true : !folded[key]
  return (
    <E.Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={opts.width} flexShrink={1}>
      <E.Box flexDirection="row" justifyContent="space-between" gap={2}>
        <E.Button key={`fold:${key}`} plain onPress={() => update($, ui, u => ({ ...u, folded: { ...(u.folded ?? {}), [key]: isOpen } }))}>
          <E.Text color={color} weight="bold">{isOpen ? '▾' : '▸'} {title}</E.Text>
        </E.Button>
        {opts.aside ?? null}
      </E.Box>
      {isOpen ? body() : null}
    </E.Box>
  )
}

// A choice: the selected one is a filled chip, the rest quiet text.
export const filled = (E: E, color: string) => (E.desk ? { backgroundColor: color, color: 'inverseText' } : { inverse: true, color })
export const Chip = (E: E, label: string, on: boolean, color = 'claude') =>
  E.modePreview ? <E.Text dimColor>{on ? `[ ${label} ]` : ` ${label} `}</E.Text>
    : on ? <E.Text {...filled(E, color)} weight="bold"> {label} </E.Text> : <E.Text> {label} </E.Text>

export const SettingsRow = (E: E, key: string, label: string, choices: any) => <E.Box key={key} flexDirection="row" justifyContent="space-between" gap={1} flexWrap="wrap" alignItems="center">
  <E.Text weight="bold">{label}</E.Text>
  <E.Box flexDirection="row" flexWrap="wrap" gap={1}>{choices}</E.Box>
</E.Box>

export function routingGuardRow($: $, E: E, g: Guard) {
  return SettingsRow(E, 'setting:routingGuard', 'Routing guard', (['warn', 'enforce', 'off'] as const).map(mode =>
    <E.Button key={`setting:routingGuard:${mode}`} plain onPress={() => saveGuard($, x => ({ ...x, routingGuard: mode }))}>{Chip(E, mode[0]!.toUpperCase() + mode.slice(1), g.routingGuard === mode)}</E.Button>))
}

export const Rule = (E: E, name: string, w: number, aside = '', asideColor?: string) => (
  <E.Text key={`rule:${name}`} wrap="truncate-end">
    <E.Text color="subtle" weight="bold">{name}</E.Text>

    {aside ? <E.Text color={asideColor} dimColor={asideColor ? undefined : true}> {aside}</E.Text> : ''}
  </E.Text>
)

// Decisions Claude made on its own: newest first, impact as a coloured mark.
export const IMPACT: Record<DecisionItem['impact'], { mark: string; color: string }> = { high: { mark: '▲', color: 'error' }, medium: { mark: '◆', color: 'warning' }, low: { mark: '▽', color: 'subtle' } }

export function meterRows(E: E, meters: Meter[], w: number, estimate = false, age = '') {
  const bw = Math.max(8, Math.min(30, w - 34))
  return meters.map(m => (
    <E.Box key={`meter:${m.label}`} flexDirection="column">
      <E.Text wrap="truncate-end">
        <E.Text>{padR(m.label, 11)}</E.Text>
        <E.Text color={heat(m.percent)}>{bar(m.label === 'Context' ? m.percent : 100 - m.percent, bw)}</E.Text>
        <E.Text weight="bold"> {estimate ? '≈' : ''}{Math.round(m.label === 'Context' ? m.percent : 100 - m.percent)}% {m.label === 'Context' ? 'used' : 'left'}{age ? ` · ${age}` : ''}</E.Text>
      </E.Text>
      {m.detail ? <E.Text dimColor>{usageDetail(m.detail)}</E.Text> : null}
    </E.Box>
  ))
}

// How much a provider has left, from its meters, spend or credits.
export function leftOf(E: E, info: Providers[Provider], p: Provider, n = 5, now = info.checkedAt ?? 0) {
  // Local models have no quota: say whether the server answers.
  if (p === 'ollama') return info.offline ? <E.Text color="warning">server down</E.Text> : <E.Text dimColor>{info.status === 'loading' ? '…' : 'free · local'}</E.Text>
  if (info.alert) return <E.Text color="error" weight="bold">quota hit</E.Text>
  const ms = info.meters.filter(m => m.label !== 'Context')
  if (ms.length) {
    const worst = Math.max(...ms.map(m => m.percent))
    return (
      <E.Text>
        <E.Text color={heat(worst)}>{pips(100 - worst, n)}</E.Text>
        <E.Text dimColor> {padL(`${p === 'opencode' && info.usageSource !== 'live' ? '≈' : ''}${Math.round(100 - worst)}%`, 4)} left{usageAge(info, now) ? ` · ${usageAge(info, now)}` : ''}</E.Text>
      </E.Text>
    )
  }
  const spend = info.facts.find(f => /spent in 7 days/.test(f))
  if (spend) return <E.Text dimColor>{spend.replace(' spent in 7 days', ' this week')}</E.Text>
  const cr = info.facts.find(f => /monthly credits/.test(f))
  if (cr) return <E.Text dimColor>{cr.replace(' monthly credits left', ' credits left')}</E.Text>
  return <E.Text dimColor>{info.status === 'loading' ? '…' : p === 'antigravity' ? 'no quota data' : '—'}</E.Text>
}

export { money } from './cost'
export { colorOf, nameOf, PROVIDERS } from './state'

export const tok = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`)

export async function submitPrompt($: $, text: string): Promise<boolean> {
  try {
    const sent = await $.prompt.submit({ text, asUser: true })
    if ('drop' in sent) { $.ui.toast(sent.drop ?? 'prompt was dropped'); return false }
    return true
  } catch { $.ui.toast('could not send it to Claude · try again'); return false }
}
