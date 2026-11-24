import { atom, read, update } from 'claude-code'

import type { Act, AgentNode, Costs, DecisionItem, Guard, Media, Mode, EditItem, GitInfo, GrillItem, History, HistoryItem, Installed, LiveEdit, MainInfo, ModelSpeeds, Price, Prices, Provider, Providers, Routing, RoutingTag, SideLive, Tab, TokenRow, Tokens, TurnCost, Ui, Used, Area, Written } from '../types'
import { displayAgents, displayHistory, babysitterDrivers } from './babysitter'
import { buildTree, scorecard, stagesOf, stateOf, watchKey } from './graph'
import { MEDIA, costOf, creditRate, mediaDollars, planOf, money, priceKey, priceOf, refreshMedia, rowCost, serverName, sessionRows, spendBy, capWindow, unpricedModels, totalOf, usedMedia } from './cost'
import { NOT_INSTALLED, loadPrices, recheck, refreshUsage, tokens, watchQuota } from './providers'
import { skillMode, toolMode } from './toggles'
import { skillRow, triState } from './switches'
import type { $, E } from './ui'
import { adversaryControls, agyControls, babysitterRow, submitPrompt, tableOf, fit, fitStart, padR, padL, clock, ago, bar, pips, heat, shortModel, base, file, tok, LEVELS, filled, Chip, Card, Rule, Fold, meterRows, leftOf, IMPACT, saveGuard, saveModel, saveRouting, optimizeControls, modelSpeed, modelPicker, modelEfforts, graphicWidth, plural, TAGS, CODEX_IMAGES, SettingsRow, routingGuardRow, usageDetail, displayName, pinLabel } from './ui'
import { workView, onAreaChange } from './work'
import { vibeView } from './vibe'
import { presetsCard } from './presets'
import { modeBusy } from './modes'
import { chatSettings } from './chat-settings'
import { chatBandExtras } from './chat-surfaces'
import { hooksCard, switchNote } from './hookcheck'
import { adversarialCard, confidentialCard, routeLogCard, taskRoutingCard } from './policy-view'
import type { Stage, TreeRow } from './graph'
import { allOf, agyQuotaLine, OTHERS, PROVIDERS, blank, colorOf, defaultRouting, livePicks, move, nameOf, normalGuard, providerOf, usageAge, tagOf, withPicks, withTag } from './state'

export { fit, fitStart, bar, pips, clock, LEVELS, tok } from './ui'

// State is declared in each file that reads or writes it: the engine lists a file's state from its own consts.
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const grill = atom({ plugin: 'agent-overview', key: 'grill' } as const, [] as GrillItem[])
const decisions = atom({ plugin: 'agent-overview', key: 'decisions' } as const, [] as DecisionItem[])
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
const written = atom({ plugin: 'agent-overview', key: 'written' } as const, { added: 0, removed: 0, files: [] } as Written)
const live = atom({ plugin: 'agent-overview', key: 'live' } as const, null as LiveEdit | null)
const sideLive = atom({ plugin: 'agent-overview', key: 'sideLive' } as const, null as SideLive | null)
const acts = atom({ plugin: 'agent-overview', key: 'acts' } as const, {} as Record<string, Act>)
const git = atom({ plugin: 'agent-overview', key: 'git' } as const, { error: 'loading' } as GitInfo)
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {
  claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(), ollama: blank(),
} as Providers)
const used = atom({ plugin: 'agent-overview', key: 'used' } as const, { mcp: {}, skills: {}, agentTypes: {} } as Used)
const installed = atom({ plugin: 'agent-overview', key: 'installed' } as const, { plugins: [], mcpServers: [], skills: 0 } as Installed)
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const tick = atom({ plugin: 'agent-overview', key: 'tick' } as const, 0)
const modelSpeeds = atom({ plugin: 'agent-overview', key: 'modelSpeeds' } as const, {} as ModelSpeeds)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const history = atom({ plugin: 'agent-overview', key: 'history' } as const, { since: 0, items: [] } as History)
const costs = atom({ plugin: 'agent-overview', key: 'costs' } as const, { rows: [], claude: {}, agy: {} } as Costs)
const media = atom({ plugin: 'agent-overview', key: 'media' } as const, {} as Media)
const turnCosts = atom({ plugin: 'agent-overview', key: 'turnCosts' } as const, [] as TurnCost[])
const prices = atom({ plugin: 'agent-overview', key: 'prices' } as const, { catalog: {}, overrides: {} } as Prices)
const toggles = atom({ plugin: 'agent-overview', key: 'toggles' } as const, {} as Record<string, Mode>)
const pins = atom({ plugin: 'agent-overview', key: 'pins' } as const, [] as string[])
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))

export const PANE = 'agent-overview'

async function displayNodes($: $) { return displayAgents(await read($, nodes), await read($, edits)) }
async function agentHistory($: $) {
  const h = await read($, history)
  return { ...h, items: displayHistory(h.items, await read($, nodes), await read($, edits)) }
}

const WIDE = 100
const MID = 80
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
async function spinOf($: $, E: E) { return E.desk ? '●' : SPIN[(await read($, tick)) % SPIN.length]! }
const RISE = ' ▁▂▃▄▅▆▇█'
const LEVEL_COLOR = ['success', 'success', 'claude', 'warning', 'error']

// ---------- small pure helpers ----------

const nodeModel = (n: { model: string; effort?: string }) => `${shortModel(n.model)}${n.effort ? ` · ${n.effort}` : ''}`
const provOf = (n: { provider?: Provider; model: string }) => n.provider ?? providerOf(n.model)
const counts = (xs: AgentNode[], list: AgentNode[]) => {
  const st = xs.map(n => stateOf(n, list))
  return { r: st.filter(s => s === 'running').length, d: st.filter(s => s === 'done').length, f: st.filter(s => s === 'failed').length }
}
const countText = (c: { r: number; d: number; f: number }, spin: string) => [c.r ? `${c.r} running` : '', c.d ? `${c.d} done` : '', c.f ? `${c.f} failed` : ''].filter(Boolean).join(' · ')

// Three-row block digits for the dashboard counters.
const DIGITS: Record<string, [string, string, string]> = {
  '0': ['█▀█', '█ █', '▀▀▀'], '1': ['▀█ ', ' █ ', '▀▀▀'], '2': ['▀▀█', '█▀▀', '▀▀▀'], '3': ['▀▀█', ' ▀█', '▀▀▀'], '4': ['█ █', '▀▀█', '  ▀'],
  '5': ['█▀▀', '▀▀█', '▀▀▀'], '6': ['█▀▀', '█▀█', '▀▀▀'], '7': ['▀▀█', '  █', '  ▀'], '8': ['█▀█', '█▀█', '▀▀▀'], '9': ['█▀█', '▀▀█', '▀▀▀'],
  '%': ['▀ ▄', ' ▄▀', '▀ ▄'], '+': [' ▄ ', '▀█▀', '   '], '-': ['   ', '▀▀▀', '   '], ' ': ['   ', '   ', '   '],
}
export const bigText = (s: string): [string, string, string] => {
  const cs = s.split('').map(c => DIGITS[c] ?? DIGITS[' ']!)
  return [0, 1, 2].map(i => cs.map(c => c[i]).join(' ')) as [string, string, string]
}

const wrapText = (s: string, w: number, max: number) => {
  const out: string[] = []
  for (const para of s.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line ? line.length + 1 : 0) + word.length > w) {
        if (line) out.push(line)
        line = word.length > w ? fit(word, w) : word
      } else line = line ? `${line} ${word}` : word
    }
    out.push(line)
    if (out.length >= max) break
  }
  const lines = out.filter((l, i) => l || i < out.length - 1).slice(0, max)
  if (out.length > max || s.length > lines.join(' ').length + 20) lines[lines.length - 1] = fit(`${lines[lines.length - 1] ?? ''}…`, w)
  return lines
}

// Prompts keep blank lines and long words too, so expanding never loses text.
function promptLines(s: string, w: number) {
  const out: string[] = []
  for (let line of s.replace(/\r\n/g, '\n').split('\n')) {
    while (line.length > w) {
      const space = line.lastIndexOf(' ', w)
      const end = space > 0 ? space : w
      out.push(line.slice(0, end))
      line = line.slice(end + (space > 0 ? 1 : 0))
    }
    out.push(line)
  }
  return out
}

// Stop at its next step: its tool calls are refused from now and it is told to wrap up.
async function stopAgent($: $, id: string) {
  const n = (await update($, nodes, list => list.map(x => (x.id === id ? { ...x, stopping: true } : x)))).find(x => x.id === id)
  if (n) $.ui.toast(`■ stopping ${n.label} at its next step`)
}

const sameEdit = (a: EditItem, b: EditItem) => a.file === b.file && a.at === b.at
const settling = new Set<string>()

// Keep or revert a side provider's change. Revert puts back the file as it was before that run,
// and only while the file is still what that run left, so later edits are never thrown away.
async function settle($: $, x: EditItem, how: 'kept' | 'reverted') {
  const k = `${x.file}@${x.at}`
  if (settling.has(k)) return
  settling.add(k)
  try {
    if ((await read($, edits)).find(y => sameEdit(y, x))?.review !== 'pending') return
    if (how === 'reverted') {
      if (!x.repo || !x.path || !x.base || (!x.afterHash && !x.gone)) {
        $.ui.toast(`could not verify ${file(x.file)} · revert it by hand`)
        return
      }
      // A file the run deleted comes back only while nothing has taken its place.
      if (x.gone) {
        if (await $.fs.exists(x.file)) {
          $.ui.toast(`${file(x.file)} exists again since that run · revert it by hand`)
          return
        }
        const r = await $.process.run(['git', '-C', x.repo, 'restore', `--source=${x.base}`, '--worktree', '--', x.path], { timeoutMs: 8000 }).catch(() => undefined)
        if (!r || r.exitCode !== 0) {
          $.ui.toast(`could not restore ${file(x.file)} · still pending`)
          return
        }
        $.ui.toast(`✗ restored ${file(x.file)}`)
        await update($, edits, list => list.map(y => (sameEdit(y, x) ? { ...y, review: how } : y)))
        return
      }
      try {
        const hash = await $.process.run(['git', '-C', x.repo, 'hash-object', '--', x.path], { timeoutMs: 8000 })
        if (hash.exitCode !== 0 || hash.isStdoutTruncated || !hash.stdout.trim()) {
          $.ui.toast(`could not verify ${file(x.file)} · revert it by hand`)
          return
        }
        if (hash.stdout.trim() !== x.afterHash) {
          $.ui.toast(`${file(x.file)} changed since that run · revert it by hand`)
          return
        }
        const r = await $.process.run(x.isNew
          ? ['/bin/rm', '-f', '--', x.file]
          : ['git', '-C', x.repo, 'restore', `--source=${x.base}`, '--worktree', '--', x.path], { timeoutMs: 8000 })
        if (r.exitCode !== 0) {
          $.ui.toast(`could not revert ${file(x.file)} · still pending`)
          return
        }
      } catch {
        $.ui.toast(`could not verify or revert ${file(x.file)} · still pending`)
        return
      }
      $.ui.toast(`✗ reverted ${file(x.file)}`)
    }
    await update($, edits, list => list.map(y => (sameEdit(y, x) ? { ...y, review: how } : y)))
  } finally { settling.delete(k) }
}

function openDetail($: $, id: string) {
  return update($, ui, u => ({ ...u, tab: 'agents' as const, detail: id }))
}

// ---------- frame: title bar and tabs ----------

const TABS: [Tab, string][] = [['dashboard', 'Dashboard'], ['agents', 'Agents'], ['models', 'Models'], ['activity', 'Activity'], ['plugins', 'Plugins'], ['settings', 'Settings']]

const AREA_NAME: Record<Area, string> = { overview: 'Default', work: 'Work', vibe: 'Vibe' }
const SWITCH_BUSY = 'finish or stop the current turn to switch modes'

async function modePreview($: $, E: E, target: Area, busy: boolean) {
  return <E.Box key="area:confirmation" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center" borderStyle="round" borderColor="warning" paddingX={1}>
    <E.Text color="warning" weight="bold">{AREA_NAME[target]} preview</E.Text>
      <E.Button key="area:confirm" plain dimColor={busy} onPress={async () => {
        if (await modeBusy($)) { $.ui.toast(SWITCH_BUSY); return }
        const u = await read($, ui), to = u.pendingArea
        if (!to) return
        const from = u.area ?? 'overview'
        await update($, ui, x => ({ ...x, area: to, pendingArea: undefined }))
        await onAreaChange($, from, to)
        $.ui.invalidate('prompt.section')
      }}>{Chip(E, busy ? 'switch after this turn' : 'Switch', false, 'warning')}</E.Button>
      <E.Button key="area:cancel" plain onPress={() => update($, ui, x => ({ ...x, pendingArea: undefined }))}>{Chip(E, 'Back', false)}</E.Button>
  </E.Box>
}

async function frame($: $, E: E, w: number, cur: Tab) {
  const u = await read($, ui)
  const current = u.area ?? 'overview', area = u.pendingArea ?? current
  const g = await read($, git)
  const m = await read($, main)
  const r = await read($, routing)
  const list = await displayNodes($)
  const busy = await modeBusy($)
  const running = list.filter(n => n.kind !== 'workflow' && stateOf(n, list) === 'running').length
  const pend = (await read($, edits)).filter(x => x.review === 'pending').length
  const l = await read($, live)
  const badge: Partial<Record<Tab, string>> = { agents: running ? String(running) : '', activity: pend ? `◆${pend}` : l ? '·' : '' }
  const ahead = 'error' in g ? 0 : Number(/↑(\d+)/.exec(g.ahead)?.[1] ?? 0)
  const role = r.role === 'claude' ? '· Claude only' : r.worker && r.on[r.worker.provider] && !(r.role === 'plan' && r.worker.provider === 'claude') ? `⇢ ${shortModel(r.worker.model)}` : r.role === 'plan' ? '⇢ plans only' : ''
  return (
    <E.Box flexDirection="column">
      <E.Box flexDirection="column" gap={1}>
      <E.Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" backgroundColor="claude" paddingX={1} gap={1}>
        <E.Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <E.Text color="inverseText" weight="bold" wrap="truncate-end">
            {shortModel(m.model || 'claude')}
            <E.Text color="inverseText">{m.effort ? `  ${m.effort}` : ''}{role ? `   ${role}` : ''}</E.Text>
          </E.Text>
        </E.Box>
        <E.Box flexShrink={1} minWidth={0}>
          <E.Text color="inverseText">{'error' in g ? 'Agent panel' : `⎇ ${g.branch}${ahead ? `  ↑${ahead}` : ''}${g.dirty ? `  ${plural(g.dirty, 'change')}` : '  ✓'}`}</E.Text>
        </E.Box>
      </E.Box>
        <E.Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1} alignItems="center">
          <E.Box flexDirection="row" gap={1}>
          {(['overview', 'work', 'vibe'] as Area[]).map(id => (
            <E.Box key={`area-wrap:${id}`} flexDirection="row">
              <E.Button key={`area:${id}`} plain={id === u.pendingArea ? undefined : true} variant={id === u.pendingArea ? 'secondary' : undefined} onPress={async () => {
                const current = (await read($, ui)).area ?? 'overview'
                await update($, ui, u => ({ ...u, pendingArea: id === current ? undefined : id }))
              }}>
                {Chip(E, AREA_NAME[id].toUpperCase(), id === current)}
              </E.Button>
            </E.Box>
          ))}
          </E.Box>
          <E.Box key="area:current" width={10} flexShrink={0} justifyContent="flex-end"><E.Text color={busy ? 'warning' : 'subtle'} weight={busy ? 'bold' : undefined}>{busy ? '● working' : 'idle'}</E.Text></E.Box>
        </E.Box>
      </E.Box>
      {u.pendingArea ? <E.Box flexDirection="column" marginTop={1}>{await modePreview($, E, u.pendingArea, busy)}</E.Box> : null}
      {area === 'overview' ? <E.Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
        {TABS.map(([id, label]) => (
          <E.Button key={`tab:${id}`} plain onPress={() => update($, ui, u => ({ ...u, tab: id, editing: undefined, detail: undefined }))}>
            {Chip(E, `${label}${badge[id] ? ` ${badge[id]}` : ''}`, id === cur)}
          </E.Button>
        ))}
      </E.Box> : null}
    </E.Box>
  )
}

// ---------- live activity ----------

// Two ways to watch: main, or follow, which shows the box picked in the graph (one at a time) and
// the newest activity while none is picked.
const watchOf = (u: Ui, follow: boolean) => ((u.watch ?? (follow ? 'follow' : 'main')) === 'main' ? 'main' : u.sel)
const pickBox = (key: string) => (u: Ui): Ui => ({ ...u, watch: 'follow', sel: u.sel === key ? undefined : key })

async function activityCard($: $, E: E, w: number, lines: number, agent?: string) {
  const all = await read($, acts)
  const u = await read($, ui)
  const watch = agent ?? watchOf(u, (await read($, guard)).follow)
  const list = await displayNodes($)
  const key = watchKey(all, list, watch)
  const side = list.find(n => key === `node:${n.id}` && n.provider && n.provider !== 'claude' && !n.agentId)
  const liveSide = await read($, sideLive)
  const preview = side?.state === 'running' && side.snap && liveSide?.id === side.id ? liveSide : undefined
  const act: Act | undefined = side ? {
    key: key!, tool: preview?.file ? 'Edit' : `${nameOf(side.provider!)} run`, title: side.input ?? side.label,
    state: side.state, at: side.startedAt ?? 0, endedAt: side.endedAt, output: side.output?.split('\n'),
    ...(preview?.file ? { file: preview.file, startLine: preview.startLine, before: preview.before, old: preview.old, text: preview.text, after: preview.after } : {}),
  } : key ? all[key] : undefined
  const m = await read($, main)
  const frameNo = E.desk ? 0 : await read($, tick)
  const now = await $.clock.now()
  const writer = side ?? (act ? list.find(n => n.id === act.toolUseId) ?? (act.key !== 'main' ? list.find(n => n.agentId === act.key) : undefined) : undefined)
  const color = writer ? colorOf(provOf(writer)) : 'claude'
  const running = act?.state === 'running'
  const inner = Math.max(10, w - 4)
  const picked = u.sel ? list.find(n => (u.sel!.startsWith('node:') ? `node:${n.id}` : n.agentId) === u.sel) : undefined
  const following = watch !== 'main'
  const aside = agent ? undefined : <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
    <E.Button key="watch:follow" plain onPress={() => update($, ui, x => ({ ...x, watch: 'follow' }))}>
      {Chip(E, picked ? `follow · ${fit(picked.provider && picked.provider !== 'claude' ? shortModel(picked.model) : picked.label, 18)}` : 'follow', following, picked ? colorOf(provOf(picked)) : 'claude')}
    </E.Button>
    <E.Button key="watch:main" plain onPress={() => update($, ui, x => ({ ...x, watch: 'main' }))}>{Chip(E, 'main', !following, 'claude')}</E.Button>
    {writer ? <E.Button key="watch:details" plain onPress={() => void openDetail($, writer.id)}><E.Text>details ▸</E.Text></E.Button> : null}
  </E.Box>
  return Fold($, E, u.folded ?? {}, 'live', 'LIVE', act ? color : 'inactive', () => {
    if (!act) return <E.Text dimColor>no activity</E.Text>
    const body: any[] = []
    if (side?.snap && running) {
      if (!preview?.files.length) body.push(<E.Text key="side:empty" dimColor>no file changes</E.Text>)
      else {
        body.push(<E.Text key="side:count" weight="bold">changed so far: {plural(preview.files.length, 'file')}</E.Text>)
        preview.files.slice(0, 6).forEach((f, i) => body.push(<E.Text key={`side:file:${i}`} wrap="truncate-end">
          <E.Text color="success">+{f.added}</E.Text><E.Text color="error"> −{f.removed}</E.Text><E.Text> {f.path}{f.isNew ? ' new' : ''}</E.Text>
        </E.Text>))
      }
    }
    if (['Edit', 'Write', 'NotebookEdit'].includes(act.tool)) {
      const start = act.startLine ?? 1
      const text = act.text === '' ? [] : (act.text ?? '').split('\n')
      const before = (act.before ?? []).map((t, i) => ({ text: t, line: start - (act.before?.length ?? 0) + i, kind: 'context' }))
      const old = (act.old ?? []).map((t, i) => ({ text: t, line: start + i, kind: 'old' }))
      const added = text.map((t, i) => ({ text: t, line: start + i, kind: 'new' }))
      const after = (act.after ?? []).map((t, i) => ({ text: t, line: start + text.length + i, kind: 'context' }))
      const rows = [...before, ...old, ...added, ...after]
      const end = before.length + old.length + added.length
      const from = Math.max(0, end - Math.max(1, lines - 1))
      rows.slice(from, from + Math.max(1, lines - 1)).forEach((r, i) => body.push(
        <E.Text key={`act:line:${i}`} wrap="truncate-end">
          <E.Text dimColor>{String(r.line).padStart(3)} </E.Text>
          <E.Text color={r.kind === 'old' ? 'error' : r.kind === 'new' ? 'success' : undefined} dimColor={r.kind === 'context' ? true : undefined}>
            {r.kind === 'old' ? '− ' : r.kind === 'new' ? '+ ' : '  '}{fit(r.text.replace(/\t/g, '  '), inner - 8) || ' '}
          </E.Text>
          {running && from + i === end - 1 ? <E.Text color="success">{frameNo % 4 < 2 ? '▍' : ' '}</E.Text> : null}
        </E.Text>
      ))
    } else {
      if (!(side && agent && side.input)) body.push(<E.Text key="act:title" weight="bold" wrap="truncate-end">{act.tool === 'Bash' ? '$ ' : ''}{fit(act.title, inner - (act.tool === 'Bash' ? 2 : 0))}</E.Text>)
      if (!running && !(side && agent)) (act.output ?? []).slice(-Math.max(0, lines - 2)).forEach((t, i) => body.push(<E.Text key={`act:out:${i}`} dimColor wrap="truncate-end">{fit(t, inner)}</E.Text>))
    }
    return <E.Box flexDirection="column">
      <E.Text wrap="truncate-end">
        <E.Text color={color} weight="bold">{nodeModel(writer ?? { model: m.model || 'claude', effort: m.effort })}{writer && !side ? ` · ${writer.label}` : writer ? '' : ' · main'}</E.Text>
        <E.Text color={running ? color : act.state === 'failed' ? 'error' : 'success'}> {running ? E.desk ? '●' : SPIN[frameNo % SPIN.length] : act.state === 'failed' ? '✗' : '✓'} {running && !E.desk ? `${clock(now - act.at)} ` : ''}</E.Text>
        <E.Text>{act.tool}{['Edit', 'Write', 'NotebookEdit'].includes(act.tool) ? ` · ${act.title}` : ''}</E.Text>
      </E.Text>
      {body}
    </E.Box>
  }, { width: w, aside })
}

// ---------- dashboard ----------

function churnRows(E: E, list: EditItem[], w: number, max = 4) {
  const byFile = new Map<string, { file: string; added: number; removed: number; order: number }>()
  list.forEach((x, i) => {
    const prev = byFile.get(x.file)
    byFile.set(x.file, { file: x.file, added: (prev?.added ?? 0) + (x.added ?? 0), removed: (prev?.removed ?? 0) + (x.removed ?? 0), order: i })
  })
  const rows = [...byFile.values()].sort((a, b) => b.order - a.order).slice(0, max)
  const cells = Math.max(4, Math.min(24, w - 29))
  const most = Math.max(1, ...rows.map(r => r.added + r.removed))
  return rows.map((r, i) => {
    const k = Math.max(1, Math.round(((r.added + r.removed) / most) * cells))
    const plus = r.added + r.removed ? Math.round((k * r.added) / (r.added + r.removed)) : 0
    return (
      <E.Text key={`churn:${r.file}`} wrap="truncate-end">
        <E.Text weight={i === 0 ? 'bold' : undefined}>{padR(file(r.file), 18)}</E.Text>
        <E.Text color="success">{'━'.repeat(plus)}</E.Text>
        <E.Text color="error">{'╍'.repeat(k - plus)}</E.Text>
        <E.Text>{' '.repeat(cells - k)}</E.Text>
        <E.Text color="success">{`+${r.added}`.padStart(5)}</E.Text>
        <E.Text color="error">{` −${r.removed}`.padEnd(5)}</E.Text>
      </E.Text>
    )
  })
}

const idleArt = (E: E, w: number, note: string) => <E.Text key="idle" dimColor>no activity</E.Text>

const svgEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const svgColor = (color: string) => ({ claude: '#d97757', success: '#73c991', warning: '#e5c07b', error: '#f48771' }[color] ?? color)
const svgText = '<style>text{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#24292f}.detail{font-size:12px;fill:#656d76}@media(prefers-color-scheme:dark){text{fill:#e6e6e6}.detail{fill:#a0a0a0}}</style>'
const quotaState = (info: Providers[Provider], p: Provider, r: Routing) => r.paused?.[p] ? `paused · back ${new Date(r.paused[p]!.until).toTimeString().slice(0, 5)}` : p === 'antigravity' && agyQuotaLine(r) || (info.alert ? 'quota hit' : '')

// Wide panes align quota windows; an unspecified limit never reuses stale remaining bars.
// `open` makes each provider's rows a way into its page; providers that are not installed are named, not hidden.
function usageChart(E: E, all: Providers, r: Routing, w: number, now: number, open?: (p: Provider) => unknown) {
  const gone = r.order.filter(p => all[p].status === 'missing')
  const goneRow = gone.length ? <E.Box key="usage:missing" flexDirection="row" gap={1} flexWrap="wrap">
    <E.Text dimColor>not installed here:</E.Text>
    {gone.map(p => open ? <E.Button key={`usage:open:${p}`} plain onPress={() => open(p)}><E.Text dimColor>{nameOf(p)} ▸</E.Text></E.Button> : <E.Text key={`usage:gone:${p}`} dimColor>{nameOf(p)}</E.Text>)}
  </E.Box> : null
  const windowOrder: Record<string, number> = { '5-hour': 0, Weekly: 1, Monthly: 2 }
  const groups = (['claude', ...r.order] as Provider[]).filter(p => all[p].status !== 'missing').map(p => {
    const info = all[p], off = p !== 'claude' && !r.on[p] && !r.paused?.[p] && !info.alert, state = off ? 'off' : quotaState(info, p, r)
    const windows = info.meters.filter(m => m.label !== 'Context').sort((a, b) => (windowOrder[a.label] ?? 3) - (windowOrder[b.label] ?? 3))
    const blocked = !!r.paused?.[p] || !!info.alert && !windows.some(m => m.limited || m.percent >= 100)
    const meters = off || blocked ? [] : windows
    return { p, state, blocked, color: off ? '#858585' : svgColor(colorOf(p)), meters: meters.map(m => ({
      window: m.label === '5-hour' ? '5h' : m.label === 'Weekly' ? 'week' : m.label === 'Monthly' ? 'month' : m.label,
      used: m.limited ? 100 : m.percent,
      percent: m.limited || m.percent >= 100 ? 'empty' : `${p === 'opencode' && info.usageSource !== 'live' ? '≈' : ''}${Math.round(Math.max(0, 100 - m.percent))}% left`,
      detail: [usageDetail(m.limited || m.percent >= 100 ? m.detail?.split(' · ').filter(d => /reset|back/.test(d)).join(' · ') : m.detail).replace(/ of (.*?) credits used/, '/$1 cr used').replace(/resets in /g, 'resets '), usageAge(info, now)].filter(Boolean).join(' · '),
    })) }
  }).filter(g => g.meters.length || g.state)
  if (!groups.length) return goneRow ?? <E.Text dimColor>no activity</E.Text>
  if (E.desk) {
    const width = Math.min(graphicWidth(E, 4), w * 8), wide = w >= 96
    let y = 0
    const rows = groups.map(g => {
      const color = g.color, name = svgEscape(nameOf(g.p))
      if (!g.meters.length) {
        const top = y, error = g.blocked ? svgColor('error') : color
        y += g.blocked ? 54 : 34
        return `<text x="0" y="${top + 18}" style="fill:${error}">${name} · ${svgEscape(g.state)}</text>${g.blocked ? `<rect y="${top + 27}" width="${width}" height="12" rx="4" fill="url(#quota-empty)" stroke="${error}"/>` : ''}`
      }
      const alert = g.state ? `<text x="0" y="${y + 18}" style="fill:${svgColor('error')}">${name} · ${svgEscape(g.state)}</text>` : ''
      if (alert) y += 26
      if (wide) {
        const top = y, gap = 18, start = 122, cell = (width - start - gap * (g.meters.length - 1)) / g.meters.length
        y += 76
        return alert + (g.state ? '' : `<text x="0" y="${top + 20}" style="fill:${color}" font-weight="bold">${name}</text>`) + g.meters.map((m, i) => {
          const x = start + i * (cell + gap), fill = cell * Math.max(0, Math.min(100, 100 - m.used)) / 100, tint = m.used >= 100 ? svgColor('error') : color
          return `<g><title>${svgEscape(`${name} · ${m.window} · ${m.percent} · ${m.detail}`)}</title><text x="${x}" y="${top + 18}">${svgEscape(m.window)} · ${svgEscape(m.percent)}</text><rect x="${x}" y="${top + 27}" width="${cell}" height="12" rx="4" fill="${m.used >= 100 ? 'url(#quota-empty)' : tint}" opacity="${m.used >= 100 ? 1 : .16}"/><rect x="${x}" y="${top + 27}" width="${fill}" height="12" rx="4" fill="${tint}"/><text class="detail" x="${x}" y="${top + 58}">${svgEscape(fit(m.detail, Math.floor(cell / 7.3)))}</text></g>`
        }).join('')
      }
      return alert + g.meters.map(m => {
        const top = y, tint = m.used >= 100 ? svgColor('error') : color
        y += 68
        return `<g><title>${svgEscape(`${name} · ${m.window} · ${m.percent} · ${m.detail}`)}</title><text x="0" y="${top + 18}" font-weight="bold" style="fill:${color}">${name} · ${svgEscape(m.window)}</text><text x="${width}" y="${top + 18}" text-anchor="end">${svgEscape(m.percent)}</text><rect y="${top + 27}" width="${width}" height="12" rx="4" fill="${m.used >= 100 ? 'url(#quota-empty)' : tint}" opacity="${m.used >= 100 ? 1 : .16}"/><rect y="${top + 27}" width="${width * Math.max(0, Math.min(100, 100 - m.used)) / 100}" height="12" rx="4" fill="${tint}"/><text class="detail" x="0" y="${top + 56}">${svgEscape(fit(m.detail, Math.floor(width / 7.3)))}</text></g>`
      }).join('')
    }).join('')
    const alt = groups.map(g => `${nameOf(g.p)} ${[g.state, ...g.meters.map(m => `${m.window}: ${m.percent}, ${m.detail}`)].filter(Boolean).join('; ')}`).join('; ')
    const hatch = '<defs><pattern id="quota-empty" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke="#f48771" opacity=".45"/></pattern></defs>'
    const chart = <E.Svg key="usage:chart" source={`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}">${svgText}${hatch}${rows}</svg>`} width={width} height={y} alt={alt} />
    if (!open && !goneRow) return chart
    return <E.Box flexDirection="column" gap={1}>
      {chart}
      {open ? <E.Box key="usage:openers" flexDirection="row" gap={2} flexWrap="wrap">{groups.map(g => <E.Button key={`usage:open:${g.p}`} plain onPress={() => open(g.p)}><E.Text color={colorOf(g.p)}>{nameOf(g.p)} ▸</E.Text></E.Button>)}</E.Box> : null}
      {goneRow}
    </E.Box>
  }
  const windowW = Math.max(5, ...groups.flatMap(g => g.meters.map(m => m.window.length)))
  const bw = Math.max(10, w - 30 - (windowW - 5))
  // One press on a provider's row opens its page; without `open` the rows are plain text.
  const row = (key: string, p: Provider, children: unknown[]) => open
    ? <E.Button key={`usage:open:${key}`} plain onPress={() => open(p)}><E.Text wrap="truncate-end">{children}</E.Text></E.Button>
    : <E.Text wrap="truncate-end">{children}</E.Text>
  return <E.Box flexDirection="column">{groups.map(g => <E.Box key={`usage:${g.p}`} flexDirection="column">
    {g.state ? row(g.p, g.p, [<E.Text key="s" color={g.blocked || g.meters.length ? 'error' : 'inactive'}>{nameOf(g.p)} · {g.state}</E.Text>]) : null}
    {g.blocked ? <E.Text color="error">{bar(0, w)}</E.Text> : null}
    {g.meters.map(m => <E.Box key={`usage:${g.p}:${m.window}`} flexDirection="column">
      {row(`${g.p}:${m.window}`, g.p, [<E.Text key="n" color={colorOf(g.p)}>{padR(nameOf(g.p), 13)} {padR(m.window, windowW)} </E.Text>, <E.Text key="b" color={m.used >= 100 ? 'error' : colorOf(g.p)}>{bar(100 - m.used, bw)}</E.Text>, ` ${m.percent}`])}
      {m.detail ? <E.Text dimColor wrap="truncate-end">  {m.detail}</E.Text> : null}
    </E.Box>)}
  </E.Box>)}{goneRow}</E.Box>
}

// With `onPress` the tile's label is the way to what it counts.
function tile(E: E, key: string, label: string, value: string, color: string, width: number, onPress?: () => unknown) {
  const big = bigText(value)
  return (
    <E.Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={E.desk ? undefined : width} flexGrow={E.desk ? 1 : undefined} alignItems="center">
      {E.desk ? <E.Text color={color} size="title" weight="bold" tabular>{value}</E.Text> : big.map((l, i) => <E.Text key={`${key}${i}`} color={color} weight="bold">{l}</E.Text>)}
      {onPress ? <E.Button key={`${key}:open`} plain onPress={onPress}><E.Text dimColor>{label}</E.Text></E.Button> : <E.Text dimColor>{label}</E.Text>}
    </E.Box>
  )
}

// Lines written and deleted share one tile, one above the other, each drawn like any tile's number.
function linesTile(E: E, added: number, removed: number, width: number, onPress?: () => unknown) {
  const parts = [[`+${added}`, 'success'], [`−${removed}`, 'error']] as const
  return (
    <E.Box key="tile:lines" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} width={E.desk ? undefined : width} flexGrow={E.desk ? 1 : undefined} alignItems="center">
      {parts.map(([v, c]) => E.desk ? <E.Text key={`lines:${c}`} color={c} size="title" weight="bold" tabular>{v}</E.Text>
        // Big digits while they fit the tile; longer totals as plain bold text.
        : bigText(v)[0].length > width - 4 ? <E.Text key={`lines:${c}`} color={c} weight="bold">{v}</E.Text>
        : bigText(v.replace('−', '-')).map((l, i) => <E.Text key={`lines:${c}${i}`} color={c} weight="bold">{l}</E.Text>))}
      {onPress ? <E.Button key="tile:lines:open" plain onPress={onPress}><E.Text dimColor>lines written / deleted</E.Text></E.Button> : <E.Text dimColor>lines written / deleted</E.Text>}
    </E.Box>
  )
}

// Agents grouped into runs: a workflow run, or the agents one chat turn started.
export function runsOf(list: AgentNode[], now: number) {
  const by = new Map<string, AgentNode[]>()
  const runOf = (n: AgentNode) => n.run ?? (n.kind === 'workflow' ? n.id : n.parentNode?.startsWith('wf:') ? n.parentNode : 'earlier')
  for (const n of list) by.set(runOf(n), [...(by.get(runOf(n)) ?? []), n])
  return [...by.entries()].map(([id, ns]) => {
    const real = ns.filter(n => n.kind !== 'workflow')
    const group = ns.find(n => n.kind === 'workflow' && n.id === id)
    const running = real.some(n => stateOf(n, list) === 'running')
    const failed = real.some(n => n.state === 'failed')
    const first = [...real].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))[0]
    const label = group && group.label !== 'Workflow' ? group.label : id === 'earlier' ? 'Earlier work' : (first?.label ?? 'Chat turn').replace(/^(scout|plan|build|verify)\w*[:\s]+/i, '')
    const start = Math.min(...ns.map(n => n.startedAt ?? now))
    const end = running ? now : Math.max(...ns.map(n => n.endedAt ?? n.startedAt ?? now))
    return { id, label, nodes: ns, agents: real.length, running, failed, start, end }
  }).sort((a, b) => b.start - a.start)
}

// The run on show: a pinned one, else one still running, else this chat turn's own; between
// turns, the last one. A new turn without agents shows none, so old work stays under earlier runs.
export function pickRun(runs: ReturnType<typeof runsOf>, m: MainInfo, pinned?: string) {
  const p = pinned ? runs.find(r => r.id === pinned) : undefined
  return p ?? runs.find(r => r.running) ?? (m.working ? runs.find(r => r.start >= (m.since ?? Infinity)) : runs[0])
}

function stagesCard($: $, E: E, all: AgentNode[], folded: Record<string, boolean>, w: number, now: number, spin: string, m: MainInfo, pinned?: string) {
  const runs = runsOf(all, now)
  const live = pickRun(runs, m)
  const cur = pickRun(runs, m, pinned)
  const list = cur ? cur.nodes : []
  const st = stagesOf(list, all)
  const glyph = (x: Stage) => (x.state === 'running' ? spin : x.state === 'done' ? '✓' : '✗')
  const gcolor = (x: Stage) => (x.state === 'running' ? x.color : x.state === 'done' ? 'success' : 'error')
  // The stepper: every stage when they fit, else the newest after a "…".
  const room = Math.max(1, Math.floor((w + 4) / 16))
  const steps = st.slice(-room)
  const cut = st.length > steps.length
  const nameW = Math.min(18, Math.max(6, Math.floor((w - (cut ? 3 : 0) - 6 * Math.max(0, steps.length - 1)) / Math.max(1, steps.length)) - 2))
  const used = steps.reduce((t, x) => t + 2 + Math.min(nameW, x.name.length), 0) + (cut ? 3 : 0)
  const seg = Math.max(2, Math.min(14, Math.floor((w - used) / Math.max(1, steps.length - 1)) - 2))
  const maxSteps = Math.max(1, ...list.map(n => n.steps))
  const agents = st.reduce((t, x) => t + x.nodes.length, 0)
  const allDone = st.length > 0 && st.every(x => x.state !== 'running') && !m.working
  const failedAny = st.some(x => x.state === 'failed')
  const firstStart = Math.min(...st.map(x => x.start))
  const lastEnd = Math.max(...st.map(x => x.end ?? now))
  return Fold($, E, folded, 'stages', 'STAGES', allDone ? (failedAny ? 'warning' : 'success') : 'claude', () => (
    <E.Box flexDirection="column">
      {m.working ? (
        <E.Text wrap="truncate-end">
          <E.Text color="claude" weight="bold">{spin} ◆ Claude is working</E.Text>
          <E.Text color="claude">  {shortModel(m.model || 'claude')}</E.Text>
          {m.since && !E.desk ? <E.Text dimColor>  {clock(now - m.since)}</E.Text> : null}
          {m.lastTool ? <E.Text dimColor>  · {m.lastTool.replace(/^mcp__.+?__/, '')}{m.trail?.length && m.trail[m.trail.length - 1]!.arg ? ` · ${fit(m.trail[m.trail.length - 1]!.arg!, 40)}` : ''}</E.Text> : null}
        </E.Text>
      ) : allDone ? (
        <E.Text wrap="truncate-end">
          <E.Text {...filled(E, failedAny ? 'warning' : 'success')} weight="bold">{failedAny ? ' ✓ Done, with failures ' : ' ✓ All done '}</E.Text>
          <E.Text dimColor>  {agents} agent{agents === 1 ? '' : 's'} · {st.length} stage{st.length > 1 ? 's' : ''} · {clock(lastEnd - firstStart)}</E.Text>
        </E.Text>
      ) : null}
      {steps.length ? <E.Text wrap="truncate-end">
        {cut ? <E.Text dimColor>… </E.Text> : ''}
        {steps.map((x, i) => (
          <E.Text key={`step:${x.key}`}>
            {i ? <E.Text color={x.color} dimColor={x.state === 'running' ? undefined : true}>{` ${'━'.repeat(seg)} `}</E.Text> : ''}
            <E.Text color={gcolor(x)} weight="bold">{glyph(x)} </E.Text>
            <E.Text color={x.color} weight={x.state === 'running' ? 'bold' : undefined}>{fit(x.name, nameW)}</E.Text>
          </E.Text>
        ))}
      </E.Text> : null}
      {st.map(x => {
        const key = `stage:${x.key}`
        const open = folded[key] === undefined ? x.state === 'running' : !folded[key]
        const total = x.nodes.length
        const finished = x.nodes.filter(n => stateOf(n, all) !== 'running').length
        const barW = Math.max(6, Math.min(16, w - 60))
        const rows = buildTree(list, new Set(x.nodes.map(n => n.id))).slice(0, 12)
        return (
          <E.Box key={key} flexDirection="column" marginTop={1}>
            <E.Box flexDirection="row" alignItems="center" gap={1}>
              <E.Button key={`fold:${key}`} plain onPress={() => update($, ui, u => ({ ...u, folded: { ...(u.folded ?? {}), [key]: open } }))}><E.Text color={x.color}>{open ? '▾' : '▸'}</E.Text></E.Button>
              <E.Text wrap="truncate-end"><E.Text color={x.color}>{glyph(x)} </E.Text><E.Text weight={x.state === 'running' ? 'bold' : undefined}>{padR(x.name, Math.max(10, w - barW - (E.desk ? 22 : 19)))}</E.Text><E.Text color={x.state === 'failed' ? 'error' : x.color}> {bar((100 * finished) / Math.max(1, total), barW)}</E.Text><E.Text dimColor> {padL(`${finished}/${total}`, 5)} {x.state === 'running' && E.desk ? '' : padL(clock((x.end ?? now) - x.start), 6)}</E.Text></E.Text>
            </E.Box>
            {open
              ? rows.map(row => {
                  const n = row.node
                  const said = (n.output ?? '').split('\n').map(t => t.trim()).find(Boolean)
                  return (
                    <E.Box key={`srow:${n.id}`} flexDirection="column">
                      {treeRow($, E, { ...row, prefix: `  ${row.prefix}` }, list, w, now, spin, now, maxSteps, 'compact')}
                      {said && row.state !== 'running' ? (
                        <E.Text dimColor wrap="truncate-end">{`  ${row.prefix.replace(/[├╰]─$/, row.prefix.endsWith('├─') ? '│ ' : '  ')}   ↳ `}{fit(said, Math.max(10, w - row.prefix.length - 9))}</E.Text>
                      ) : null}
                    </E.Box>
                  )
                })
              : null}
          </E.Box>
        )
      })}
      {!st.length && !m.working ? <E.Text dimColor>no agents this turn</E.Text> : null}
      {earlierRuns($, E, all, w, now, m, pinned)}
    </E.Box>
  ), {
    aside: (
      <E.Box flexDirection="row" gap={2}>
        {cur ? <E.Text color="claude" weight="bold">{fit(cur.label, 34)}</E.Text> : null}
        {cur && cur !== live ? (
          <E.Button key="run:live" plain onPress={() => update($, ui, u => ({ ...u, run: undefined }))}><E.Text color="suggestion">◂ live</E.Text></E.Button>
        ) : (
          <E.Text dimColor>{st.length ? `${st.filter(x => x.state !== 'running').length}/${st.length} stages done` : ''}</E.Text>
        )}
      </E.Box>
    ),
  })
}

// One connector row: a trunk at column `indent + 1` branching to the centre of each box below it.
export const connector = (count: number, width: number, gap: number, isLast: boolean, indent = 0) => {
  const centres = Array.from({ length: count }, (_, i) => indent + 3 + i * (width + gap) + Math.floor(width / 2))
  const end = centres[centres.length - 1] ?? indent + 2
  const row = Array.from({ length: end + 1 }, () => ' ')
  row[indent + 1] = isLast ? '╰' : '├'
  for (let x = indent + 2; x < end; x++) row[x] = '─'
  for (const c of centres) row[c] = '┬'
  row[end] = count === 1 ? '╮' : '┐'
  return row.join('')
}

// An agent as a box: status and name, the exact model, progress, and its own helpers.
function nodeBox($: $, E: E, n: AgentNode, all: AgentNode[], width: number, now: number, spin: string, maxSteps: number, watching = false, watch?: string) {
  const st = stateOf(n, all)
  const p = provOf(n)
  const running = st === 'running'
  const icon = n.kind === 'workflow' ? '◇' : running ? spin : st === 'done' ? '✓' : '✗'
  const kids = all.filter(k => k.parentNode === n.id)
  // The side provider it handed its task to, newest first: that is who did the work.
  const ext = [...kids].reverse().find(k => provOf(k) !== 'claude')
  const inner = Math.max(8, width - 4)
  // Desktop has no tick to move a running clock, so it shows none rather than a frozen one.
  const took = running && E.desk ? '' : clock((running ? now : n.endedAt ?? now) - (n.startedAt ?? now))
  const fill = st === 'done' ? 100 : (100 * n.steps) / Math.max(1, maxSteps)
  const key = n.agentId ?? (n.provider && n.provider !== 'claude' ? `node:${n.id}` : undefined)
  const selected = watching && !!key && watch === key
  return (
    <E.Box key={`gbox:${n.id}`} width={width} flexDirection="column" borderStyle={(watching ? selected : running) ? 'bold' : 'round'} borderColor={running ? colorOf(p) : st === 'failed' ? 'error' : colorOf(p)} borderDimColor={selected || running || st === 'failed' ? undefined : true} paddingX={1}>
      <E.Button key={`gopen:${n.id}`} plain onPress={() => watching && key ? update($, ui, pickBox(key)) : openDetail($, n.id)}>
        <E.Text color={running ? colorOf(p) : st === 'done' ? 'success' : 'error'} weight="bold">{icon} </E.Text>
        <E.Text weight={running ? 'bold' : undefined}>{fit(n.label || n.kind, inner - 2)}</E.Text>
      </E.Button>
      {n.offRoute ? <E.Text key={`off-route:${n.id}`} color="warning">off-route</E.Text> : null}
      {ext ? (
        <E.Text wrap="truncate-end">
          <E.Text color={colorOf(p)} dimColor>● {nodeModel(n)} ⇢ </E.Text>
          <E.Text color={colorOf(provOf(ext))} weight="bold">{fit(nodeModel(ext), Math.max(4, inner - nodeModel(n).length - 6))}</E.Text>
        </E.Text>
      ) : (
        <E.Text wrap="truncate-end" color={colorOf(p)}>● {fit(nodeModel(n), inner - 2)}</E.Text>
      )}
      <E.Text wrap="truncate-end">
        <E.Text color={st === 'failed' ? 'error' : colorOf(p)}>{pips(fill, Math.max(3, Math.min(8, inner - 8)))}</E.Text>
        <E.Text dimColor> {took}</E.Text>
      </E.Text>
      {running && n.agentId ? (
        <E.Button key={`stop:${n.id}`} plain onPress={() => void stopAgent($, n.id)}>
          <E.Text color={n.stopping ? 'inactive' : 'error'}>{n.stopping ? '■ stopping…' : '■ stop'}</E.Text>
        </E.Button>
      ) : null}
      <E.Text wrap="truncate-end" dimColor>
        {kids.length ? `↳ ${kids.map(k => `${stateOf(k, all) === 'running' ? spin : stateOf(k, all) === 'done' ? '✓' : '✗'} ${shortModel(k.model)}`).join(' ')}` : running && n.lastTool ? `· ${n.lastTool.replace(/^mcp__.+?__/, '')}` : n.steps ? `${plural(n.steps, 'step')}` : n.kind}
      </E.Text>
      {n.dir ? <E.Text wrap="truncate-end" dimColor>{n.dir}</E.Text> : null}
    </E.Box>
  )
}

// Boxes in rows under one parent, each row reached by a connector from the trunk.
function boxRows($: $, E: E, ns: AgentNode[], all: AgentNode[], avail: number, indent: number, lastGroup: boolean, now: number, spin: string, maxSteps: number, watching = false, watch?: string) {
  const G = 1
  const per = Math.max(1, Math.min(5, Math.floor((avail - 3 - indent + G) / (24 + G))))
  const W = Math.max(18, Math.floor((avail - 3 - indent - G * (per - 1)) / per))
  const chunks: AgentNode[][] = []
  for (let i = 0; i < ns.length; i += per) chunks.push(ns.slice(i, i + per))
  return chunks.map((row, r) => {
    const isLast = lastGroup && r === chunks.length - 1
    return (
      <E.Box key={`grow:${indent}:${row[0]!.id}`} flexDirection="column">
        <E.Text dimColor>{connector(row.length, W, G, isLast, indent)}</E.Text>
        <E.Box flexDirection="row">
          <E.Text dimColor>{`${' '.repeat(indent)}${isLast ? '   ' : ' │ '}`}</E.Text>
          <E.Box flexDirection="row" gap={G}>{row.map(n => nodeBox($, E, n, all, W, now, spin, maxSteps, watching, watch))}</E.Box>
        </E.Box>
      </E.Box>
    )
  })
}

// The live run as a drawn graph: main chat on top, branches to each agent's box, workflows with their own branch.
// `full` draws every agent and workflow (the Agents tab); the dashboard card keeps to the first few.
function graphView($: $, E: E, all: AgentNode[], folded: Record<string, boolean>, w: number, now: number, spin: string, m: MainInfo, pinned?: string, full = false, watching = false, watch?: string) {
  const runs = runsOf(all, now)
  const picked = pickRun(runs, m, pinned) ?? { id: 'none', label: 'this turn', nodes: [] as AgentNode[], running: false }
  const showAll = folded['graph:all'] === false
  const cur = showAll ? { ...picked, label: 'all runs', nodes: all, running: runs.some(r => r.running) } : picked
  const ids = new Set(cur.nodes.map(n => n.id))
  const order = (xs: AgentNode[]) => [...xs].sort((a, b) => (stateOf(a, all) === 'running' ? 0 : 1) - (stateOf(b, all) === 'running' ? 0 : 1) || (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const tops = order(cur.nodes.filter(n => !n.parentNode || !ids.has(n.parentNode)))
  const leaves = tops.filter(n => n.kind !== 'workflow' && !all.some(k => k.parentNode === n.id))
  const allGroups = tops.filter(n => !leaves.includes(n))
  const groups = full ? allGroups : allGroups.slice(0, 4)
  const per = full ? 60 : 15
  const maxSteps = Math.max(1, ...cur.nodes.map(n => n.steps))
  const c = counts(cur.nodes.filter(n => n.kind !== 'workflow'), all)
  const rootW = Math.min(w, 34)
  const hidden = leaves.length - Math.min(per, leaves.length) + allGroups.length - groups.length
  const body = (
    <E.Box flexDirection="column">
      <E.Box flexDirection="column" borderStyle={(watching ? watch === 'main' : m.working) ? 'bold' : 'round'} borderColor="claude" paddingX={1} width={rootW}>
        {watching ? <E.Button key="gopen:main" plain onPress={() => update($, ui, u => ({ ...u, watch: 'main' }))}><E.Text color="claude" weight="bold" wrap="truncate-end">{m.working ? spin : '◆'} main · {shortModel(m.model || 'claude')}</E.Text></E.Button> : <E.Text color="claude" weight="bold" wrap="truncate-end">{m.working ? spin : '◆'} main · {shortModel(m.model || 'claude')}</E.Text>}
        <E.Text dimColor wrap="truncate-end">{m.effort ? `${m.effort} · ` : ''}{countText(c, spin) || (m.working && m.steps ? `· ${m.lastTool ?? ''} · ${m.steps} steps` : 'no agents')}</E.Text>
      </E.Box>
      {!cur.nodes.length && m.trail?.length ? mainTrail(E, m, w, now, spin) : null}
      {leaves.length ? boxRows($, E, leaves.slice(0, per), all, w, 0, !groups.length, now, spin, maxSteps, watching, watch) : null}
      {groups.map((g, gi) => {
        const isLast = gi === groups.length - 1
        const kids = order(all.filter(k => k.parentNode === g.id)).slice(0, per)
        const gs = stateOf(g, all)
        const gc = counts(all.filter(k => k.parentNode === g.id), all)
        return (
          <E.Box key={`ggroup:${g.id}`} flexDirection="column">
            <E.Text dimColor>{isLast ? ' ╰─╮' : ' ├─╮'}</E.Text>
            <E.Box flexDirection="row">
              <E.Text dimColor>{isLast ? '   ' : ' │ '}</E.Text>
              <E.Box flexDirection="column" borderStyle={(watching ? !!g.agentId && watch === g.agentId : gs === 'running') ? 'bold' : 'round'} borderColor={gs === 'running' ? 'warning' : gs === 'failed' ? 'error' : 'success'} paddingX={1}>
                <E.Button key={`gopen:${g.id}`} plain onPress={() => watching && g.agentId ? update($, ui, pickBox(g.agentId)) : openDetail($, g.id)}>
                  <E.Text color={gs === 'running' ? 'warning' : 'success'} weight="bold">{g.kind === 'workflow' ? '◇' : gs === 'running' ? spin : '✓'} {fit(g.label, Math.max(10, w - 30))}</E.Text>
                  <E.Text dimColor>  {g.kind === 'workflow' ? 'workflow' : shortModel(g.model)} · {countText(gc, spin)}</E.Text>
                </E.Button>
                {g.offRoute ? <E.Text key={`off-route:${g.id}`} color="warning">off-route</E.Text> : null}
                {gs === 'running' && g.agentId ? <E.Button key={`stop:${g.id}`} plain onPress={() => void stopAgent($, g.id)}><E.Text color={g.stopping ? 'inactive' : 'error'}>{g.stopping ? '■ stopping…' : '■ stop'}</E.Text></E.Button> : null}
              </E.Box>
            </E.Box>
            {boxRows($, E, kids, all, w, 3, true, now, spin, maxSteps, watching, watch)}
          </E.Box>
        )
      })}
      {hidden > 0 ? <E.Text dimColor>{'   '}+{hidden} more · the Agents tab draws them all</E.Text> : null}
    </E.Box>
  )
  const aside = (
    <E.Box flexDirection="row" gap={2}>
      <E.Text dimColor>{fit(cur.label, 30)}{countText(c, spin) ? ` · ${countText(c, spin)}` : ''}</E.Text>
      {runs.length > (picked.id === 'none' ? 0 : 1) ? (
        <E.Button key="graph:all" plain onPress={() => update($, ui, u => ({ ...u, folded: { ...(u.folded ?? {}), 'graph:all': showAll } }))}>
          {Chip(E, showAll ? '◉ all runs' : '○ earlier runs', showAll, 'suggestion')}
        </E.Button>
      ) : null}
    </E.Box>
  )
  return { body, aside, running: cur.running }
}

// Claude's own tool calls this turn, newest first, so the graph shows work even with no subagents.
function mainTrail(E: E, m: MainInfo, w: number, now: number, spin: string) {
  const rows = [...(m.trail ?? [])].reverse().slice(0, 8)
  return (
    <E.Box flexDirection="column">
      <E.Text dimColor>{' │'}</E.Text>
      {rows.map((t, i) => {
        const live = i === 0 && m.working
        return (
          <E.Text key={`mtrail:${t.at}:${i}`} wrap="truncate-end">
            <E.Text dimColor>{i === rows.length - 1 ? ' ╰─ ' : ' ├─ '}</E.Text>
            <E.Text color={live ? 'claude' : 'success'} weight={live ? 'bold' : undefined}>{live ? spin : '✓'} </E.Text>
            <E.Text color={live ? 'claude' : undefined} weight={live ? 'bold' : undefined} dimColor={live ? undefined : true}>{padR(t.tool, 10)}</E.Text>
            <E.Text dimColor={live ? undefined : true}> {fit(t.arg ?? '', Math.max(10, w - 26))}</E.Text>
            <E.Text dimColor> {padL(ago(now - t.at), 4)}</E.Text>
          </E.Text>
        )
      })}
    </E.Box>
  )
}

function graphCard($: $, E: E, all: AgentNode[], folded: Record<string, boolean>, w: number, now: number, spin: string, m: MainInfo, pinned?: string, watch?: string) {
  const g = graphView($, E, all, folded, w, now, spin, m, pinned, false, true, watch)
  return Fold($, E, folded, 'graph', 'GRAPH', g.running ? 'warning' : 'suggestion', () => g.body, { aside: g.aside })
}

function earlierRuns($: $, E: E, all: AgentNode[], w: number, now: number, m: MainInfo, pinned?: string) {
  const runs = runsOf(all, now)
  const cur = pickRun(runs, m, pinned)
  const rest = runs.filter(r => r !== cur).slice(0, 8)
  if (!rest.length) return null
  return (
    <E.Box key="earlier-runs" flexDirection="column" marginTop={1}>
      <E.Text color="subtle" weight="bold">EARLIER RUNS</E.Text>
      {rest.map(r => (
        <E.Button key={`run:${r.id}`} plain onPress={() => update($, ui, u => ({ ...u, run: r.id }))}>
          <E.Text color={r.running ? 'warning' : r.failed ? 'error' : 'success'}>{r.running ? '⠿' : r.failed ? '✗' : '✓'} </E.Text>
          <E.Text>{padR(r.label, Math.max(12, w - 34))}</E.Text>
          <E.Text dimColor>{padL(`${r.agents} agent${r.agents === 1 ? '' : 's'}`, 10)} {padL(clock(r.end - r.start), 7)} {padL(ago(now - r.end), 5)} ago</E.Text>
        </E.Button>
      ))}
    </E.Box>
  )
}

// Which models are working now, and which worked earlier this session.
function modelsCard($: $, E: E, list: AgentNode[], m: MainInfo, folded: Record<string, boolean>, w: number, spin: string, now: number) {
  type Row = { model: string; p: Provider; running: number; finished: number; failed: number; since?: number }
  const by = new Map<string, Row>()
  const add = (model: string, p: Provider, st: 'running' | 'done' | 'failed', since?: number) => {
    const k = shortModel(model)
    const row = by.get(k) ?? { model: k, p, running: 0, finished: 0, failed: 0 }
    if (st === 'running') {
      row.running++
      row.since = Math.min(row.since ?? Infinity, since ?? now)
    } else if (st === 'done') row.finished++
    else row.failed++
    by.set(k, row)
  }
  if (m.working && m.model) add(m.model, 'claude', 'running', m.since)
  for (const n of list) if (n.kind !== 'workflow') add(n.model, provOf(n), stateOf(n, list), n.startedAt)
  const rows = [...by.values()]
  if (!rows.some(r => r.running > 1 || r.finished + r.failed > 1)) return null
  const working = rows.filter(r => r.running).sort((a, b) => b.running - a.running)
  const earlier = rows.filter(r => !r.running && r.finished + r.failed).sort((a, b) => b.finished + b.failed - (a.finished + a.failed))
  const most = Math.max(1, ...rows.map(r => r.finished + r.failed + r.running))
  const bw = Math.max(6, w - 36)
  return Fold($, E, folded, 'models', 'MODELS AT WORK', working.length ? 'warning' : 'suggestion', () => (
    <E.Box flexDirection="column">
      <E.Text color="subtle" weight="bold">NOW</E.Text>
      {working.length ? working.map(r => (
        <E.Text key={`mw:${r.model}`} wrap="truncate-end">
          <E.Text color="warning">{spin} </E.Text>
          <E.Text color={colorOf(r.p)} weight="bold">{padR(r.model, 21) + ' '}</E.Text>
          <E.Text dimColor>{r.running > 1 ? `${r.running} agents` : '1 agent'}{r.since && !E.desk ? ` · ${clock(now - r.since)}` : ''}</E.Text>
        </E.Text>
      )) : <E.Text dimColor>  no activity</E.Text>}
      {earlier.length ? <E.Text color="subtle" weight="bold">{'\n'}EARLIER</E.Text> : null}
      {earlier.slice(0, 6).map(r => {
        const n = r.finished + r.failed
        return (
          <E.Text key={`me:${r.model}`} wrap="truncate-end">
            <E.Text color={r.failed && !r.finished ? 'error' : 'success'}>{r.failed && !r.finished ? '✗' : '✓'} </E.Text>
            <E.Text color={colorOf(r.p)}>{padR(r.model, 21) + ' '}</E.Text>
            <E.Text color={colorOf(r.p)} dimColor>{'█'.repeat(Math.max(1, Math.round((n / most) * bw)))}</E.Text>
            <E.Text dimColor> {n}{r.failed ? ` · ✗${r.failed}` : ''}</E.Text>
          </E.Text>
        )
      })}
    </E.Box>
  ), { aside: <E.Text dimColor>{working.length} now · {earlier.length} earlier</E.Text> })
}

function gitCard($: $, E: E, g: GitInfo, folded: Record<string, boolean>, w: number) {
  if ('error' in g) return null
  return Fold($, E, folded, 'git', 'GIT', 'suggestion', () => (
    <E.Box flexDirection="column">
      <E.Text wrap="truncate-end">
        <E.Text color="suggestion" weight="bold">⎇ {g.branch}</E.Text>
        <E.Text dimColor>  {g.ahead}</E.Text>
        {g.dirty ? <E.Text color="warning">  ✱ {g.dirty} uncommitted</E.Text> : <E.Text color="success">  ✓ clean</E.Text>}
      </E.Text>
      {(g.recent?.length ? g.recent : [g.commit]).map((c, i) => {
        const [sha, ...rest] = c.split(' ')
        const msg = rest.join(' ')
        const when = msg.split(' · ').pop() ?? ''
        const subject = msg.slice(0, Math.max(0, msg.length - when.length - 3))
        return (
          <E.Text key={`commit${i}`} wrap="truncate-end">
            <E.Text color={i === 0 ? 'claude' : undefined} dimColor={i === 0 ? undefined : true}>{i === 0 ? '●' : '│'} </E.Text>
            <E.Text color="warning" dimColor={i ? true : undefined}>{sha} </E.Text>
            <E.Text weight={i === 0 ? 'bold' : undefined} dimColor={i ? true : undefined}>{padR(subject || msg, Math.max(8, w - 20))}</E.Text>
            <E.Text dimColor> {when}</E.Text>
          </E.Text>
        )
      })}
    </E.Box>
  ), { aside: g.dirty ? <E.Text color="warning">✱{g.dirty}</E.Text> : <E.Text color="success">✓</E.Text> })
}

// Every provider's tokens and cost, with the model breakdown under each.
function costBlocks(c: Costs, pr: Prices) {
  const blocks: { p: Provider; period: string; rows: (TokenRow & { cost?: number; edited?: boolean; source?: string })[] }[] = []
  const add = (p: Provider, period: string, rows: TokenRow[]) => {
    if (!rows.length) return
    blocks.push({ p, period, rows: rows.map(r => ({ ...r, cost: rowCost(r, pr), edited: priceOf(pr, r.model)?.edited, source: r.reported !== undefined ? (r.credits ? 'credits' : 'reported') : priceOf(pr, r.model)?.source })) })
  }
  const counted: TokenRow[] = Object.entries(c.claude).map(([model, t]) => ({ ...t, provider: 'claude', model, period: 'session' }))
  // Replies are counted from this launch on; the ledger's rest is what the chat cost before it (desktop relaunches often).
  const earlier = (c.engineUsd ?? 0) - counted.reduce((t, r) => t + (rowCost(r, pr) ?? 0), 0)
  add('claude', 'this session', earlier >= 0.005 ? [...counted, { provider: 'claude', model: 'earlier in this chat', period: 'session', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reported: earlier }] : counted)
  const mine = c.base ? sessionRows(c.rows, c.base) : []
  for (const p of ['codex', 'opencode', 'commandcode'] as Provider[]) add(p, 'this session', mine.filter(r => r.provider === p))
  add('antigravity', 'this session', Object.entries(c.agy).map(([model, t]) => ({ ...t, provider: 'antigravity', model, period: 'session' })))
  return blocks
}

function mediaCard($: $, E: E, m: Media, g: Guard, folded: Record<string, boolean>, w: number, spin: string) {
  const services = usedMedia(m)
  if (!g.mediaWidget || !services.length) return null
  return Fold($, E, folded, 'media', 'MEDIA', 'suggestion', () => <E.Box flexDirection="column" gap={1}>
    {services.map(s => {
      const v = m[s.id]!
      const rate = creditRate(s.id, v.plan, g.creditPrice[s.id])
      const usd = mediaDollars(v, rate)
      const total = v.total ?? planOf(s.id, v.plan)?.credits
      return <E.Box key={`media:${s.id}`} flexDirection="column">
        <E.Box flexDirection="row" justifyContent="space-between" gap={1}>
          <E.Text wrap="truncate-end"><E.Text color={s.color} weight="bold">{s.name}</E.Text><E.Text dimColor>{v.plan ? ` · ${v.plan}` : ''}</E.Text>{v.running ? <E.Text color={s.color}> {spin} {v.running}</E.Text> : null}</E.Text>
          {s.balance ? <E.Button key={`media:refresh:${s.id}`} plain onPress={() => void refreshMedia($, s.id, true)}><E.Text color={s.color}>↻</E.Text></E.Button> : null}
        </E.Box>
        {s.credits ? <E.Text dimColor>{v.used === undefined ? 'credits not reported' : `used ${v.used} credits this chat${usd === undefined ? '' : ` ≈ ${money(usd)}`}`}</E.Text> : null}
        {v.left === undefined ? null : <E.Text><E.Text dimColor>left {v.left} </E.Text>{total ? <E.Text color={s.color}>{bar(100 * Math.min(v.left, total) / total, Math.min(30, Math.max(8, w - 28)))}<E.Text dimColor> / {total}{v.left !== undefined && rate ? ` ≈ ${money(v.left * rate)} left` : ''}</E.Text></E.Text> : null}</E.Text>}
        {s.credits && rate !== undefined ? <E.Text dimColor>1 credit ≈ ${rate < 0.001 ? rate.toFixed(6) : rate.toFixed(4)} · {g.creditPrice[s.id] !== undefined ? 'your rate' : `${v.plan && planOf(s.id, v.plan)?.re.source !== '^' ? v.plan : 'typical plan'} list price`}</E.Text> : null}
        <E.Box flexDirection="row" flexWrap="wrap" gap={1}>{Object.entries(v.features).map(([tool, n]) => <E.Text key={`media:feature:${s.id}:${tool}`}>{Chip(E, `${tool} ×${n}`, false, s.color)}</E.Text>)}</E.Box>
      </E.Box>
    })}
  </E.Box>)
}

function costCard($: $, E: E, c: Costs, pr: Prices, all: Providers, folded: Record<string, boolean>, w: number, g: Guard, spent: Partial<Record<Provider, number>>, m: Media) {
  const blocks = costBlocks(c, pr), services = g.mediaWidget ? usedMedia(m).filter(s => s.credits) : []
  const showModels = folded['cost:models'] === false
  const openPrices = () => update($, ui, u => ({ ...u, view: 'prices' as const }))
  const total = blocks.reduce((t, b) => t + b.rows.reduce((n, r) => n + (r.credits ? 0 : r.cost ?? 0), 0), 0)
  const ctx = all.claude.meters.find(m => m.label === 'Context')
  const capRow = (p: Provider, rows: (TokenRow & { cost?: number; edited?: boolean })[] = []) => {
    const cap = g.caps[p], missing = unpricedModels(c, pr, p)
    const usd = rows.reduce((t, r) => t + (r.cost ?? 0), 0), credits = rows.some(r => r.credits)
    const unknown = rows.filter(r => r.cost === undefined).map(r => r.model)
    const capOff = !!cap && (missing.length > 0 || spent[p] === undefined)
    const needPrice = missing.length ? missing : unknown
    return <E.Box key={`cost:${p}`} flexDirection="column">
      <E.Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <E.Text color={colorOf(p)} weight="bold">{nameOf(p)}</E.Text>
        {capOff ? <E.Text color="warning">cap off{needPrice.length ? ` · no price for ${needPrice.map(shortModel).join(', ')}` : ' · no daily total'}</E.Text>
          : cap ? <E.Text color={heat(100 * spent[p]! / cap)}>{money(spent[p])} / ${cap} {capWindow(p)}</E.Text>
          : <E.Text>{credits ? `${usd.toFixed(1)} cr` : unknown.length === rows.length ? `${tok(rows.reduce((n, r) => n + totalOf(r), 0))} tokens` : money(usd)} <E.Text dimColor>this chat</E.Text></E.Text>}
        {!capOff && needPrice.length ? <E.Text dimColor>no price for {needPrice.map(shortModel).join(', ')}</E.Text> : null}
        {needPrice.length ? <E.Button key={`cost:setprice:${p}`} plain onPress={openPrices}><E.Text color="suggestion">set price ▸</E.Text></E.Button> : null}
      </E.Box>
      {showModels ? rows.length === 1 && rows[0]!.model === 'earlier in this chat' ? <E.Text dimColor>  model split from next turn</E.Text>
        : [...rows].sort((x, y) => (y.cost ?? 0) - (x.cost ?? 0)).slice(0, 6).map(row => <E.Text key={`costrow:${p}:${row.model}`} wrap="truncate-end">
          <E.Text color={colorOf(p)}>  {padR(shortModel(row.model), Math.min(24, w - 20))}</E.Text>
          <E.Text>{row.cost === undefined ? '' : row.credits ? `${row.cost.toFixed(1)} cr` : money(row.cost)}</E.Text>
          {totalOf(row) ? <E.Text dimColor>  {tok(row.input + row.cacheRead + row.cacheWrite)} in · {tok(row.output)} out</E.Text> : null}
          {row.edited ? <E.Text color="warning">  your price</E.Text> : null}
        </E.Text>) : null}
    </E.Box>
  }
  return Fold($, E, folded, 'cost', 'COST', 'warning', () => <E.Box flexDirection="column" gap={1}>
    {ctx ? <E.Box flexDirection="row" flexWrap="wrap" gap={1} justifyContent="space-between" alignItems="center">
      <E.Text wrap="truncate-end"><E.Text>context {Math.round(ctx.percent)}% used </E.Text><E.Text color={heat(ctx.percent)}>{bar(ctx.percent, Math.max(8, Math.min(30, w - 40)))}</E.Text></E.Text>
      <E.Button key="cost:compact" plain onPress={() => void $.command.run({ command: 'compact' })}>{Chip(E, 'Compact now', ctx.percent >= 60, ctx.percent >= 80 ? 'error' : 'warning')}</E.Button>
    </E.Box> : null}
    {blocks.map(b => capRow(b.p, b.rows))}
    {PROVIDERS.filter(({ id }) => g.caps[id] && !blocks.some(b => b.p === id)).map(({ id }) => capRow(id))}
    {services.map(service => {
      const v = m[service.id]!, usd = mediaDollars(v, creditRate(service.id, v.plan, g.creditPrice[service.id]))
      return <E.Text key={`cost:media:${service.id}`} wrap="truncate-end"><E.Text color={service.color} weight="bold">{service.name} </E.Text>{v.used === undefined ? 'credits not reported' : `${v.used} credits`}{usd === undefined ? '' : ` ≈ ${money(usd)}`}<E.Text dimColor>{v.left === undefined ? '' : ` · ${v.left} left`}</E.Text></E.Text>
    })}
    {blocks.length ? <E.Box flexDirection="row"><E.Button key="cost:models" plain onPress={() => update($, ui, u => ({ ...u, folded: { ...(u.folded ?? {}), 'cost:models': showModels } }))}><E.Text color="suggestion">{showModels ? '▾ hide models' : '▸ by model'}</E.Text></E.Button></E.Box> : null}
  </E.Box>, { aside: <E.Box flexDirection="row" gap={2}>
    {blocks.filter(b => b.rows.some(r => !r.credits && (r.cost ?? 0) > 0)).length > 1 && total > 0 ? <E.Text color="warning">≈ {money(total)}</E.Text> : null}
    <E.Button key="cost:refresh" plain onPress={() => void Promise.all([tokens($).then(() => loadPrices($, true)), refreshUsage($, undefined, true).then(() => watchQuota($))])}><E.Text color="suggestion">↻</E.Text></E.Button>
    <E.Button key="cost:prices" plain onPress={openPrices}><E.Text color="suggestion">prices ▸</E.Text></E.Button>
  </E.Box> })
}

// $ per million tokens for each model seen, from models.dev unless you set your own.
async function pricesView($: $, E: E, w: number) {
  const pr = await read($, prices)
  const g = await read($, guard)
  const c = await read($, costs)
  const r = await read($, routing)
  const keys = [...new Set([...Object.keys(c.claude), ...c.rows.map(x => x.model), ...Object.keys(c.agy), ...r.picks.map(x => x.model)].map(priceKey))].sort()
  const save = async (key: string, change: (p: Price | undefined) => Price | undefined) => {
    const next = await update($, prices, p => {
      const o = { ...p.overrides }
      const v = change(o[key] ?? (p.catalog[key] ? { input: p.catalog[key]!.input, output: p.catalog[key]!.output, cacheRead: p.catalog[key]!.cacheRead, cacheWrite: p.catalog[key]!.cacheWrite } : undefined))
      if (v) o[key] = v
      else delete o[key]
      return { ...p, overrides: o }
    })
    await $.store.set('prices', next.overrides)
  }
  const num = (v: string) => {
    const n = Number(v.replace(/[$\s]/g, ''))
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  return (
    <E.Box flexDirection="column" gap={1}>
      <E.Box flexDirection="row" gap={2} flexWrap="wrap">
        <E.Button key="prices:back" hotkey="0" plain onPress={() => update($, ui, u => ({ ...u, view: undefined }))}><E.Text color="claude" weight="bold">‹ Dashboard</E.Text></E.Button>
        <E.Text color="warning" weight="bold">PRICES</E.Text>
        <E.Text dimColor>$ / million tokens</E.Text>
        <E.Button key="prices:refresh" plain onPress={() => void loadPrices($, true)}><E.Text color="suggestion">↻ refresh from models.dev</E.Text></E.Button>
      </E.Box>
      <E.Box flexDirection="row" gap={1}>
        {(w < 80 ? [['INPUT', 13], ['OUTPUT', 13], ['CACHE READ', 11]] : [['MODEL', 23], ['INPUT', 13], ['OUTPUT', 13], ['CACHE READ', 11], ['SOURCE', 8]]).map(([label, width]) => <E.Box key={`price:head:${label}`} width={width} flexShrink={0}><E.Text dimColor>{label}</E.Text></E.Box>)}
      </E.Box>
      {keys.map(k => {
        const p = priceOf(pr, k)
        return (
          <E.Box key={`price:${k}`} flexDirection="column" gap={1}>
          <E.Box flexDirection="row" gap={1} flexWrap="wrap">
            <E.Box width={w < 80 ? w - 4 : 23} flexShrink={0}><E.Text weight="bold" color={colorOf(providerOf(k))} wrap="truncate-end">{shortModel(k)}</E.Text></E.Box>
            <E.Box flexDirection="row" gap={1}>
            <E.Box width={13} flexShrink={0}><E.Input key={`pin:${k}`} value={p ? String(p.input) : ''} placeholder="" submitLabel="set" onSubmit={(v: string) => void save(k, q => (num(v) === undefined ? q : { output: 0, ...q, input: num(v)! }))} /></E.Box>
            <E.Box width={13} flexShrink={0}><E.Input key={`pout:${k}`} value={p ? String(p.output) : ''} placeholder="" submitLabel="set" onSubmit={(v: string) => void save(k, q => (num(v) === undefined ? q : { input: 0, ...q, output: num(v)! }))} /></E.Box>
            <E.Box width={11} flexShrink={0}><E.Text dimColor>{p?.cacheRead !== undefined ? String(p.cacheRead) : ''}</E.Text></E.Box>
            </E.Box>
            <E.Text color={p?.edited ? 'warning' : undefined} dimColor={p?.edited ? undefined : true}>{p?.edited ? 'yours' : p?.source ?? ''}</E.Text>
            {p?.edited ? <E.Button key={`preset:${k}`} plain onPress={() => void save(k, () => undefined)}><E.Text color="error"> ✕ reset</E.Text></E.Button> : null}
          </E.Box>
          </E.Box>
        )
      })}
      {keys.length ? null : <E.Text dimColor>no models yet</E.Text>}
      <E.Text color="warning" weight="bold">MEDIA CREDITS · $ per credit</E.Text>
      {MEDIA.filter(s => s.credits).map(s => <E.Box key={`price:media:${s.id}`} flexDirection="row" gap={1}>
        <E.Text color={s.color} weight="bold">{padR(s.name, 23)}</E.Text>
        <E.Box width={18}><E.Input key={`creditprice:${s.id}`} value={g.creditPrice[s.id] === undefined ? '' : String(g.creditPrice[s.id])} placeholder="no rate" submitLabel="set" onSubmit={async (v: string) => {
          const n = num(v)
          if (v.trim() && n === undefined) return
          await saveGuard($, x => {
            const creditPrice = { ...x.creditPrice }
            if (v.trim()) creditPrice[s.id] = n!
            else delete creditPrice[s.id]
            return { ...x, creditPrice }
          })
        }} /></E.Box>
      </E.Box>)}
      <E.Text dimColor italic>{pr.fetchedAt ? `catalogue read ${ago((await $.clock.now()) - pr.fetchedAt)} ago` : 'catalogue not read yet'}</E.Text>
    </E.Box>
  )
}

// ---------- plugin switches: off hides from the model, on is normal, force asks for it ----------

async function setPin($: $, key: string, on: boolean) {
  const next = await update($, pins, ps => (on ? [...new Set([...ps, key])] : ps.filter(x => x !== key)))
  await $.store.set('pins', next)
}

const MODE_COLOR: Record<Mode, string> = { off: 'inactive', on: 'success', force: 'warning' }

function codexImagesRow($: $, E: E, g: Guard, place: 'settings') {
  return SettingsRow(E, `cimg:${place}`, CODEX_IMAGES, (['off', 'on', 'force'] as Mode[]).map(m => <E.Button key={`cimg:${place}:${m}`} plain onPress={async () => {
    await saveGuard($, x => ({ ...x, codexImages: m }))
    $.ui.invalidate('prompt.section')
  }}>{Chip(E, m === 'off' ? 'Off' : m === 'on' ? 'On' : 'Force', m === g.codexImages)}</E.Button>))
}

const PONYTAIL_MODES = ['lite', 'full', 'ultra']

async function switchesCard($: $, E: E, folded: Record<string, boolean>, w: number) {
  const ps = await read($, pins)
  if (!ps.length) return null
  const t = await read($, toggles)
  const inst = await read($, installed)
  const pony = ps.includes('plugin:ponytail') ? await $.fs.read(`${await $.env.get('HOME') ?? ''}/.claude/.ponytail-active`).then(s => s.trim()).catch(() => '') : ''
  const modeOf = (k: string): Mode => k.startsWith('tool:') ? toolMode(t, k.slice(5)) : k.startsWith('skill:') ? skillMode(t, k.slice(6)) : t[k] ?? 'on'
  const rows = ps.map(k => {
    const kind = k.split(':')[0]
    const plugin = kind === 'plugin' ? inst.plugins.find(p => p.where === 'claude' && p.name === k.slice(7)) : undefined
    const skills = plugin?.skills ?? []
    const tools = kind === 'server' ? (inst.tools ?? []).filter(name => name.startsWith(`mcp__${k.slice(7)}__`)) : []
    const open = folded[`sw:${k}`] === false
    const m = modeOf(k)
    return (
      <E.Box key={`sw:${k}`} flexDirection="column">
        <E.Box flexDirection="row" justifyContent="space-between" gap={1}>
          <E.Box flexDirection="row" gap={1} flexShrink={1}>
            {skills.length || tools.length ? (
              <E.Button key={`swfold:${k}`} plain onPress={() => update($, ui, u => ({ ...u, folded: { ...(u.folded ?? {}), [`sw:${k}`]: open } }))}>
                <E.Text color="suggestion">{open ? '▾' : '▸'}</E.Text>
              </E.Button>
            ) : <E.Text> </E.Text>}
            <E.Text color={MODE_COLOR[m]} weight="bold">{kind === 'server' ? '▦' : kind === 'tool' ? '·' : kind === 'skill' ? '✦' : '◆'} </E.Text>
            <E.Text weight="bold" wrap="truncate-end" dimColor={m === 'off' ? true : undefined}>{fit(pinLabel(k), Math.max(10, w - 34))}</E.Text>
            {skills.length && w >= 72 ? <E.Text dimColor> {plural(skills.length, 'skill')}</E.Text> : null}
            {kind === 'server' && w >= 72 ? <E.Text dimColor> {plural(tools.length, 'tool')}</E.Text> : null}
          </E.Box>
          {triState($, E, k, m, k, kind === 'skill' && t[k] === undefined)}
        </E.Box>
        {open && plugin?.name === 'ponytail' ? (
          <E.Box flexDirection="row" gap={1} marginLeft={4}>
            <E.Text dimColor>mode</E.Text>
            {PONYTAIL_MODES.map(x => (
              <E.Button key={`pmode:${x}`} plain onPress={() => void $.command.run({ command: 'ponytail', args: x })}>
                {Chip(E, x, x === pony, 'claude')}
              </E.Button>
            ))}
          </E.Box>
        ) : null}
        {open
          ? skills.map(sk => {
              const sk2 = `skill:${plugin!.name}:${sk}`
              return skillRow($, E, sk2, t, `${k}:${sk2}`)
            })
          : null}
        {open ? tools.map(name => {
          const tk = `tool:${name}`
          const tm = t[tk] ?? m
          return (
            <E.Box key={`swtl:${name}`} flexDirection="row" justifyContent="space-between" marginLeft={4} flexWrap="wrap" gap={1}>
              <E.Text dimColor={tm === 'off' ? true : undefined} wrap="truncate-end">· {displayName(name.slice(`mcp__${k.slice(7)}__`.length))}</E.Text>
              {triState($, E, tk, tm, `${k}:${tk}`)}
            </E.Box>
          )
        }) : null}
      </E.Box>
    )
  })
  const note = await switchNote($)
  return Fold($, E, folded, 'switches', 'PLUGINS', 'remember', () => (
    <E.Box flexDirection="column">
      {note ? <E.Text color="warning" wrap="wrap">{note}</E.Text> : null}
      {rows.length ? rows : <E.Text dimColor>no activity</E.Text>}
    </E.Box>
  ))
}

// A line too long for its space scrolls through like a ticker: a short pause, then one cell at a time.
export const marquee = (text: string, width: number, now: number, stepMs = 350, pauseSteps = 6) => {
  if (text.length <= width) return text
  const loop = `${text}     ◆     `
  const step = Math.floor(now / stepMs) % (loop.length + pauseSteps)
  const off = Math.max(0, step - pauseSteps)
  return (loop + loop).slice(off, off + width)
}

function decisionRows($: $, E: E, list: DecisionItem[], w: number, max: number, now: number, folded: Record<string, boolean>, ticker: boolean) {
  const shown = [...list].reverse().slice(0, max)
  return shown.map((d, i) => {
    // Keyed by time, not place, so a new decision does not re-key every row; same-ms twins get a count.
    const twins = shown.slice(0, i).filter(x => x.at === d.at).length
    const key = `dec:${d.at}${twins ? `:${twins}` : ''}`
    const foldKey = `dec:${d.at}`
    const open = folded[foldKey] === false
    const textW = Math.max(10, w - 12)
    const toggle = () => update($, ui, u => ({ ...u, folded: { ...(u.folded ?? {}), [foldKey]: open } }))
    return (
      <E.Box key={key} flexDirection="column">
        <E.Box flexDirection="row" gap={1} alignItems="center">
          <E.Button key={`fold:${key}`} plain onPress={toggle}><E.Text>{open ? '▾' : '▸'}</E.Text></E.Button>
          <E.Text wrap="truncate-end"><E.Text color={IMPACT[d.impact].color} weight="bold">{IMPACT[d.impact].mark} </E.Text><E.Text weight={d.impact === 'low' ? undefined : 'bold'}>{fit(d.decision, Math.max(10, textW - (E.desk ? 4 : 0)))}</E.Text><E.Text dimColor> {padL(ago(now - d.at), 4)}</E.Text></E.Text>
        </E.Box>
        {ticker && !E.desk && d.decision.length > textW ? (
          <E.Box position="absolute" top={0} left={2} width={textW} height={1} display="none" hover={{ display: 'flex' }} backgroundColor="inverseText">
            <E.Button key={`hover:fold:${key}`} plain onPress={toggle}>
              <E.Text weight={d.impact === 'low' ? undefined : 'bold'}>{marquee(d.decision, textW, now)}</E.Text>
            </E.Button>
          </E.Box>
        ) : null}
        {open && d.decision.length > textW ? wrapText(d.decision, w - 4, 6).map((t, i) => <E.Text key={`${key}:full${i}`}>{'  '}{t}</E.Text>) : null}
        {open ? wrapText(d.why, w - 4, 4).map((t, i) => <E.Text key={`${key}:why${i}`} dimColor>{i ? '    ' : '  ↳ '}{t}</E.Text>) : null}
      </E.Box>
    )
  })
}

function reviewRow($: $, E: E, x: EditItem, all: EditItem[], w: number) {
  const idx = all.filter(y => y.file === x.file).reverse().findIndex(y => sameEdit(y, x))
  return (
    <E.Box key={`rev:${x.file}:${x.at}`} flexDirection="row" justifyContent="space-between" gap={1}>
      <E.Text wrap="truncate-end">
        <E.Text color={colorOf(x.provider ?? 'claude')}>● {padR(shortModel(x.model ?? ''), 16)}</E.Text>
        <E.Text weight="bold"> {fitStart(base(x.file), Math.max(10, w - 62))}</E.Text>
        <E.Text color="success">  +{x.added ?? 0}</E.Text>
        <E.Text color="error"> −{x.removed ?? 0}</E.Text>
        {x.isNew ? <E.Text dimColor> new</E.Text> : ''}
      </E.Text>
      <E.Box flexDirection="row" gap={2}>
        <E.Button key={`rev:view:${x.file}:${x.at}`} plain onPress={() => update($, ui, u => ({ ...u, tab: 'activity' as const, file: x.file, fileEdit: Math.max(0, idx) }))}><E.Text color="suggestion">view ▸</E.Text></E.Button>
        <E.Button key={`rev:keep:${x.file}:${x.at}`} plain onPress={() => settle($, x, 'kept')}><E.Text color="success">✓ keep</E.Text></E.Button>
        <E.Button key={`rev:undo:${x.file}:${x.at}`} plain onPress={() => settle($, x, 'reverted')}><E.Text color="error">✗ {x.isNew ? 'delete' : 'revert'}</E.Text></E.Button>
      </E.Box>
    </E.Box>
  )
}

// Every QA entry not yet saved, handed to Claude as if you typed it, to write one design doc / ADR.
export async function saveQa($: $, since = 0): Promise<boolean> {
  const todo = (await read($, grill)).filter(q => (q.at ?? 0) >= since && !q.documented && q.answer.trim())
  if (!todo.length) return true
  const items = todo.map((q, n) => `${n + 1}. Topic: ${q.question}\n   ${q.kind === 'instruction' ? 'Owner instruction' : 'Owner answer'}: ${q.answer}`).join('\n')
  if (!await submitPrompt($, `Write one design doc / ADR for this repo from the owner's answers and instructions below. Follow the repo's own ADR or design-doc format and folder if it has one; otherwise create docs/adr/NNNN-<short-title>.md (next free number) with Status, Context, Decisions and Consequences. Group related entries, keep each decision short, and leave out anything that is not a design decision. Then say which file you wrote.\n\n${items}`)) return false
  await update($, grill, list => list.map(x => (todo.some(t => t.at === x.at && t.question === x.question && t.answer === x.answer) ? { ...x, documented: true } : x)))
  return true
}

// The QA card's top-right: save everything new as one ADR, and an edit mode to delete entries one by one.
function qaAside($: $, E: E, qa: GrillItem[], editing: boolean, place: string) {
  const fresh = qa.filter(q => !q.documented).length
  return (
    <E.Box flexDirection="row" gap={2}>
      <E.Text dimColor>{qa.length} kept</E.Text>
      {qa.length ? (fresh ? (
        <E.Button key={`qasave:${place}`} plain onPress={() => void saveQa($)}><E.Text color="suggestion">save as ADR{fresh < qa.length ? ` (${fresh} new)` : ''}</E.Text></E.Button>
      ) : <E.Text color="success">✓ saved</E.Text>) : null}
      {qa.length ? (
        <E.Button key={`qaedit:${place}`} plain onPress={() => update($, ui, u => ({ ...u, qaEdit: !u.qaEdit }))}><E.Text color={editing ? 'warning' : 'suggestion'}>{editing ? 'done' : 'edit'}</E.Text></E.Button>
      ) : null}
    </E.Box>
  )
}
// In edit mode, a ✕ beside an entry removes it.
function qaRemove($: $, E: E, q: GrillItem, key: string) {
  return (
    <E.Button key={key} plain onPress={() => update($, grill, list => list.filter(x => !(x.question === q.question && x.answer === q.answer && x.at === q.at)))}>
      <E.Text color="error">✕</E.Text>
    </E.Button>
  )
}

async function dashboard($: $, E: E, w: number, rows: number) {
  if ((await read($, ui)).view === 'prices') return pricesView($, E, w)
  const list = await displayNodes($)
  const ed = await read($, edits)
  const all = await read($, providers).then(allOf)
  const r = await read($, routing)
  const g = await read($, git)
  const u = await read($, ui)
  const folded = u.folded ?? {}
  const now = await $.clock.now()
  const spin = await spinOf($, E)
  const wide = w >= WIDE
  const real = list.filter(n => n.kind !== 'workflow')
  const c = counts(real, list)
  const mainInfo = await read($, main)
  const runningNow = c.r
  // Totals from before they were recorded fall back to the recent list, so a running session never drops.
  const tot = await read($, written)
  const files = Math.max(tot.files.length, new Set(ed.map(x => x.file)).size)
  const lines = Math.max(tot.added, ed.reduce((t, x) => t + (x.added ?? 0), 0))
  const gone = Math.max(tot.removed, ed.reduce((t, x) => t + (x.removed ?? 0), 0))
  const tileW = Math.max(12, Math.floor((w - 3) / 4))
  const goTab = (tab: Tab) => update($, ui, x => ({ ...x, tab, detail: undefined, editing: undefined }))
  const openProvider = (p: Provider) => update($, ui, x => ({ ...x, tab: 'models' as const, editing: p, detail: undefined }))
  const tiles = (
    <E.Box key="tiles" flexDirection="row" gap={1} flexWrap="wrap">
      {runningNow ? tile(E, 'tile:run', `${runningNow ? spin : '○'} running`, String(Math.min(999, runningNow)), runningNow ? 'warning' : 'inactive', tileW, () => goTab('agents')) : null}
      {c.d ? tile(E, 'tile:done', '✓ finished', String(Math.min(999, c.d)), c.d ? 'success' : 'inactive', tileW, () => goTab('agents')) : null}
      {files ? tile(E, 'tile:files', '· files edited', String(Math.min(999, files)), files ? 'claude' : 'inactive', tileW, () => goTab('activity')) : null}
      {lines || gone ? linesTile(E, lines, gone, tileW, () => goTab('activity')) : null}
    </E.Box>
  )
  const gd = await read($, guard)
  const mediaNow = await read($, media)
  const mediaBox = mediaCard($, E, mediaNow, gd, folded, w - 4, spin)
  const watch = watchOf(u, gd.follow)
  // The live view spans the panel; usage, models, git and changes share two columns below the cost card.
  const leftW = w
  const rightW = wide ? Math.floor((w - 2) / 2) : w
  const graph = list.length || mainInfo.working ? graphCard($, E, list, folded, w - 4, now, spin, mainInfo, u.run, watchKey(await read($, acts), list, watch)) : null
  const stages = list.length ? stagesCard($, E, list, folded, w - 4, now, spin, mainInfo, u.run) : Fold($, E, folded, 'stages', 'STAGES', mainInfo.working ? 'claude' : 'inactive', () => (mainInfo.working ? <E.Text><E.Text color="claude" weight="bold">{spin} ◆ Claude is working</E.Text><E.Text dimColor>  {shortModel(mainInfo.model)} · no agents</E.Text></E.Text> : idleArt(E, w - 4, 'no activity')))
  const liveBox = list.length || Object.keys(await read($, acts)).length || mainInfo.working ? await activityCard($, E, leftW, Math.max(6, Math.min(16, Math.floor(rows / 3)))) : null
  const c0 = await read($, costs)
  const pr0 = await read($, prices)
  const cost = costBlocks(c0, pr0).length || Object.values(gd.caps).some(Boolean) || gd.mediaWidget && usedMedia(mediaNow).length || list.length || ed.length || (await read($, decisions)).length ? costCard($, E, c0, pr0, all, folded, w - 4, gd, spendBy(c0, pr0, gd.ccBase, new Date(now).toDateString()), mediaNow) : null
  const usage = Fold($, E, folded, 'usage', 'USAGE', 'claude', () => usageChart(E, all, r, w - 4, now, openProvider), { width: w, aside: cost ? undefined : <E.Box flexDirection="row" gap={2}>
    <E.Button key="cost:refresh" plain onPress={() => void Promise.all([tokens($).then(() => loadPrices($, true)), refreshUsage($, undefined, true).then(() => watchQuota($))])}><E.Text color="suggestion">↻</E.Text></E.Button>
    <E.Button key="cost:prices" plain onPress={() => update($, ui, u => ({ ...u, view: 'prices' as const }))}><E.Text color="suggestion">prices ▸</E.Text></E.Button>
  </E.Box> })
  const ctx = all.claude.meters.find(x => x.label === 'Context')
  const ctxWarn = gd.ctxWarn > 0 && ctx && ctx.percent >= gd.ctxWarn ? (
    <E.Box key="ctxwarn" flexDirection="row" justifyContent="space-between" borderStyle="round" borderColor="error" paddingX={1}>
      <E.Text wrap="truncate-end">
        <E.Text color="error" weight="bold">▲ Context {Math.round(ctx.percent)}% full</E.Text>
      </E.Text>
      <E.Button key="ctx:compact" plain onPress={() => void $.command.run({ command: 'compact' })}>{Chip(E, 'Compact now', true, 'error')}</E.Button>
    </E.Box>
  ) : null
  const pending = ed.filter(x => x.review === 'pending')
  const parts: { text: string; color: string }[] = []
  if (gd.mediaWidget) for (const s of usedMedia(mediaNow)) {
    if (mediaNow[s.id]!.running) parts.push({ text: `● ${s.name} ${mediaNow[s.id]!.running}`, color: s.color })
  }
  if (mainInfo.working) {
    parts.push({ text: `◆ Claude${E.desk ? '' : ` ${clock(now - (mainInfo.since ?? now))}`}`, color: 'claude' })
    const tool = mainInfo.trail?.[mainInfo.trail.length - 1]?.tool
    if (tool) parts.push({ text: `${tool.replace(/^mcp__.+?__/, '')}`, color: 'claude' })
  }
  const side = await read($, sideLive)
  const running = real.filter(n => stateOf(n, list) === 'running')
  for (const n of running.filter(n => provOf(n) !== 'claude')) {
    parts.push({ text: `● ${shortModel(n.model)}${E.desk ? '' : ` ${clock(now - (n.startedAt ?? now))}`}${side?.id === n.id ? ` · ${plural(side.files.length, 'file')} changed` : ''}`, color: colorOf(provOf(n)) })
  }
  const subagents = running.filter(n => provOf(n) === 'claude').length
  if (subagents) parts.push({ text: plural(subagents, 'subagent'), color: 'claude' })
  if (!mainInfo.working && !running.length && !Object.values(mediaNow).some(m => m.running)) {
    const session = await $.session.id().catch(() => '')
    const finished = [
      ...real.filter(n => n.endedAt !== undefined).map(n => ({ label: n.label, at: n.endedAt! })),
      ...(await agentHistory($)).items.filter(n => n.session === session).map(n => ({ label: n.label, at: n.at + n.ms })),
      ...(await read($, turnCosts)).map(n => ({ label: 'Claude', at: n.at })),
    ].sort((a, b) => b.at - a.at)[0]
    if (finished) {
      const when = ago(now - finished.at)
      parts.push({ text: '✓ idle', color: 'success' })
      parts.push({ text: `last: ${finished.label} ${when === 'now' ? 'just now' : `${when} ago`}`, color: 'inactive' })
    }
  }
  if (pending.length) parts.push({ text: `◆ ${pending.length} to review`, color: 'warning' })
  if (gd.ctxWarn > 0 && ctx && ctx.percent >= gd.ctxWarn) parts.push({ text: `context ${Math.round(ctx.percent)}%`, color: 'error' })
  let remaining = w
  const headline = parts.length ? <E.Text key="headline" wrap="truncate-end">{parts.map((part, i) => {
    const text = fit(`${i ? ' · ' : ''}${part.text.replace(/\s+/g, ' ')}`, remaining)
    remaining -= text.length
    return <E.Text key={`headline:${i}`} color={part.color} weight={i === 0 ? 'bold' : undefined}>{text}</E.Text>
  })}</E.Text> : null
  const reviewBox = pending.length
    ? Card(E, 'card:review', 'TO REVIEW', 'warning', <E.Box flexDirection="column">{pending.slice(-8).reverse().map(x => reviewRow($, E, x, ed, w - 4))}</E.Box>, {
        aside: (
          <E.Box flexDirection="row" gap={2}>
            <E.Text dimColor>{pending.length} file{pending.length > 1 ? 's' : ''} from side providers</E.Text>
            <E.Button key="review:keepall" plain onPress={async () => { for (const x of pending) await settle($, x, 'kept') }}><E.Text color="success">✓ keep all</E.Text></E.Button>
          </E.Box>
        ),
      })
    : null
  const models = modelsCard($, E, list, mainInfo, folded, rightW - 4, spin, now)
  const gitBox = gitCard($, E, g, folded, rightW - 4)
  const qa = await read($, grill)
  const qaEditing = !!(await read($, ui)).qaEdit
  const grillBox = qa.length ? Fold($, E, folded, 'grill', 'QA', qa.length ? 'suggestion' : 'inactive', () => (
    qa.length ? <E.Box flexDirection="column" gap={1}>
      {(qaEditing ? qa : qa.slice(-4)).map((q, i, xs) => (
        <E.Box key={`gq${i}`} flexDirection="column">
          <E.Box flexDirection="row" justifyContent="space-between" gap={1}>
            <E.Text wrap="truncate-end">
              <E.Text {...filled(E, q.kind === 'instruction' ? 'planMode' : 'suggestion')} weight="bold">{q.kind === 'instruction' ? ' I ' : ` Q${qa.length - xs.length + i + 1} `}</E.Text>
              <E.Text color={q.kind === 'instruction' ? 'planMode' : 'suggestion'}> {q.question}</E.Text>
            </E.Text>
            {qaEditing ? qaRemove($, E, q, `qadel:dash:${qa.length - xs.length + i}`) : q.documented ? <E.Text dimColor>✓</E.Text> : null}
          </E.Box>
          {wrapText(q.answer, (wide ? Math.floor((w - 2) / 2) : w) - 9, 3).map((t, j) => (
            <E.Text key={`ga${i}:${j}`}><E.Text color="success" weight="bold">{j || q.kind === 'instruction' ? '     ' : '  A  '}</E.Text>{t}</E.Text>
          ))}
        </E.Box>
      ))}
    </E.Box> : <E.Text dimColor>no answers</E.Text>
  ), { width: wide ? Math.floor((w - 2) / 2) : undefined, aside: qaAside($, E, qa, qaEditing, 'dash') }) : null
  const decs = await read($, decisions)
  const half = Math.floor((w - 2) / 2)
  const switches = await switchesCard($, E, folded, w - 4)
  const decisionBox = decs.length ? Fold($, E, folded, 'decisions', 'DECISIONS', decs.length ? 'warning' : 'inactive', () => (decs.length ? <E.Box flexDirection="column">{decisionRows($, E, decs, wide ? half - 4 : w - 4, 8, now, folded, gd.ticker)}</E.Box> : <E.Text dimColor>no decisions</E.Text>), { width: wide ? half : undefined, aside: <E.Text dimColor>{decs.filter(d => d.impact === 'high').length ? `${decs.filter(d => d.impact === 'high').length} high · ` : ''}{decs.length}</E.Text> }) : null
  const churn = ed.length ? Fold($, E, folded, 'changes', 'CHANGES', 'success', () => <E.Box flexDirection="column">{churnRows(E, ed, rightW - 4, 6)}</E.Box>, { width: rightW, aside: <E.Text dimColor>{files} files</E.Text> }) : null
  if (wide) {
    return (
      <E.Box flexDirection="column" gap={1}>
        {headline}
        {ctxWarn}
        {tiles}
        {stages}
        {reviewBox}
        {graph}
        {liveBox}
        {mediaBox}
        {decisionBox || grillBox ? <E.Box flexDirection="row" gap={2}>
          <E.Box flexDirection="column" width={half}>{decisionBox}</E.Box>
          <E.Box flexDirection="column" width={half}>{grillBox}</E.Box>
        </E.Box> : null}
        {cost}
        {usage}
        <E.Box flexDirection="row" gap={2}>
          <E.Box flexDirection="column" gap={1} width={rightW}>{models ?? gitBox}</E.Box>
          <E.Box flexDirection="column" gap={1} width={rightW}>{models ? [gitBox, churn].filter(Boolean) : churn}</E.Box>
        </E.Box>
        {switches}
      </E.Box>
    )
  }
  return <E.Box flexDirection="column" gap={1}>{[headline, ctxWarn, tiles, stages, reviewBox, graph, liveBox, mediaBox, decisionBox, grillBox, cost, usage, models, gitBox, churn, switches].filter(Boolean)}</E.Box>
}

// ---------- agents: the full graph, the list, and history ----------

type AgentsView = NonNullable<Ui['agents']>
function chips($: $, E: E, sel: AgentsView, n: Record<AgentsView, number>) {
  const items: { id: AgentsView; label: string; color: string }[] = [
    { id: 'graph', label: 'Graph', color: 'suggestion' },
    { id: 'list', label: 'List', color: 'claude' },
    { id: 'history', label: 'History', color: 'subtle' },
  ]
  return (
    <E.Box flexDirection="row" gap={1} flexWrap="wrap">
      {items.map((c, i) => (
        <E.Button key={`chip:${c.id}`} hotkey={String(i + 1)} plain onPress={() => update($, ui, u => ({ ...u, agents: c.id, detail: undefined }))}>
          {c.id === sel ? (
            <E.Text {...filled(E, c.color)} weight="bold"> {c.label}{c.id !== 'graph' && n[c.id] ? ` ${n[c.id]}` : ''} </E.Text>
          ) : (
            <E.Text>
              <E.Text color={n[c.id] ? c.color : 'inactive'}> {c.label}</E.Text>
              {c.id !== 'graph' && n[c.id] ? <E.Text dimColor> {n[c.id]} </E.Text> : ' '}
            </E.Text>
          )}
        </E.Button>
      ))}
    </E.Box>
  )
}

function treeRow($: $, E: E, row: TreeRow, list: AgentNode[], w: number, now: number, spin: string, t0: number, maxSteps: number, mode: 'two' | 'one' | 'compact') {
  const n = row.node
  const running = row.state === 'running'
  const done = row.state === 'done'
  const failed = row.state === 'failed'
  const isGroup = n.kind === 'workflow'
  const glyph = isGroup ? '◇' : running ? spin : done ? '✓' : '✗'
  const glyphColor = running ? colorOf(provOf(n)) : failed ? 'error' : done ? 'success' : undefined
  const time = running && E.desk ? '' : clock((n.endedAt && !running ? n.endedAt : now) - (n.startedAt ?? now))
  const model = nodeModel(n)
  const mColor = colorOf(provOf(n))
  const groupCount = isGroup ? countText(counts(list.filter(k => k.parentNode === n.id), list), spin) : ''
  const stub = row.prefix.slice(-2)
  const trunk = row.prefix.slice(0, -2)
  const head = (labelW: number) => (
    <E.Text>
      <E.Text dimColor>{trunk}</E.Text>
      <E.Text color={running ? colorOf(provOf(n)) : undefined} dimColor={running ? undefined : true}>{stub}</E.Text>
      <E.Text color={glyphColor} weight={failed || running ? 'bold' : undefined}>{glyph} </E.Text>
      <E.Text weight={running || isGroup ? 'bold' : undefined} dimColor={done && !isGroup ? true : undefined}>{padR(n.label || n.kind, Math.max(1, labelW - (n.offRoute ? 10 : 0)))}</E.Text>
      {n.offRoute ? <E.Text key={`off-route:${n.id}`} color="warning"> off-route</E.Text> : null}
    </E.Text>
  )
  const timeText = time ? <E.Text color={failed ? 'error' : undefined} dimColor={failed ? undefined : true} weight={failed ? 'bold' : undefined}>{padL(time, 6)}</E.Text> : null
  if (mode === 'compact') {
    const modelW = w < 72 ? 12 : Math.min(19, Math.floor(w / 4))
    const compactModel = w < 72 ? nameOf(provOf(n)) : model
    const labelW = Math.max(8, w - row.prefix.length - modelW - (E.desk ? time ? 16 : 10 : 13))
    return <E.Box key={`snode:${n.id}`} flexDirection="row" gap={1} alignItems="center">
      <E.Button key={`node:${n.id}`} plain onPress={() => void openDetail($, n.id)}><E.Text color={mColor}>›</E.Text></E.Button>
      <E.Text wrap="truncate-end">{head(labelW)}<E.Text color={mColor}> {padR(isGroup ? groupCount : compactModel, modelW)}</E.Text>{timeText}</E.Text>
    </E.Box>
  }
  const tool = running && n.lastTool ? n.lastTool.replace(/^mcp__.+?__/, '') : ''
  if (mode === 'one') {
    const GW = Math.max(10, w - 91), span = Math.max(1000, now - t0)
    const x = (t: number) => Math.min(GW - 1, Math.max(0, Math.floor(((t - t0) / span) * GW)))
    const a = x(n.startedAt ?? now), b = Math.max(a, x(running ? now : n.endedAt ?? now))
    const body = '━'.repeat(Math.max(1, b - a + 1))
    const lane = running ? `${body.slice(0, -1)}╸` : failed ? `${body.slice(0, -1)}✗` : body
    const cell = (key: string, width: number, text: any) => <E.Box key={`cell:${n.id}:${key}`} width={width} flexShrink={0}>{text}</E.Box>
    return <E.Box key={`row:${n.id}`} flexDirection="row" gap={1} alignItems="center">
      {cell('open', 4, <E.Button key={`node:${n.id}`} plain onPress={() => void openDetail($, n.id)}><E.Text color={mColor}>›</E.Text></E.Button>)}
      {cell('name', 30, <E.Text wrap="truncate-end">{head(Math.max(8, 28 - row.prefix.length))}</E.Text>)}
      {cell('model', 24, <E.Text color={mColor} wrap="truncate-end">{isGroup ? groupCount : model}</E.Text>)}
      {cell('pips', 8, <E.Text color={mColor} dimColor={!running || undefined}>{isGroup ? '' : pips(done ? 100 : (100 * n.steps) / maxSteps, 8)}</E.Text>)}
      {cell('steps', 4, <E.Text dimColor>{isGroup ? '' : String(n.steps || '')}</E.Text>)}
      {cell('tool', 8, <E.Text dimColor wrap="truncate-end">{tool}</E.Text>)}
      {cell('time', 6, timeText)}
      {cell('lane', GW, <E.Text color={failed ? 'error' : mColor} dimColor={!running && !failed || undefined}>{' '.repeat(a)}{lane}</E.Text>)}
    </E.Box>
  }
  const labelW = Math.max(8, w - row.prefix.length - (E.desk ? 15 : 11) - (groupCount ? groupCount.length + 2 : 0))
  const under = `${trunk}${stub === '├─' ? '│ ' : '  '}`
  return <E.Box key={`row:${n.id}`} flexDirection="column">
    <E.Box flexDirection="row" gap={1} alignItems="center">
      <E.Button key={`node:${n.id}`} plain onPress={() => void openDetail($, n.id)}><E.Text color={mColor}>›</E.Text></E.Button>
      <E.Text wrap="truncate-end">{head(labelW)}{groupCount ? <E.Text dimColor> {groupCount}</E.Text> : ''}{timeText}</E.Text>
    </E.Box>
    {isGroup ? null : <E.Box flexDirection="row" gap={1}>
      <E.Box width={E.desk ? 4 : 1} flexShrink={0}><E.Text> </E.Text></E.Box>
      <E.Box width={2} flexShrink={0}><E.Text dimColor wrap="truncate-end">{under}</E.Text></E.Box>
      <E.Box width={Math.max(12, Math.min(34, w - 30))} flexShrink={0}><E.Text color={mColor} wrap="truncate-end">{w < 72 ? shortModel(n.model).replace(/^.*\//, '') : model}</E.Text></E.Box>
      <E.Box width={5} flexShrink={0}><E.Text color={mColor}>{pips(done ? 100 : (100 * n.steps) / maxSteps, 5)}</E.Text></E.Box>
      <E.Box width={3} flexShrink={0}><E.Text dimColor>{n.steps || ''}</E.Text></E.Box>
      <E.Box width={6} flexShrink={0}><E.Text dimColor wrap="truncate-end">{tool}</E.Text></E.Box>
    </E.Box>}
  </E.Box>
}

// This session's finished agents, once they leave the graph, grouped by day, newest first.
function historyView(E: E, items: HistoryItem[], w: number, rows: number) {
  if (!items.length) return idleArt(E, w, 'no history')
  const day = (t: number) => new Date(t).toDateString()
  const today = day(Date.now())
  const yesterday = day(Date.now() - 86400000)
  const byProvider: Partial<Record<Provider, number>> = {}
  for (const it of items) byProvider[provOf(it)] = (byProvider[provOf(it)] ?? 0) + 1
  const most = Math.max(1, ...Object.values(byProvider).map(n => n ?? 0))
  const out: any[] = []
  let last = ''
  let budget = Math.max(6, rows - 8)
  for (const it of [...items].reverse()) {
    const d = day(it.at)
    const itemRows = w < 72 ? 2 : 1, dayRows = d === last ? 0 : out.length ? 2 : 1
    if (budget < itemRows + dayRows) break
    if (d !== last) {
      last = d
      out.push(<E.Box key={`day:${d}`} marginTop={out.length ? 1 : 0}>{Rule(E, d === today ? 'TODAY' : d === yesterday ? 'YESTERDAY' : d.slice(4).toUpperCase(), w)}</E.Box>)
    }
    const hhmm = new Date(it.at).toTimeString().slice(0, 5)
    out.push(
      <E.Box key={`h:${it.at}:${it.label}`} flexDirection="column">
      <E.Text wrap="truncate-end">
        <E.Text dimColor>{hhmm}  </E.Text>
        <E.Text color={it.state === 'done' ? 'success' : 'error'}>{it.state === 'done' ? '✓' : '✗'} </E.Text>
        <E.Text>{padR(it.label, Math.max(10, w - (w < 72 ? 9 : 39)))}</E.Text>
        {w >= 72 ? <E.Text><E.Text color={colorOf(provOf(it))}> {padR(shortModel(it.model), 22)}</E.Text><E.Text dimColor>{padL(clock(it.ms), 7)}</E.Text></E.Text> : null}
      </E.Text>
      {w < 72 ? <E.Box marginLeft={9}><E.Text><E.Text color={colorOf(provOf(it))}>{nameOf(provOf(it))}</E.Text><E.Text dimColor> · {clock(it.ms)}</E.Text></E.Text></E.Box> : null}
      </E.Box>,
    )
    budget -= itemRows + dayRows
  }
  return (
    <E.Box flexDirection="column" gap={1}>
      {Card(E, 'card:split', 'WHO DID THE WORK', 'subtle', (
        <E.Box flexDirection="column">
          {(Object.keys(byProvider) as Provider[]).sort((a, b) => (byProvider[b] ?? 0) - (byProvider[a] ?? 0)).map(p => (
            <E.Text key={`bp:${p}`}>
              <E.Text color={colorOf(p)} weight="bold">{padR(nameOf(p), 14)}</E.Text>
              <E.Text color={colorOf(p)}>{bar((100 * (byProvider[p] ?? 0)) / most, Math.max(6, Math.min(30, w - 30)))}</E.Text>
              <E.Text dimColor> {byProvider[p]}</E.Text>
            </E.Text>
          ))}
        </E.Box>
      ), { aside: <E.Text dimColor>{items.length} runs</E.Text> })}
      <E.Box flexDirection="column">{out}</E.Box>
    </E.Box>
  )
}

async function agentsTab($: $, E: E, w: number, rows: number) {
  const u = await read($, ui)
  if (u.detail) return detailView($, E, u.detail, w, rows)
  const list = await displayNodes($)
  const hist = await agentHistory($)
  const m = await read($, main)
  const now = await $.clock.now()
  const spin = await spinOf($, E)
  const session = await $.session.id().catch(() => '')
  // This session's finished agents only, and only once they have left the graph/list.
  const pastItems = hist.items.filter(it => it.session === session && !list.some(n => n.kind !== 'workflow' && (n.startedAt ?? n.endedAt) === it.at && (n.label || n.kind) === it.label))
  const real = list.filter(n => n.kind !== 'workflow')
  const sel: AgentsView = u.agents ?? 'graph'
  const top = chips($, E, sel, { graph: runsOf(list, now).length, list: real.length, history: pastItems.length })
  if (sel === 'history') {
    return (
      <E.Box flexDirection="column" gap={1}>
        {top}
        {historyView(E, pastItems, w, rows)}
      </E.Box>
    )
  }
  if (sel === 'graph') {
    const g = graphView($, E, list, u.folded ?? {}, w, now, spin, m, u.run, true)
    return (
      <E.Box flexDirection="column" gap={1}>
        {top}
        {list.length ? (
          <E.Box flexDirection="column">
            <E.Box justifyContent="flex-end" gap={2}>{u.run && pickRun(runsOf(list, now), m, u.run)?.id !== pickRun(runsOf(list, now), m)?.id ? <E.Button key="run:live" plain onPress={() => update($, ui, x => ({ ...x, run: undefined }))}><E.Text color="suggestion">◂ live</E.Text></E.Button> : null}{g.aside}</E.Box>
            {g.body}
          </E.Box>
        ) : idleArt(E, w, 'no agents')}
        {earlierRuns($, E, list, w, now, m, u.run)}
      </E.Box>
    )
  }
  const tree = buildTree(list).slice(0, 80)
  const c = counts(real, list)
  const t0 = Math.min(...list.map(n => n.startedAt ?? now), now)
  const maxSteps = Math.max(1, ...list.map(n => n.steps))
  const mode: 'two' | 'one' | 'compact' = w >= WIDE ? 'one' : w < 48 || rows < 2 * tree.length + 6 ? 'compact' : 'two'
  const room = Math.max(4, mode === 'two' ? Math.floor((rows - 6) / 2) : rows - 6)
  const shown = tree.slice(0, room)
  return (
    <E.Box flexDirection="column" gap={1}>
      {top}
      <E.Box flexDirection="column">
        <E.Box flexDirection="row" justifyContent="space-between">
          <E.Text wrap="truncate-end">
            <E.Text color="claude" weight="bold">◆ main  </E.Text>
            <E.Text color="claude">{shortModel(m.model || 'claude')}</E.Text>
            {m.effort ? <E.Text dimColor> · {m.effort}</E.Text> : ''}
          </E.Text>
          {mode === 'one' ? <E.Box width={Math.max(10, w - 91)} flexShrink={0} flexDirection="row" justifyContent="space-between"><E.Text dimColor>{clock(now - t0)} ago</E.Text><E.Text dimColor>now</E.Text></E.Box> : <E.Text dimColor>{countText(c, spin)}</E.Text>}
        </E.Box>
        {shown.length ? shown.map(row => treeRow($, E, row, list, w, now, spin, t0, maxSteps, mode)) : idleArt(E, w, 'no agents')}
        {tree.length > shown.length ? <E.Text dimColor>   +{tree.length - shown.length} more</E.Text> : null}
      </E.Box>
    </E.Box>
  )
}

// ---------- the agent detail, inside the panel ----------

const isUnder = (x: AgentNode, root: string, list: AgentNode[]) => {
  let p = x.parentNode
  for (let i = 0; p && i < 10; i++) {
    if (p === root) return true
    p = list.find(n => n.id === p)?.parentNode
  }
  return false
}

async function detailView($: $, E: E, id: string, w: number, rows: number) {
  const list = await displayNodes($)
  const n = list.find(x => x.id === id)
  const driver = babysitterDrivers(await read($, nodes), await read($, edits)).get(id)
  if (!n) {
    return (
      <E.Button key="detail:gone" plain onPress={() => update($, ui, u => ({ ...u, detail: undefined }))}>
        <E.Text dimColor>‹ Agents  · that agent has left the list</E.Text>
      </E.Button>
    )
  }
  const now = await $.clock.now()
  const spin = await spinOf($, E)
  const state = stateOf(n, list)
  const running = state === 'running'
  const tint = colorOf(provOf(n))
  const maxSteps = Math.max(1, ...list.map(x => x.steps))
  const wide = w >= WIDE
  const colW = wide ? Math.floor((w - 2) / 2) : w
  const chain: AgentNode[] = []
  for (let p = n.parentNode ? list.find(x => x.id === n.parentNode) : undefined; p && chain.length < 4; p = p.parentNode ? list.find(x => x.id === p!.parentNode) : undefined) chain.unshift(p)
  const sub = buildTree(list.filter(x => x.id !== n.id && isUnder(x, n.id, list)))
  const card = await activityCard($, E, colW, 8, n.agentId ?? (n.provider && n.provider !== 'claude' ? `node:${n.id}` : n.id))
  let latest = ''
  if (n.agentId) {
    const msgs = await $.session.messages({ agentId: n.agentId }).catch(() => [])
    if (Array.isArray(msgs)) latest = [...msgs].reverse().find(x => x.role === 'assistant' && x.text.trim())?.text.trim() ?? ''
  }
  const trail = [...(n.trail ?? [])].reverse()
  const left: any[] = []
  const right: any[] = []
  if (n.input) {
    const lines = promptLines(n.input, Math.max(1, colW - 4))
    const key = `prompt:${n.id}`
    const open = (await read($, ui)).folded?.[key] === false
    left.push(Card(E, 'prompt', 'PROMPT', tint, <E.Box flexDirection="column">
      {lines.slice(0, open ? 400 : 14).map((t, i) => <E.Text key={`${key}:${i}`}>{t}</E.Text>)}
      {open && lines.length > 400 ? <E.Text dimColor>+{lines.length - 400} more lines</E.Text> : null}
      {lines.length > 14 ? <E.Button key={`fold:${key}`} plain onPress={() => update($, ui, u => ({ ...u, folded: { ...(u.folded ?? {}), [key]: open } }))}>
        <E.Text color={tint}>{open ? '▾ show less' : `▸ show all (${lines.length} lines)`}</E.Text>
      </E.Button> : null}
    </E.Box>, { width: colW }))
  }
  if (sub.length) {
    left.push(Card(E, 'children', 'CHILDREN', 'subtle', <E.Box flexDirection="column">{sub.slice(0, 12).map(row => treeRow($, E, row, list, colW - 4, now, spin, now, maxSteps, 'compact'))}</E.Box>, { width: colW, aside: <E.Text dimColor>{countText(counts(sub.map(r => r.node), list), spin)}</E.Text> }))
  }
  if (card) right.push(card)
  if (trail.length) {
    right.push(Card(E, 'tools', 'TOOLS', 'suggestion', (
      <E.Box flexDirection="column">
        {trail.slice(0, 8).map((t, i) => (
          <E.Text key={`tool${i}`} wrap="truncate-end">
            <E.Text color={i === 0 && running ? tint : 'success'} dimColor={i === 0 && running ? undefined : true}>{i === 0 && running ? spin : '✓'} </E.Text>
            <E.Text>{padR(t.tool, 8)}</E.Text>
            <E.Text dimColor>{padR(fitStart(t.arg ?? '', colW - 20), colW - 20)}</E.Text>
            <E.Text dimColor>{padL(ago(now - t.at), 5)}</E.Text>
          </E.Text>
        ))}
        {trail.length > 8 ? <E.Text dimColor>+{trail.length - 8} earlier</E.Text> : null}
      </E.Box>
    ), { width: colW }))
  }
  const said = !running ? n.output || latest : latest
  if (said) {
    right.push(Card(E, 'result', running ? 'LATEST' : state === 'failed' ? 'RESULT ✗' : 'RESULT ✓', running ? 'subtle' : state === 'failed' ? 'error' : 'success', (
      <E.Box flexDirection="column">{wrapText(said, colW - 4, Math.max(4, Math.min(16, rows - 14))).map((t, i) => <E.Text key={`res${i}`}>{t}</E.Text>)}</E.Box>
    ), { width: colW }))
  }
  return (
    <E.Box flexDirection="column" gap={1}>
      <E.Box flexDirection="row" gap={1} flexWrap="wrap">
        <E.Button key="detail:back" hotkey="0" plain onPress={() => update($, ui, u => ({ ...u, detail: undefined }))}>
          <E.Text color="claude" weight="bold">‹ Agents</E.Text>
        </E.Button>
        {chain.map(p => (
          <E.Button key={`crumb:${p.id}`} plain dimColor onPress={() => void openDetail($, p.id)}>› {fit(p.label, 18)}</E.Button>
        ))}
      </E.Box>
      {driver ? <E.Text key="detail:driver" dimColor>Driven by Claude {shortModel(driver.model)}</E.Text> : null}
      <E.Box flexDirection="column" borderStyle="round" borderColor={running ? tint : state === 'failed' ? 'error' : 'success'} paddingX={1}>
        <E.Box flexDirection="row" justifyContent="space-between">
          <E.Text weight="bold" wrap="truncate-end">
            <E.Text color={running ? tint : state === 'failed' ? 'error' : 'success'}>{n.kind === 'workflow' ? '◇' : running ? spin : state === 'done' ? '✓' : '✗'} </E.Text>
            {n.label || n.kind}
          </E.Text>
          <E.Text color={state === 'failed' ? 'error' : undefined} weight="bold">{running && E.desk ? '' : clock((running ? now : n.endedAt ?? now) - (n.startedAt ?? now))}</E.Text>
        </E.Box>
        <E.Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <E.Text wrap="truncate-end">
            <E.Text color={colorOf(provOf(n))}>● {nodeModel(n)}</E.Text>
            <E.Text>  </E.Text>
            <E.Text {...filled(E, 'suggestion')} weight="bold"> {n.kind} </E.Text>
            {n.kind !== 'workflow' ? <E.Text color={colorOf(provOf(n))}>  {pips(state === 'done' ? 100 : (100 * n.steps) / maxSteps, 10)}</E.Text> : ''}
            <E.Text dimColor>  {n.steps ? `${plural(n.steps, 'step')}` : ''}</E.Text>
          </E.Text>
          {n.agentId ? (
            <E.Box flexDirection="row" gap={2}>
              {running ? (
                <E.Button key="detail:stop" hotkey="8" plain onPress={() => void stopAgent($, n.id)}>
                  <E.Text color={n.stopping ? 'inactive' : 'error'}>{n.stopping ? '■ stopping…' : '■ stop'}</E.Text>
                </E.Button>
              ) : null}
              <E.Button key="detail:transcript" hotkey="9" plain dimColor onPress={() => void $.ui.view({ agentId: n.agentId! })}>→ transcript</E.Button>
            </E.Box>
          ) : null}
        </E.Box>
        {n.dir ? <E.Text wrap="truncate-end" dimColor>{n.dir}</E.Text> : null}
      </E.Box>
      {n.offRoute ? <E.Text key="detail:off-route" color="warning">off-route: {n.offRoute}</E.Text> : null}
      {wide ? (
        <E.Box flexDirection="row" gap={2}>
          <E.Box flexDirection="column" gap={1} width={colW}>{left}</E.Box>
          <E.Box flexDirection="column" gap={1} width={colW}>{right}</E.Box>
        </E.Box>
      ) : (
        <E.Box flexDirection="column" gap={1}>{[...left, ...right]}</E.Box>
      )}
    </E.Box>
  )
}

// ---------- models: chat model, Claude's role, and the providers that take work ----------

const ROLES: { id: Routing['role']; title: string; color: string }[] = [
  { id: 'plan', title: 'Plans only', color: 'planMode' },
  { id: 'auto', title: 'Auto', color: 'claude' },
  { id: 'claude', title: 'Claude only', color: 'warning' },
]

function tagSelect($: $, E: E, r: Routing, p: Provider) {
  return <E.Select key={`tag:${p}`} options={TAGS} value={tagOf(r, p)} onSelect={(v: RoutingTag) => saveRouting($, x => withTag(x, p, v))} />
}

function providerMeter(info: Providers[Provider], p: Provider, now: number) {
  const worst = info.meters.filter(m => m.label !== 'Context').sort((a, b) => b.percent - a.percent)[0]
  if (!worst) return
  const percent = `${p === 'opencode' && info.usageSource !== 'live' ? '≈' : ''}${Math.round(Math.max(0, 100 - worst.percent))}%`
  const exact = worst.detail?.split(' · ')[0]?.match(/^(.*?) of (.*?)(?: credits)?$/)
  const label = `${percent} left${exact ? ` · ${exact[1]}/${exact[2]}${/credits/.test(worst.detail!) ? ' cr' : ''}` : ''}${usageAge(info, now) ? ` · ${usageAge(info, now)}` : ''}`
  return { worst, percent, label }
}

function providerUsage(E: E, info: Providers[Provider], p: Provider, r: Routing, now: number, usageW: number, maxLabelLen: number, narrow = false) {
  if (info.status === 'missing') return <E.Text dimColor wrap="truncate-end">{narrow ? 'none' : info.error === NOT_INSTALLED ? 'not installed' : 'not set up'}</E.Text>
  const state = quotaState(info, p, r)
  if (state) return <E.Text color="error" wrap="truncate-end">{narrow ? 'out' : state}</E.Text>
  const meter = providerMeter(info, p, now)
  if (!meter) return leftOf(E, info, p, 8)
  const { worst, percent, label } = meter
  if (narrow) return <E.Text wrap="truncate-end" color={heat(worst.percent)}>{percent}</E.Text>
  if (E.desk) {
    const width = usageW * 8, color = svgColor(colorOf(p)), textW = maxLabelLen * 8 + 10, stacked = width < textW + 80
    const meterW = stacked ? width : width - textW, y = stacked ? 22 : 10, height = stacked ? 36 : 30
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgText}<rect y="${y}" width="${meterW}" height="10" rx="3" fill="${color}" opacity=".18"/><rect y="${y}" width="${meterW * Math.max(0, 100 - worst.percent) / 100}" height="10" rx="3" fill="${color}"/><text x="${stacked ? 0 : meterW + 8}" y="${stacked ? 14 : 20}">${svgEscape(label)}</text></svg>`
    return <E.Svg key={`provider:meter:${p}`} source={source} width={width} height={height} alt={`${nameOf(p)} ${label}`} />
  }
  return <E.Text wrap="truncate-end"><E.Text color={colorOf(p)}>{bar(100 - worst.percent, Math.max(10, usageW - maxLabelLen - 1))}</E.Text> {label}</E.Text>
}

async function providerView($: $, E: E, p: Provider, w: number) {
  const r = await read($, routing)
  const u = await read($, ui)
  const all = await read($, providers).then(allOf)
  const m = await read($, main)
  const info = all[p]
  const color = colorOf(p)
  const isClaude = p === 'claude'
  const chat = m.model.replace(/\[.*\]$/, '')
  const speeds = await read($, modelSpeeds)
  const allowed = r.picks.map((x, i) => ({ ...x, at: i + 1 })).filter(x => x.provider === p)
  const rest = info.models.filter(x => !allowed.some(y => y.model === x.id))
  const listW = Math.max(16, Math.min(30, w - 30))
  return (
    <E.Box flexDirection="column" gap={1}>
      <E.Box flexDirection="row" gap={2} flexWrap="wrap">
        <E.Button key="edit:back" hotkey="0" plain onPress={() => update($, ui, u => ({ ...u, editing: undefined }))}>
          <E.Text color="claude" weight="bold">‹ Models</E.Text>
        </E.Button>
        <E.Text color={color} weight="bold">● {nameOf(p)}</E.Text>
        {info.plan ? <E.Text dimColor>plan {info.plan}</E.Text> : null}
        {leftOf(E, info, p, 8, await $.clock.now())}
      </E.Box>
      <E.Box flexDirection="row" gap={2} flexWrap="wrap" alignItems="flex-start">
        {isClaude ? null : <E.Button key={`pon:${p}`} hotkey="1" plain onPress={() => saveRouting($, x => ({ ...x, on: { ...x.on, [p]: !x.on[p] }, paused: Object.fromEntries(Object.entries(x.paused ?? {}).filter(([q]) => q !== p)) }))}>
          {Chip(E, r.on[p] ? '◉ On' : '○ Off', r.on[p], 'success')}
        </E.Button>}
        {p === 'antigravity' ? agyControls($, E, r, info.models, Math.min(w - 4, 52)) : null}
        <E.Text dimColor>{u.preset ? 'preset' : 'this chat'}</E.Text>
        {tagSelect($, E, r, p)}
        {!isClaude ? <E.Box flexDirection="row" gap={1}>
          <E.Button key={`pup:${p}`} plain onPress={() => saveRouting($, x => ({ ...x, order: move(x.order, p, -1) as Provider[] }))}>↑</E.Button>
          <E.Button key={`pdown:${p}`} plain onPress={() => saveRouting($, x => ({ ...x, order: move(x.order, p, 1) as Provider[] }))}>↓</E.Button>
        </E.Box> : null}
      </E.Box>
      {info.status === 'missing' && !info.meters.length ? <E.Box key={`missing:${p}`} flexDirection="row" gap={2} flexWrap="wrap" borderStyle="round" borderColor="warning" paddingX={1}>
        <E.Text color="warning" weight="bold">{info.error === NOT_INSTALLED ? `${nameOf(p)} is not installed on this machine` : `${nameOf(p)} is not set up: ${info.error ?? 'unavailable'}`}</E.Text>
        <E.Text dimColor>no work is routed to it</E.Text>
        <E.Button key={`recheck:${p}`} plain onPress={async () => { await recheck($, p); $.ui.toast((await read($, providers).then(allOf))[p].status === 'missing' ? `${nameOf(p)}: still not found` : `${nameOf(p)} found`) }}><E.Text color="suggestion">↻ check again</E.Text></E.Button>
      </E.Box> : null}
      {(info.status !== 'missing' || info.meters.length) && (info.meters.length || info.note || info.error) ? Card(E, `usage:${p}`, 'USAGE', 'subtle', <E.Box flexDirection="column">{meterRows(E, info.meters, w - 4, p === 'opencode' && info.usageSource !== 'live', usageAge(info, await $.clock.now()))}{info.note ? <E.Text dimColor>{info.note}</E.Text> : null}{info.error ? <E.Text color="error">{info.error}</E.Text> : null}{info.facts.length ? <E.Text dimColor wrap="truncate-end">{info.facts.slice(0, 3).join('  ·  ')}</E.Text> : null}</E.Box>) : null}
      {isClaude && info.models.some(x => x.isDefault) ? Card(E, 'chat', 'CHAT MODEL', 'claude', (
        <E.Box flexDirection="column">
          {info.models.filter(x => x.isDefault).map(x => (
            <E.Button key={`chat:${x.id}`} plain onPress={async () => { const args = x.id + (/\[.*\]$/.exec(m.model)?.[0] ?? ''); await $.command.run({ command: 'model', args }); await update($, main, y => ({ ...y, model: args })) }}>
              <E.Text color={x.id === chat ? 'claude' : undefined} weight={x.id === chat ? 'bold' : undefined}>{x.id === chat ? '● ' : '○ '}{padR(shortModel(x.id), 14)}</E.Text>
              <E.Text dimColor>{fit(x.info ?? '', Math.max(0, w - 24))}</E.Text>
            </E.Button>
          ))}
        </E.Box>
      )) : null}
      {optimizeControls($, E, r)}
      {adversaryControls($, E, r)}
      {Card(E, `allowed:${p}`, 'ALLOWED', color, allowed.length ? (
        <E.Box flexDirection="column" gap={1}>
          {allowed.map(x => (
            <E.Box key={`allowed:${x.model}`} flexDirection="column">
            <E.Box flexDirection="row" alignItems="flex-end" gap={1} flexWrap="wrap">
              <E.Text wrap="truncate-end">
                <E.Text color={color} weight="bold">{String(x.at).padStart(2)}  </E.Text>
              </E.Text>
              <E.Box flexDirection="column" flexGrow={1} flexShrink={1}>
                {modelPicker($, E, u, `model:${p}/${x.model}`, info.models.filter(m => m.id === x.model || !allowed.some(q => q.model === m.id)), x.model, model => saveModel($, p, model, x.model), listW)}
              </E.Box>
              {modelSpeed(E, speeds, x.model)}
              <E.Box flexDirection="row" gap={1}>
                {[-1, 1].map(by => <E.Button key={`${by < 0 ? 'up' : 'down'}:${p}/${x.model}`} plain onPress={() => saveRouting($, y => {
                  const picks = [...y.picks], at = picks.findIndex(q => q.provider === p && q.model === x.model), to = at + by
                  if (at >= 0 && to >= 0 && to < picks.length) [picks[at], picks[to]] = [picks[to]!, picks[at]!]
                  return withPicks(y, picks)
                })}>{by < 0 ? '↑' : '↓'}</E.Button>)}
              <E.Button key={`note:${p}/${x.model}`} plain onPress={() => update($, ui, y => ({ ...y, note: y.note === `${p}/${x.model}` ? undefined : `${p}/${x.model}` }))}>note</E.Button>
              <E.Button key={`mdel:${x.model}`} plain onPress={() => saveRouting($, y => withPicks(y, y.picks.filter(q => !(q.provider === p && q.model === x.model))))}>
                <E.Text color="error">✕</E.Text>
              </E.Button>
              </E.Box>
            </E.Box>
            {u.note === `${p}/${x.model}` ? <E.Input key={`noteinput:${p}/${x.model}`} value={x.note ?? ''} placeholder="when to use it" submitLabel="save" onSubmit={async (v: string) => {
              const note = v.trim().slice(0, 160)
              await saveRouting($, y => withPicks(y, y.picks.map(q => q.provider === p && q.model === x.model ? { ...q, note: note || undefined } : q)))
              await update($, ui, y => ({ ...y, note: undefined }))
            }} /> : x.note ? <E.Text dimColor>{x.note}</E.Text> : null}
            </E.Box>
          ))}
        </E.Box>
      ) : <E.Text dimColor>no models</E.Text>)}
      {rest.length ? Card(E, `avail:${p}`, 'AVAILABLE', 'subtle', (
        <E.Box flexDirection="column">
          <E.Button key={`model:add:${p}`} plain onPress={() => update($, ui, x => ({ ...x, addModel: x.addModel === `models:${p}` ? undefined : `models:${p}` }))}>{u.addModel === `models:${p}` ? 'Cancel' : '+ model'}</E.Button>
          {u.addModel === `models:${p}` ? modelPicker($, E, u, `model:addmodel:${p}`, rest, undefined, async model => {
            await saveModel($, p, model)
            await update($, ui, x => ({ ...x, addModel: undefined }))
          }, w - 8) : null}
        </E.Box>
      )) : null}
    </E.Box>
  )
}

async function modelsTab($: $, E: E, w: number, rows: number) {
  const now = await $.clock.now()
  const u = await read($, ui)
  if (u.editing) return providerView($, E, u.editing, w)
  const r = await read($, routing)
  const all = await read($, providers).then(allOf)
  const m = await read($, main)
  const chat = (m.model || (await $.session.model().catch(() => ''))).replace(/\[.*\]$/, '')
  const settings = (await $.settings.read().catch(() => ({}))) as Record<string, any>
  const effort: string = m.effort ?? settings.modelSettings?.[chat]?.effortLevel ?? settings.effortLevel ?? 'medium'
  const crow = all.claude.models.find(x => x.id === chat)
  const levels = crow?.efforts?.length ? LEVELS.filter(l => crow.efforts!.includes(l)) : LEVELS
  const paused = r.role === 'claude'
  const live = livePicks(r).filter(x => !all[x.provider].alert)
  const narrow = w < 80
  const inlineSpeed = w >= (E.desk ? 100 : 80)
  const modelW = Math.max(12, Math.min(32, narrow ? w - 27 : w - (E.desk ? 61 : 47) - (inlineSpeed ? 11 : 0)))
  const speeds = await read($, modelSpeeds)
  const usageW = Math.max(6, w - (E.desk ? 60 : 46))
  const maxQuotaLabel = Math.max(0, ...(['claude', ...r.order] as Provider[]).map(p => providerMeter(all[p], p, now)?.label.length ?? 0))
  const setPicks = (fn: (ps: Routing['picks']) => Routing['picks']) => saveRouting($, x => withPicks(x, fn(x.picks)))
  const modelRow = (x: Routing['picks'][number], i: number) => {
    const isLive = !paused && live.includes(x)
    const key = `${x.provider}/${x.model}`
    const same = (q: { provider: Provider; model: string }) => q.provider === x.provider && q.model === x.model
    const efforts = modelEfforts(x.provider, all[x.provider].models, x.model)
    const rank = (by: number) => setPicks(ps => {
      const out = [...ps]
      const at = out.findIndex(same)
      if (at >= 0 && at + by >= 0 && at + by < out.length) [out[at], out[at + by]] = [out[at + by]!, out[at]!]
      return out
    })
    return <E.Box key={`pick:${key}`} flexDirection="column">
      <E.Box flexDirection="row" gap={1} alignItems="center">
        <E.Box key={`mcol:rank:${key}`} width={narrow ? 3 : 4} flexShrink={0}><E.Text color={isLive ? colorOf(x.provider) : 'inactive'} wrap="truncate-end">{fit(`#${i + 1}`, 4)}</E.Text></E.Box>
        <E.Box key={`mcol:model:${key}`} width={modelW} flexShrink={0} flexDirection="column"><E.Button key={`model:open:${key}`} plain onPress={() => update($, ui, u => ({ ...u, editing: x.provider }))}><E.Text color={colorOf(x.provider)} weight={isLive ? 'bold' : undefined} dimColor={!isLive || undefined} wrap="truncate-end">{fit(shortModel(x.model), modelW)}</E.Text></E.Button>{!inlineSpeed ? modelSpeed(E, speeds, x.model) : null}</E.Box>
        {inlineSpeed ? <E.Box width={10} flexShrink={0}>{modelSpeed(E, speeds, x.model)}</E.Box> : null}
        {!narrow ? <E.Box key={`mcol:prov:${key}`} width={13} flexShrink={0}><E.Text color={colorOf(x.provider)} wrap="truncate-end">{fit(nameOf(x.provider), 13)}</E.Text></E.Box> : null}
        <E.Box key={`mcol:effort:${key}`} width={12} flexShrink={0}>
          {efforts?.length ? <E.Select key={`effort:${key}`} options={['default', ...efforts].map(value => ({ value }))} value={x.effort ?? 'default'} onSelect={(v: string) => setPicks(ps => ps.map(q => same(q) ? { ...q, effort: v === 'default' ? undefined : v } : q))} /> : <E.Text dimColor wrap="truncate-end">—</E.Text>}
        </E.Box>
        <E.Box key={`mcol:act:${key}`} width={narrow ? 5 : E.desk ? 24 : 10} flexShrink={0} flexDirection="row" gap={1}>
          {!narrow ? <E.Button key={`up:${key}`} plain dimColor={i === 0 || undefined} onPress={() => rank(-1)}>↑</E.Button> : null}
          {!narrow ? <E.Button key={`down:${key}`} plain dimColor={i === r.picks.length - 1 || undefined} onPress={() => rank(1)}>↓</E.Button> : null}
          {!narrow ? <E.Button key={`note:${key}`} plain onPress={() => update($, ui, y => ({ ...y, note: y.note === key ? undefined : key }))}><E.Text color={x.note ? 'suggestion' : 'inactive'}>note</E.Text></E.Button> : null}
          <E.Button key={`del:${key}`} plain onPress={() => setPicks(ps => ps.filter(q => !same(q)))}><E.Text color="error">✕</E.Text></E.Button>
        </E.Box>
      </E.Box>
      {u.note === key ? <E.Box paddingLeft={5}>
        <E.Input key={`noteinput:${key}`} value={x.note ?? ''} placeholder="when to use it · e.g. hard bugs and design, or quick summaries" submitLabel="save" onSubmit={async (v: string) => {
          const note = v.trim().slice(0, 160)
          await setPicks(ps => ps.map(q => same(q) ? { ...q, note: note || undefined } : q))
          await update($, ui, y => ({ ...y, note: undefined }))
        }} />
      </E.Box> : x.note ? <E.Text dimColor italic wrap="truncate-end">{'     ↳ '}{x.note}</E.Text> : null}
    </E.Box>
  }
  const babysitter = await babysitterRow($, E, modelW)
  const providerRow = (p: Provider) => {
    const on = p === 'claude' || (r.on[p] && !paused && !r.paused?.[p])
    return <E.Box key={`prow:${p}`} flexDirection="column">
      <E.Box key={`provider:controls:${p}`} flexDirection="row" gap={1} alignItems="flex-start">
        <E.Box key={`pcol:rank:${p}`} width={2} flexShrink={0}><E.Text dimColor>{p !== 'claude' && r.useOrder !== false ? `${r.order.indexOf(p) + 1}.` : ''}</E.Text></E.Box>
        <E.Box key={`pcol:on:${p}`} width={E.desk ? 7 : 5} flexShrink={0}>
          {p === 'claude' ? <E.Text color="claude">◆</E.Text> : <E.Button key={`on:${p}`} plain onPress={() => saveRouting($, x => ({ ...x, on: { ...x.on, [p]: !x.on[p] }, paused: Object.fromEntries(Object.entries(x.paused ?? {}).filter(([q]) => q !== p)) }))}>{Chip(E, r.on[p] ? 'On' : 'Off', r.on[p], 'success')}</E.Button>}
        </E.Box>
        <E.Box key={`pcol:name:${p}`} width={narrow ? E.desk ? 17 : 15 : E.desk ? 18 : 15} flexShrink={0}>
          <E.Button key={`open:${p}`} plain onPress={() => update($, ui, x => ({ ...x, editing: p }))}><E.Text color={on ? colorOf(p) : 'inactive'} weight="bold">{nameOf(p)} ▸</E.Text></E.Button>
        </E.Box>
        <E.Box key={`pcol:tag:${p}`} width={narrow ? E.desk ? 11 : 9 : E.desk ? 13 : 10} flexShrink={0}>{tagSelect($, E, r, p)}</E.Box>
        <E.Box key={`pcol:usage:${p}`} width={narrow ? 4 : usageW} flexShrink={0}>{providerUsage(E, all[p], p, r, now, usageW, maxQuotaLabel, narrow)}</E.Box>
        {!(E.desk && w < 64) ? <E.Box key={`pcol:act:${p}`} width={E.desk ? 11 : 5} flexShrink={0} flexDirection="row" gap={1}>
          {p === 'claude' ? null : [-1, 1].map(by => <E.Button key={`${by < 0 ? 'pup' : 'pdown'}:${p}`} plain dimColor={r.order.indexOf(p) === (by < 0 ? 0 : r.order.length - 1) || undefined} onPress={() => saveRouting($, x => ({ ...x, order: move(x.order, p, by) as Provider[] }))}>{by < 0 ? '↑' : '↓'}</E.Button>)}
        </E.Box> : null}
      </E.Box>
      {p === 'claude' ? babysitter : null}
      {narrow && quotaState(all[p], p, r) ? <E.Text color="error" wrap="truncate-end">{nameOf(p)} · {quotaState(all[p], p, r)}</E.Text> : null}
      {tagOf(r, p) === 'main' && !r.picks.some(x => x.provider === p) ? <E.Text dimColor>no allowed model</E.Text> : null}
    </E.Box>
  }
  return (
    <E.Box flexDirection="column" gap={1}>
      {Card(E, 'card:chat', 'CHAT', 'claude', (
        <E.Box flexDirection="column" gap={1}>
        <E.Box key="chat:choices" flexDirection="row" columnGap={2} rowGap={E.desk ? 2 : 0} flexWrap="wrap">
          <E.Button key="open:claude-chat" plain onPress={() => update($, ui, x => ({ ...x, editing: 'claude' as const }))}>
            <E.Text color="claude" weight="bold">◆ {shortModel(chat || 'claude')} </E.Text>
            <E.Text color="suggestion">▸</E.Text>
          </E.Button>
          <E.Box flexDirection="row" columnGap={1} rowGap={E.desk ? 1 : 0} flexWrap="wrap">
            {levels.map(l => (
              <E.Button key={`effort:${l}`} plain onPress={async () => {
                await $.command.run({ command: 'effort', args: l })
                await update($, main, x => ({ ...x, effort: l }))
              }}>
                {Chip(E, l, l === effort, LEVEL_COLOR[LEVELS.indexOf(l)])}
              </E.Button>
            ))}
          <E.Button key="ultracode" plain onPress={async () => {
            const on = !m.ultracode
            await $.command.run({ command: 'effort', args: on ? 'ultracode on' : 'ultracode off' })
            await update($, main, x => ({ ...x, ultracode: on }))
          }}>
            {Chip(E, m.ultracode ? '◉ ultracode' : '○ ultracode', !!m.ultracode, 'planMode')}
          </E.Button>
          </E.Box>
        </E.Box>
          {SettingsRow(E, 'chat:role', 'Role', ROLES.map((x, i) => <E.Button key={`seg:CLAUDE:${x.id}`} hotkey={String(i + 1)} plain onPress={() => saveRouting($, y => ({ ...y, role: x.id }))}>{Chip(E, x.title, r.role === x.id, x.color)}</E.Button>))}
        </E.Box>
      ))}
      {await presetsCard($, E)}
      {await taskRoutingCard($, E, w)}
      {await confidentialCard($, E, w)}
      {optimizeControls($, E, r)}
      {adversaryControls($, E, r)}
      {await adversarialCard($, E)}
      {Card(E, 'card:models', 'MODELS', paused ? 'inactive' : 'claude', (
        <E.Box flexDirection="column">

          {r.picks.length ? r.picks.map(modelRow) : <E.Text dimColor>no models</E.Text>}
        </E.Box>
      ), { aside: <E.Text dimColor>allowed, smartest first · {paused ? 'paused · Claude only' : `${live.length} of ${r.picks.length} active`}</E.Text> })}
      {Card(E, 'card:providers', 'PROVIDERS', paused ? 'inactive' : 'suggestion', (
        <E.Box flexDirection="column">{(['claude', ...r.order] as Provider[]).map(providerRow)}</E.Box>
      ), { aside: <E.Box flexDirection="row" gap={1} flexWrap="wrap">
        <E.Text dimColor>this chat</E.Text>
        <E.Text dimColor>{r.order.filter(p => r.on[p]).length} on</E.Text>
        <E.Button key="useOrder" plain onPress={() => saveRouting($, x => ({ ...x, useOrder: x.useOrder === false }))}>{Chip(E, r.useOrder !== false ? 'In order: On' : 'In order: Off', r.useOrder !== false)}</E.Button>
      </E.Box> })}
      {await scoreCard($, E, w)}
      {await routeLogCard($, E, w, now)}
    </E.Box>
  )
}

// Each model's record from the agent history: how much it did, how often it failed or was redone,
// and for side providers roughly what a task cost today.
async function scoreCard($: $, E: E, w: number) {
  const hist = await agentHistory($)
  const scores = scorecard(hist.items).slice(0, 10)
  if (!scores.length) return null
  const c = await read($, costs)
  const pr = await read($, prices)
  const spent = new Map<string, number>()
  const add = (model: string, usd?: number) => usd !== undefined && spent.set(priceKey(model), (spent.get(priceKey(model)) ?? 0) + usd)
  for (const row of c.rows) if (row.provider !== 'commandcode') add(row.model, rowCost(row, pr))
  for (const [model, t] of Object.entries(c.agy)) add(model, costOf(t, priceOf(pr, model)))
  const today = new Date(await $.clock.now()).toDateString()
  const todayTasks = new Map<string, number>()
  for (const it of hist.items) if (new Date(it.at).toDateString() === today) todayTasks.set(priceKey(it.model), (todayTasks.get(priceKey(it.model)) ?? 0) + 1)
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—')
  const modelW = Math.max(14, Math.min(26, w - 52))
  return Card(E, 'card:score', 'SCORECARD', 'subtle', (
    <E.Box flexDirection="column">
      <E.Text dimColor wrap="truncate-end">{`  ${padR('model', modelW)} ${padL('tasks', 5)} ${padL('failed', 7)} ${padL('redone', 7)} ${padL('avg', 7)} ${padL('≈$/task', 8)}`}</E.Text>
      {scores.map(x => {
        const p = x.provider ?? providerOf(x.model)
        const usd = p === 'claude' ? undefined : spent.get(priceKey(x.model))
        const n = todayTasks.get(priceKey(x.model)) ?? 0
        const failRate = x.tasks ? x.failed / x.tasks : 0
        return (
          <E.Text key={`score:${x.model}`} wrap="truncate-end">
            <E.Text color={colorOf(p)}>● {padR(shortModel(x.model), modelW)}</E.Text>
            <E.Text weight="bold"> {padL(String(x.tasks), 5)}</E.Text>
            <E.Text color={failRate >= 0.25 ? 'error' : failRate > 0 ? 'warning' : undefined} dimColor={failRate ? undefined : true}> {padL(pct(x.failed, x.tasks), 7)}</E.Text>
            <E.Text color={x.redone ? 'warning' : undefined} dimColor={x.redone ? undefined : true}> {padL(pct(x.redone, x.tasks), 7)}</E.Text>
            <E.Text dimColor> {padL(clock(x.avgMs), 7)}</E.Text>
            <E.Text> {padL(usd !== undefined && n ? money(usd / n) : '—', 8)}</E.Text>
          </E.Text>
        )
      })}
    </E.Box>
  ), { aside: <E.Text dimColor>last {hist.items.length} tasks · redone = same task again within 30m</E.Text> })
}

// ---------- activity ----------

// One side of a change: lines also on the other side are greyed, the rest carry the colour.
function changeSide(E: E, key: string, title: string, lines: string[], other: Set<string>, color: string, width: number, max: number) {
  const shown = lines.slice(0, max)
  const changed = lines.filter(l => !other.has(l.trim())).length
  return (
    <E.Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={width} flexShrink={1}>
      <E.Box flexDirection="row" justifyContent="space-between">
        <E.Text color={color} weight="bold">{title}</E.Text>
        <E.Text dimColor>{changed} changed · {plural(lines.length, 'line')}</E.Text>
      </E.Box>
      {shown.length ? shown.map((l, i) => {
        const same = other.has(l.trim())
        return (
          <E.Text key={`${key}${i}`} wrap="truncate-end">
            <E.Text dimColor>{String(i + 1).padStart(3)} </E.Text>
            <E.Text color={same ? undefined : color} dimColor={same ? true : undefined} weight={same ? undefined : 'bold'}>{same ? '  ' : color === 'error' ? '− ' : '+ '}{fit(l.replace(/\t/g, '  '), width - 10) || ' '}</E.Text>
          </E.Text>
        )
      }) : <E.Text dimColor>empty</E.Text>}
      {lines.length > max ? <E.Text dimColor>    +{lines.length - max} more lines</E.Text> : null}
    </E.Box>
  )
}

async function activityTab($: $, E: E, w: number, rows: number) {
  const u = await read($, ui)
  const card = await activityCard($, E, w, Math.max(6, Math.floor(rows / 4)))
  const list = await read($, edits)
  const qa = await read($, grill)
  const qaEditing = !!(await read($, ui)).qaEdit
  const parts: any[] = []
  if (card) parts.push(card)
  if (list.length) {
    // Files, newest first, each pressable to open its changes below.
    const byFile = new Map<string, { file: string; added: number; removed: number; n: number; last: number; who: EditItem; pending: number }>()
    list.forEach((x, i) => {
      const prev = byFile.get(x.file)
      byFile.set(x.file, { file: x.file, added: (prev?.added ?? 0) + (x.added ?? 0), removed: (prev?.removed ?? 0) + (x.removed ?? 0), n: (prev?.n ?? 0) + 1, last: i, who: x, pending: (prev?.pending ?? 0) + (x.review === 'pending' ? 1 : 0) })
    })
    const files = [...byFile.values()].sort((a, b) => b.last - a.last)
    // Every pending file stays reachable; the default selection is the first one listed.
    const shown = [...files.filter(f => f.pending), ...files.filter(f => !f.pending)].slice(0, Math.max(10, files.filter(f => f.pending).length))
    const sel = u.file && byFile.has(u.file) ? u.file : shown[0]!.file
    const cells = Math.max(4, Math.min(24, w - 62))
    const gd = await read($, guard)
    const most = Math.max(1, ...files.map(f => f.added + f.removed))
    parts.push(Card(E, 'card:edits', 'EDITS', 'success', (
      <E.Box flexDirection="column">
        {shown.map(f => {
          const on = f.file === sel
          const k = Math.max(1, Math.round(((f.added + f.removed) / most) * cells))
          const plus = f.added + f.removed ? Math.round((k * f.added) / (f.added + f.removed)) : 0
          return (
            <E.Box key={`editrow:${f.file}`} flexDirection="row" gap={1} alignItems="center">
              <E.Button key={`file:${f.file}`} plain onPress={() => update($, ui, x => ({ ...x, file: f.file, fileEdit: 0 }))}><E.Text color={on ? 'claude' : undefined}>{on ? '▾' : '▸'}</E.Text></E.Button>
              <E.Text wrap="truncate-end"><E.Text color={on ? 'claude' : undefined} weight={on ? 'bold' : undefined}>{padR(file(f.file), Math.max(12, Math.min(20, w - 37)))}</E.Text>
              <E.Text color={colorOf(f.who.provider ?? 'claude')}> {padR(shortModel(f.who.model ?? ''), Math.max(5, Math.min(16, w - 58)))}</E.Text>
              <E.Text color="success">{'━'.repeat(plus)}</E.Text>
              <E.Text color="error">{'╍'.repeat(k - plus)}</E.Text>
              <E.Text>{' '.repeat(cells - k)}</E.Text>
              <E.Text color="success">{`+${f.added}`.padStart(5)}</E.Text>
              <E.Text color="error">{` −${f.removed}`.padEnd(6)}</E.Text>
              <E.Text dimColor>{f.n > 1 ? `${f.n} edits` : '1 edit'}</E.Text>
              {f.pending ? <E.Text color="warning" weight="bold">  ◆ review</E.Text> : ''}</E.Text>
            </E.Box>
          )
        })}
      </E.Box>
    ), {
      aside: (
        <E.Box flexDirection="row" gap={2}>
          <E.Text dimColor>{files.length} files</E.Text>
          <E.Button key="review:mode" plain onPress={() => void saveGuard($, x => ({ ...x, review: !x.review }))}>
            {Chip(E, gd.review ? '◉ review each file' : '○ review each file', gd.review, 'warning')}
          </E.Button>
        </E.Box>
      ),
    }))
    // The selected file: its edits newest first, one at a time, as before and after.
    const mine = list.filter(x => x.file === sel).reverse()
    const idx = Math.min(mine.length - 1, Math.max(0, u.fileEdit ?? 0))
    const x = mine[idx]!
    const before = x.before ?? x.lines.filter(l => l.startsWith('- ')).map(l => l.slice(2))
    const after = x.after ?? x.lines.filter(l => l.startsWith('+ ')).map(l => l.slice(2))
    const bSet = new Set(before.map(l => l.trim()))
    const aSet = new Set(after.map(l => l.trim()))
    const wide = w >= WIDE
    const sideW = wide ? Math.floor((w - 1) / 2) : w
    const max = Math.max(6, Math.min(40, rows - 18))
    const now = await $.clock.now()
    parts.push(
      <E.Box key="change" flexDirection="column">
        <E.Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
          <E.Text wrap="truncate-start">
            <E.Text color="claude" weight="bold">· {fitStart(base(sel), Math.max(10, w - 34))}</E.Text>
            <E.Text dimColor>  {x.isNew ? 'written whole' : 'edited'}{x.at ? ` ${ago(now - x.at)} ago` : ''} by </E.Text>
            <E.Text color={colorOf(x.provider ?? 'claude')}>{shortModel(x.model ?? (x.agent ? 'a subagent' : 'claude'))}</E.Text>
            {x.review === 'kept' ? <E.Text color="success">  ✓ kept</E.Text> : x.review === 'reverted' ? <E.Text color="error">  ✗ reverted</E.Text> : ''}
          </E.Text>
          <E.Box flexDirection="row" gap={1}>
            <E.Button key="edit:prev" plain dimColor={idx >= mine.length - 1 ? true : undefined} onPress={() => update($, ui, y => ({ ...y, file: sel, fileEdit: Math.min(mine.length - 1, idx + 1) }))}>‹ older</E.Button>
            <E.Text dimColor>{idx + 1}/{mine.length}</E.Text>
            <E.Button key="edit:next" plain dimColor={idx === 0 ? true : undefined} onPress={() => update($, ui, y => ({ ...y, file: sel, fileEdit: Math.max(0, idx - 1) }))}>newer ›</E.Button>
          </E.Box>
        </E.Box>
        {x.review === 'pending' ? (
          <E.Box flexDirection="row" gap={2}>
            <E.Button key="change:keep" plain onPress={() => settle($, x, 'kept')}>{Chip(E, '✓ keep', true, 'success')}</E.Button>
            <E.Button key="change:revert" plain onPress={() => settle($, x, 'reverted')}>{Chip(E, x.isNew ? '✗ delete file' : '✗ revert to before', true, 'error')}</E.Button>
          </E.Box>
        ) : null}
        {x.isNew ? (
          changeSide(E, 'after', 'NEW FILE', after, new Set(), 'success', w, max)
        ) : (
          <E.Box flexDirection={wide ? 'row' : 'column'} gap={1}>
            {changeSide(E, 'before', 'BEFORE', before, aSet, 'error', sideW, max)}
            {changeSide(E, 'after', 'AFTER', after, bSet, 'success', sideW, max)}
          </E.Box>
        )}
      </E.Box>,
    )
  }
  const decs = await read($, decisions)
  if (decs.length) parts.push(Card(E, 'card:decisions', 'DECISIONS', 'warning', <E.Box flexDirection="column">{decisionRows($, E, decs, w - 4, 16, await $.clock.now(), (await read($, ui)).folded ?? {}, (await read($, guard)).ticker)}</E.Box>))
  const shown = qaEditing ? qa : qa.slice(-Math.max(2, Math.floor((rows - (list.length ? 30 : 0)) / 4)))
  parts.push(Card(E, 'card:grill', 'QA', qa.length ? 'suggestion' : 'inactive', (
    qa.length ? <E.Box flexDirection="column" gap={1}>
      {shown.map((q, i) => (
        <E.Box key={`q${i}`} flexDirection="column">
          <E.Box flexDirection="row" justifyContent="space-between" gap={1}>
            <E.Text wrap="truncate-end">
              <E.Text {...filled(E, q.kind === 'instruction' ? 'planMode' : 'suggestion')} weight="bold">{q.kind === 'instruction' ? ' I ' : ` Q${qa.length - shown.length + i + 1} `}</E.Text>
              <E.Text color={q.kind === 'instruction' ? 'planMode' : 'suggestion'}> {q.question}</E.Text>
            </E.Text>
            {qaEditing ? qaRemove($, E, q, `qadel:act:${qa.length - shown.length + i}`) : q.documented ? <E.Text dimColor>✓</E.Text> : null}
          </E.Box>
          {wrapText(q.answer, w - 9, 4).map((t, j) => (
            <E.Text key={`a${i}:${j}`}>
              <E.Text color="success" weight="bold">{j || q.kind === 'instruction' ? '     ' : '  A  '}</E.Text>
              {t}
            </E.Text>
          ))}
        </E.Box>
      ))}
    </E.Box> : <E.Text dimColor>no answers</E.Text>
  ), { aside: qaAside($, E, qa, qaEditing, 'act') }))
  return <E.Box flexDirection="column" gap={1}>{parts}</E.Box>
}

// ---------- plugins ----------

async function pluginsTab($: $, E: E, w: number) {
  const inst = await read($, installed)
  const u = await read($, used)
  const ps = await read($, pins)
  const t = await read($, toggles)
  const folded = (await read($, ui)).folded ?? {}
  const narrow = w < 80
  const pinBtn = (k: string) => {
    const on = ps.includes(k)
    return (
      <E.Box flexDirection="row" gap={1} alignItems="center">
        <E.Text color="subtle">{on ? '✓ pinned' : 'pin'}</E.Text>
        <E.Button key={`pin:${k}`} plain dimColor onPress={() => void setPin($, k, !on)}>{on ? '×' : '+'}</E.Button>
      </E.Box>
    )
  }
  const controls = (k: string, mode: Mode, parent = false) => <E.Box key={`plugin:controls:${k}`} flexDirection="row" gap={2} marginLeft={narrow && parent ? 4 : 0} flexShrink={0}>
    <E.Box width={E.desk ? 22 : 18} flexShrink={0}>{triState($, E, k, mode)}</E.Box>
    <E.Box width={14} flexShrink={0}>{pinBtn(k)}</E.Box>
  </E.Box>
  const inUse = [
    ...Object.entries(u.mcp).map(([k, n]) => ({ k: `· ${k}`, n, c: k === 'antigravity' ? colorOf('antigravity') : 'suggestion' })),
    ...Object.entries(u.skills).map(([k, n]) => ({ k: `✦ ${k}`, n, c: 'remember' })),
    ...Object.entries(u.agentTypes).map(([k, n]) => ({ k: `◇ ${k}`, n, c: 'claude' })),
  ].sort((a, b) => b.n - a.n)
  const claudePlugins = inst.plugins.filter(p => p.where === 'claude')
  const servers = new Map<string, string[]>()
  for (const tl of inst.tools ?? []) {
    const server = tl.split('__')[1] ?? 'mcp'
    if (server === 'agent-overview') continue
    servers.set(server, [...(servers.get(server) ?? []), tl])
  }
  const parts = [
    inUse.length
      ? Card(E, 'card:inuse', 'IN USE THIS SESSION', 'remember', (
          <E.Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            {inUse.slice(0, 24).map((c, i) => (
              <E.Text key={`c${i}`}><E.Text color={c.c}>{c.k}</E.Text><E.Text dimColor> ×{c.n}</E.Text></E.Text>
            ))}
          </E.Box>
        ))
      : null,
    claudePlugins.length
      ? Card(E, 'card:claude', 'CLAUDE CODE PLUGINS', colorOf('claude'), (
          <E.Box flexDirection="column" gap={1}>
            {claudePlugins.map(p => {
              const k = `plugin:${p.name}`
              const open = folded[`pl:${p.name}`] === false
              return (
                <E.Box key={`pl:${p.name}`} flexDirection="column" gap={E.desk ? 0.5 : 0}>
                  <E.Box flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" gap={narrow ? 0 : 1}>
                    <E.Box flexDirection="row" gap={1}>
                      {p.skills?.length ? (
                        <E.Button key={`plfold:${p.name}`} plain onPress={() => update($, ui, x => ({ ...x, folded: { ...(x.folded ?? {}), [`pl:${p.name}`]: open } }))}>
                          <E.Text color="suggestion">{open ? '▾' : '▸'}</E.Text>
                        </E.Button>
                      ) : <E.Text> </E.Text>}
                      <E.Text color={p.enabled ? colorOf('claude') : 'inactive'}>{p.enabled ? '●' : '○'}</E.Text>
                      <E.Text weight="bold">{displayName(p.name)}</E.Text>
                      <E.Text dimColor>{p.version ?? ''}{p.skills?.length ? ` · ${plural(p.skills.length, 'skill')}` : ''}</E.Text>
                    </E.Box>
                    {controls(k, t[k] ?? 'on', true)}
                  </E.Box>
                  {open
                    ? (p.skills ?? []).map(sk => skillRow($, E, `skill:${p.name}:${sk}`, t, undefined, pinBtn(`skill:${p.name}:${sk}`), narrow))
                    : null}
                </E.Box>
              )
            })}
          </E.Box>
        ))
      : null,
    servers.size
      ? Card(E, 'card:tools', 'TOOLS', 'suggestion', (
          <E.Box flexDirection="column" gap={1}>
            {[...servers.entries()].map(([server, tools]) => {
              const open = folded[`srv:${server}`] === false
              return (
                <E.Box key={`srv:${server}`} flexDirection="column" gap={E.desk ? 0.5 : 0}>
                  <E.Box flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" gap={narrow ? 0 : 1}>
                    <E.Box flexDirection="row" gap={1} alignItems="center">
                    <E.Button key={`srvfold:${server}`} plain onPress={() => update($, ui, x => ({ ...x, folded: { ...(x.folded ?? {}), [`srv:${server}`]: open } }))}>
                      <E.Text color="suggestion">{open ? '▾' : '▸'}</E.Text>
                    </E.Button>
                      <E.Text color={server === 'antigravity' ? colorOf('antigravity') : undefined} weight="bold">{displayName(serverName(server, tools))}</E.Text>
                      <E.Text dimColor>  {plural(tools.length, 'tool')}</E.Text>
                    </E.Box>
                    {controls(`server:${server}`, t[`server:${server}`] ?? 'on', true)}
                  </E.Box>
                  {open
                    ? tools.map(tl => (
                        <E.Box key={`tl:${tl}`} flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" marginLeft={4} gap={narrow ? 0 : 1}>
                          <E.Text dimColor wrap="truncate-end">{displayName(tl.replace(/^mcp__.+?__/, ''))}{t[`tool:${tl}`] && t[`tool:${tl}`] !== 'on' ? ` · ${t[`tool:${tl}`]}` : ''}</E.Text>
                          {controls(`tool:${tl}`, toolMode(t, tl))}
                        </E.Box>
                      ))
                    : null}
                </E.Box>
              )
            })}
          </E.Box>
        ))
      : null,
    inst.plugins.some(p => p.where === 'antigravity')
      ? Card(E, 'card:agy', 'ANTIGRAVITY PLUGINS', colorOf('antigravity'), (
          <E.Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            {inst.plugins.filter(p => p.where === 'antigravity').map(p => (
              <E.Text key={`p:agy:${p.name}`}><E.Text color={p.enabled ? colorOf('antigravity') : 'inactive'}>{p.enabled ? '● ' : '○ '}</E.Text>{p.name}<E.Text dimColor> {p.version ?? ''}</E.Text></E.Text>
            ))}
          </E.Box>
        ))
      : null,
  ].filter(Boolean)
  const note = await switchNote($)
  return <E.Box flexDirection="column" gap={1}>{note ? <E.Box key="switch:note"><E.Text color="warning" wrap="wrap">{note}</E.Text></E.Box> : null}{parts}</E.Box>
}

// ---------- settings ----------

function settingRow($: $, E: E, g: Guard, key: Exclude<keyof Guard, 'caps' | 'ccBase' | 'creditPrice' | 'work' | 'vibe' | 'chat'>, name: string, help: string, choices: { label: string; value: boolean | number | Guard['planSubagents'] }[] = [{ label: 'Off', value: false }, { label: 'On', value: true }]) {
  return SettingsRow(E, `setting:${key}`, name, choices.map(c => <E.Button key={`setting:${key}:${c.value}`} plain onPress={async () => {
        await saveGuard($, x => ({ ...x, [key]: c.value }))
        if (key === 'qaLog') $.ui.invalidate('tool.describe')
        if (key === 'planSubagents') $.ui.invalidate('prompt.section')
        if (key === 'chatLook' || key === 'usageTail' || key === 'ctxWarn') $.ui.invalidate('ui.render')
      }}>{Chip(E, c.label, g[key] === c.value)}</E.Button>))
}

async function settingsTab($: $, E: E) {
  const g = await read($, guard)
  const u = await read($, ui)
  const caps = PROVIDERS.filter(p => (g.caps[p.id] ?? 0) > 0)
  return <E.Box flexDirection="column" gap={1}>
    {E.desk ? null : Card(E, 'card:settings:chat', 'CHAT', 'claude', <E.Box flexDirection="column" gap={1}>
      {settingRow($, E, g, 'usageTail', 'Prompt usage', 'Show provider usage at the end of the hint line.')}
    </E.Box>)}
    {Card(E, 'card:settings:routing', 'ROUTING', 'planMode', <E.Box flexDirection="column" gap={1}>
      {routingGuardRow($, E, g)}
      {await babysitterRow($, E)}
      {codexImagesRow($, E, g, 'settings')}
      {settingRow($, E, g, 'autoPause', 'Quota pause', 'Turn side providers off until their quota resets.')}
      {settingRow($, E, g, 'planSubagents', 'Plan subagents', 'Refuse Claude subagents or have them hand work to the models list.', [{ label: 'Block', value: 'block' }, { label: 'Hand off', value: 'handoff' }])}
      <E.Box flexDirection="column">
        {caps.length ? <E.Text weight="bold">Spend caps</E.Text> : null}
        <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
          {caps.map(p => <E.Button key={`cap:${p.id}`} plain onPress={() => update($, ui, x => ({ ...x, cap: x.cap === p.id ? undefined : p.id }))}><E.Text>{p.name}  ${g.caps[p.id]} {capWindow(p.id)}</E.Text></E.Button>)}
          <E.Button key="cap:add" plain onPress={() => update($, ui, x => ({ ...x, cap: x.cap ? undefined : PROVIDERS.find(p => !g.caps[p.id])?.id ?? 'claude' }))}><E.Text color="suggestion">+ spend cap</E.Text></E.Button>

        </E.Box>
        {u.cap ? <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
          <E.Select key="cap:provider" options={PROVIDERS.filter(p => p.id !== 'ollama').map(p => ({ value: p.id, label: p.name }))} value={u.cap} onSelect={(v: Provider) => update($, ui, x => ({ ...x, cap: v }))} />
          <E.Input key={`capinput:${u.cap}`} value={g.caps[u.cap] ? String(g.caps[u.cap]) : ''} placeholder={`dollars ${capWindow(u.cap) === 'per chat' ? 'per chat' : 'per day'} · empty clears`} submitLabel="set" onSubmit={async (v: string) => {
            const p = u.cap!
            const n = Number(v.replace(/[$,\s]/g, ''))
            await saveGuard($, x => { const caps = { ...x.caps }; if (Number.isFinite(n) && n > 0) caps[p] = n; else delete caps[p]; return { ...x, caps } })
            await update($, ui, x => ({ ...x, cap: undefined }))
            $.ui.invalidate('prompt.section')
          }} />
        </E.Box> : null}
      </E.Box>
    </E.Box>)}
    {Card(E, 'card:settings:live', 'LIVE AND REVIEW', 'suggestion', <E.Box flexDirection="column" gap={1}>
      {settingRow($, E, g, 'review', 'File review', 'Keep or revert each file after a side provider changes it.')}
      {settingRow($, E, g, 'follow', 'Follow activity', 'Default to the newest activity; Off keeps the main chat selected.')}
    </E.Box>)}
    {Card(E, 'card:settings:panel', 'PANEL', 'remember', <E.Box flexDirection="column" gap={1}>
      {settingRow($, E, g, 'mediaWidget', 'Media widget', 'Show outside AI tools and their costs in this chat.')}
      {settingRow($, E, g, 'mediaBalances', 'Automatic media balances', 'Read balances after media calls only when already allowed.')}
      {E.desk ? null : settingRow($, E, g, 'ticker', 'Decision ticker', 'Hover over a long decision to read the rest.')}
      {settingRow($, E, g, 'qaLog', 'QA logging', 'Off asks Claude to log answers only while grilling you.')}
      {settingRow($, E, g, 'ctxWarn', 'Context warning', 'Warn before context fills; Off hides all context warnings.', [{ label: 'Off', value: 0 }, { label: '70%', value: 70 }, { label: '80%', value: 80 }, { label: '90%', value: 90 }])}
    </E.Box>)}
    {await chatSettings($, E)}
    {await hooksCard($, E)}
  </E.Box>
}

// ---------- the panel ----------

async function renderError($: $, error: unknown, area: string, tab: string) {
  const message = error instanceof Error ? error.message : String(error)
  try {
    await $.store.set('lastRenderError', {
      at: await $.clock.now(), message,
      stack: error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 5).join('\n') : '',
      area, tab,
    })
  } catch {}
  return message
}

export async function drawPane($: $, e: any) {
  const E = tableOf($, e)
  const w: number = e.props?.bodyColumns ?? e.viewport?.columns ?? 60
  const rows: number = Math.max(20, e.props?.scroll?.bodyRows ?? e.viewport?.rows ?? 40)
  const focused = !!e.props?.isFocused
  let area = 'overview', errorTab = 'dashboard'
  let tab: Tab = 'dashboard', title: any
  try {
    const u = await read($, ui)
    area = u.pendingArea ?? u.area ?? 'overview'
    tab = TABS.some(t => t[0] === u.tab) ? u.tab : 'dashboard'
    errorTab = area === 'work' ? u.workTab ?? 'source' : area === 'vibe' ? u.vibeTab ?? 'live' : tab
    title = await frame($, E, w, tab)
    const body = area === 'work' ? await workView($, E, w, rows)
      : area === 'vibe' ? await vibeView($, E, w, rows - (u.pendingArea ? 4 : 0))
      : tab === 'agents' ? await agentsTab($, E, w, rows)
        : tab === 'models' ? await modelsTab($, E, w, rows)
          : tab === 'activity' ? await activityTab($, E, w, rows)
            : tab === 'plugins' ? await pluginsTab($, E, w)
              : tab === 'settings' ? await settingsTab($, E)
                : await dashboard($, E, w, rows)
    return (
      <E.Box flexDirection="column">
        {title}
        <E.Box flexDirection="column" marginTop={1}>
          {body}
        </E.Box>
      </E.Box>
    )
  } catch (error) {
    const message = await renderError($, error, area, errorTab)
    return <E.Box flexDirection="column">
      {title ?? <E.Text color="claude" weight="bold">◇ agent overview</E.Text>}
      <E.Text dimColor wrap="truncate-end">panel error: {message.replace(/[\r\n]+/g, ' ')}</E.Text>
    </E.Box>
  }
}

// ---------- the strip above the prompt: only while something runs ----------

export async function drawBand($: $, e: any) {
  try {
    const list = await displayNodes($)
    const running = list.filter(n => n.kind !== 'workflow' && stateOf(n, list) === 'running')
    const pend = (await read($, edits)).filter(x => x.review === 'pending').length
    const ctx = (await read($, providers).then(allOf)).claude.meters.find(x => x.label === 'Context')
    const threshold = (await read($, guard)).ctxWarn
    const hot = threshold > 0 && ctx && ctx.percent >= threshold ? Math.round(ctx.percent) : 0
    const l = await read($, live)
    const E = tableOf($, e)
    const w: number = e.props?.bodyColumns ?? 80
    const extras = await chatBandExtras($, E, w)
    if (!running.length && !l && !pend && !hot && !extras.length) return undefined
    const spin = await spinOf($, E)
    const lines = l ? l.text.split('\n').length : 0
    const groups = stagesOf(list).map(st => ({ st, ms: st.nodes.filter(n => stateOf(n, list) === 'running') })).filter(g => g.ms.length)
    return (
      <E.Box flexDirection="column">
      {running.length || l || pend || hot ? <E.Box flexDirection="row" justifyContent="space-between" gap={2}>
        {running.length ? (
          w >= MID ? (
            <E.Text wrap="truncate-end">
              <E.Text color="claude">{spin} </E.Text>
              {groups.map((g, i) => (
                <E.Text key={`g:${g.st.key}`}>
                  {i ? '   ' : ''}
                  <E.Text color={g.st.color} weight="bold">{fit(g.st.name, 24)} </E.Text>
                  {g.ms.map((n, j) => (
                    <E.Text key={`m:${n.id}`}>
                      {j ? <E.Text dimColor> · </E.Text> : ''}
                      <E.Text color={colorOf(provOf(n))}>{nodeModel(n)}</E.Text>
                    </E.Text>
                  ))}
                </E.Text>
              ))}
            </E.Text>
          ) : (
            <E.Text wrap="truncate-end">
              <E.Text color="claude">{spin} {running.length}  </E.Text>
              <E.Text color={colorOf(provOf(running[0]!))}>{shortModel(running[0]!.model)}</E.Text>
              {running.length > 1 ? <E.Text dimColor> +{running.length - 1}</E.Text> : ''}
            </E.Text>
          )
        ) : (
          <E.Text> </E.Text>
        )}
        <E.Text>
          {pend ? <E.Text color="warning" weight="bold">◆ {pend} to review   </E.Text> : ''}
          {hot ? <E.Text color="error" weight="bold">context {hot}% · /compact   </E.Text> : ''}
          {l ? <E.Text color="claude">· {fit(file(l.file || '…'), 24)}</E.Text> : ''}
          {l ? <E.Text color="success"> +{lines}</E.Text> : ''}
        </E.Text>
      </E.Box> : null}
      {extras}
      </E.Box>
    )
  } catch (error) {
    await renderError($, error, 'band', 'AbovePrompt')
    return undefined
  }
}

export { OTHERS }
