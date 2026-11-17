import { atom, read, update } from 'claude-code'
import type { MainInfo, ModelSpeeds, Provider, Providers, Routing, RoutingTag, Ui } from '../../types'
import { agyJobOn, blank, defaultRouting, nameOf, normalGuard, tagOf, withPicks, withTag } from '../state'
import { adversaryControls, agyControls, babysitterRow, Chip, colorOf, graphicWidth, leftOf, modeControls, modelEfforts, modelPicker, routingGuardRow, saveModel, saveRouting, optimizeControls, modelSpeed, shortModel, TAGS } from '../ui'
import type { $, E } from '../ui'
import { C, OFFICE_ACCENTS, OFFICE_CAST, ROOM, canvas, remap, sprite, toCells, toSvg } from './engine'
import { MASCOTS } from './office'
import { stopPlayback } from './loop'
import { workCaps } from '../work/stage'
import { presetsCard } from '../presets'

const modelSpeeds = atom({ plugin: 'agent-overview', key: 'modelSpeeds' } as const, {} as ModelSpeeds)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, { claude: blank(), codex: blank(), opencode: blank(), commandcode: blank(), antigravity: blank() } as Providers)
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))

export function handoff(r: Routing, ps: Providers, over: Provider[] = []): { routing: Routing; provider: Provider } | undefined {
  const available = r.picks.filter(a => a.provider !== 'claude' && r.on[a.provider] && !r.paused?.[a.provider] && !over.includes(a.provider) && ps[a.provider].status === 'ok' && (a.provider === 'antigravity' && r.agyQuota ? agyJobOn(r, 'coding') : !ps[a.provider].alert && !ps[a.provider].meters.some(m => m.label !== 'Context' && m.percent >= 100) && (a.provider !== 'antigravity' || r.agyCoding)))
  const pick = available.find(a => tagOf(r, a.provider) !== 'saver') ?? available[0]
  if (!pick) return
  return { provider: pick.provider, routing: withTag(withTag({ ...r, role: r.role === 'claude' ? 'auto' : r.role }, 'claude', 'saver'), pick.provider, 'main') }
}
export async function performHandoff($: $) {
  const before = await read($, routing), current = handoff(before, await read($, providers), await workCaps($))
  if (!current || tagOf(before, current.provider) === 'main' && tagOf(before, 'claude') === 'saver') return undefined
  const after = await saveRouting($, () => current.routing, { kind: 'handoff', provider: current.provider })
  const until = await $.clock.now() + 30000
  await update($, ui, x => ({ ...x, vibeUndo: { before: x.vibeUndo && x.vibeUndo.until > until - 30000 ? x.vibeUndo.before : before, after, until } }))
  $.clock.after(30000, () => { void update($, ui, x => x.vibeUndo?.until === until ? { ...x, vibeUndo: undefined } : x) })
  return current.provider
}
export async function undoHandoff($: $) {
  const undo = (await read($, ui)).vibeUndo
  if (!undo || await $.clock.now() >= undo.until) return false
  if (JSON.stringify(await read($, routing)) !== JSON.stringify(undo.after)) { $.ui.toast('Routing changed'); return false }
  await saveRouting($, () => undo.before, { kind: 'handoff', provider: (['claude', ...undo.before.order] as Provider[]).find(p => tagOf(undo.before, p) === 'main') ?? 'claude' })
  await update($, ui, x => ({ ...x, vibeUndo: undefined }))
  return true
}
export function portrait(E: E, p: Provider, size = 120, dim = false) {
  const c = canvas(22, 22, C.PAPER)
  sprite(c, { rows: MASCOTS[p], map: { '#': ROOM.outline, a: OFFICE_CAST[p], l: ROOM.light, O: OFFICE_CAST.claude, k: OFFICE_ACCENTS.eye } }, 3, p === 'claude' ? 6 : 2)
  if (dim && !E.desk) remap(c, 0, 0, c.w, c.h, { [OFFICE_CAST[p]]: ({ claude: C.claudeDark, codex: C.codexDark, antigravity: C.agyDark, opencode: C.opencodeDark, commandcode: C.cmdDark })[p], [ROOM.light]: ROOM.edge })
  return E.desk ? <E.Svg key={`crew:portrait:${p}`} source={toSvg([c], { fps: 1 }).replace('<svg ', `<svg opacity="${dim ? .4 : 1}" `)} width={size} height={size} alt={`${nameOf(p)} mascot`} /> : <E.Raster key={`crew:portrait:${p}`} {...toCells(c, 22)} />
}
export async function crewTab($: $, E: E, w: number) {
  const Action = await modeControls($, E, 'vibe')
  stopPlayback()
  const [r, ps, u, now, over, chat] = await Promise.all([read($, routing), read($, providers), read($, ui), $.clock.now(), workCaps($), read($, main)])
  const speeds = await read($, modelSpeeds)
  const babysitter = await babysitterRow($, E)
  const candidate = handoff(r, ps, over), tired = ps.claude.alert || ps.claude.meters.some(m => m.label !== 'Context' && m.percent > 80)
  const order: Provider[] = ['claude', ...r.order]
  const cols = E.desk ? w >= 110 ? 3 : w >= 76 ? 2 : 1 : w >= 130 ? 3 : w >= 64 ? 2 : 1
  const width = Math.floor((w - (cols - 1)) / cols), size = Math.max(96, Math.min(180, graphicWidth(E, 4) / cols * .4))
  const handed = candidate && tagOf(r, candidate.provider) === 'main' && tagOf(r, 'claude') === 'saver'
  const move = (p: Provider, delta: number) => saveRouting($, x => {
    const i = x.order.indexOf(p as Exclude<Provider, 'claude'>), j = i + delta
    if (i < 0 || j < 0 || j >= x.order.length) return x
    const order = [...x.order]
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    return { ...x, order }
  })
  return <E.Box key="vibe:crew" flexDirection="column" gap={1}>
    {await presetsCard($, E)}
    {optimizeControls($, E, r)}
    {adversaryControls($, E, r)}
    <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      {candidate && !handed ? <Action.Button key="crew:handoff" plain onPress={() => performHandoff($)}>{Chip(Action, `Hand off to ${nameOf(candidate.provider)}`, !!tired)}</Action.Button> : <E.Text key="crew:handoff" dimColor>{candidate ? `${nameOf(candidate.provider)} is main` : 'no available crew'}</E.Text>}
      {u.vibeUndo && now < u.vibeUndo.until ? <Action.Button key="crew:undo" plain onPress={() => undoHandoff($)}>{Chip(E, 'Undo', false)}</Action.Button> : null}
    </E.Box>
    {routingGuardRow($, E, await read($, guard))}
    <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      {order.map((p, i) => <E.Box key={`crew:${p}`} flexDirection="column" gap={1} borderStyle={tagOf(r, p) === 'main' ? 'bold' : 'round'} borderColor={r.on[p] ? colorOf(p) : 'inactive'} paddingX={1} paddingY={1} width={width}>
        <E.Box flexDirection="row" justifyContent="space-between"><E.Text color={colorOf(p)} weight="bold">{nameOf(p)}</E.Text>{tagOf(r, p) === 'main' ? Chip(E, 'MAIN', true, colorOf(p)) : null}</E.Box>
        <E.Box flexDirection={!E.desk && w < 130 ? "column" : "row"} gap={1} alignItems="center">
          {portrait(E, p, size, !r.on[p] || tagOf(r, p) === 'saver')}
          <E.Box flexDirection="column" flexShrink={1}>
            <E.Text dimColor>{p === 'claude' ? `◆ Chat ${shortModel(chat.model)}` : `#${i} in order`}</E.Text>
            {leftOf(E, ps[p], p, 8, now)}
            {ps[p].meters.filter(m => m.label !== 'Context').sort((a, b) => b.percent - a.percent)[0]?.detail ? <E.Text dimColor>{ps[p].meters.filter(m => m.label !== 'Context').sort((a, b) => b.percent - a.percent)[0]!.detail}</E.Text> : null}
            {r.paused?.[p] ? <E.Text dimColor>Reset {new Date(r.paused[p]!.until).toTimeString().slice(0, 5)}</E.Text> : null}
          </E.Box>
        </E.Box>
        {p === 'claude' ? babysitter : null}
        {p === 'antigravity' ? agyControls($, E, r, ps[p].models, width - 4, 'crew:agy') : null}
        {p === 'claude' ? <E.Text dimColor>Subagents</E.Text> : null}
        {r.picks.filter(a => a.provider === p).map(a => {
          const key = `${p}/${a.model}`, same = (q: Routing['picks'][number]) => q.provider === p && q.model === a.model
          const efforts = modelEfforts(p, ps[p].models, a.model)
          return <E.Box key={`crew:row:${key}`} flexDirection="row" gap={1} alignItems="flex-end">
            <E.Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {modelPicker($, E, u, `crew:model:${key}`, ps[p].models.filter(m => m.id === a.model || !r.picks.some(q => q.provider === p && q.model === m.id)), a.model, model => saveModel($, p, model, a.model), width - 20)}
              {modelSpeed(E, speeds, a.model)}
            </E.Box>
            <E.Box flexDirection="row" gap={1} alignItems="center">
              {efforts.length ? <E.Select key={`crew:effort:${key}`} options={['default', ...efforts].map(value => ({ value }))} value={a.effort ?? 'default'} onSelect={(effort: string) => saveRouting($, x => withPicks(x, x.picks.map(q => same(q) ? { ...q, effort: effort === 'default' ? undefined : effort } : q)))} /> : null}
              <E.Button key={`crew:remove:${key}`} plain onPress={() => saveRouting($, x => withPicks(x, x.picks.filter(q => !same(q))))}><E.Text color="error">✕</E.Text></E.Button>
            </E.Box>
          </E.Box>
        })}
        {!r.picks.some(a => a.provider === p) ? <E.Text dimColor>no model</E.Text> : null}
        <E.Button key={`crew:add:${p}`} plain onPress={() => update($, ui, x => ({ ...x, addModel: x.addModel === `crew:${p}` ? undefined : `crew:${p}` }))}>{u.addModel === `crew:${p}` ? 'Cancel' : '+ model'}</E.Button>
        {u.addModel === `crew:${p}` ? modelPicker($, E, u, `crew:addmodel:${p}`, ps[p].models.filter(m => !r.picks.some(q => q.provider === p && q.model === m.id)), undefined, async model => {
          await saveModel($, p, model)
          await update($, ui, x => ({ ...x, addModel: undefined }))
        }, width - 4) : null}
        <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
          {p !== 'claude' ? <E.Button key={`crew:on:${p}`} plain onPress={() => saveRouting($, x => ({ ...x, on: { ...x.on, [p]: !x.on[p] }, paused: Object.fromEntries(Object.entries(x.paused ?? {}).filter(([q]) => q !== p)) }))}>{Chip(E, r.on[p] ? 'On' : 'Off', r.on[p], colorOf(p))}</E.Button> : null}
          <E.Text dimColor>{u.preset ? 'preset' : 'this chat'}</E.Text>
          <E.Select key={`crew:tag:${p}`} options={TAGS} value={tagOf(r, p)} onSelect={(tag: RoutingTag) => saveRouting($, x => withTag(x, p, tag))} />
          <E.Box>{i <= 1 ? <E.Text dimColor>{Chip(E, '▲', false)}</E.Text> : <E.Button key={`crew:up:${p}`} plain onPress={() => move(p, -1)}>{Chip(E, '▲', false)}</E.Button>}</E.Box>
          <E.Box>{i === 0 || i === order.length - 1 ? <E.Text dimColor>{Chip(E, '▼', false)}</E.Text> : <E.Button key={`crew:down:${p}`} plain onPress={() => move(p, 1)}>{Chip(E, '▼', false)}</E.Button>}</E.Box>
        </E.Box>
      </E.Box>)}
    </E.Box>
  </E.Box>
}
