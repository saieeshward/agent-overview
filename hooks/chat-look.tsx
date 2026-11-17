import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'
import type { AgentNode, EditItem, Look, Provider, Stage, StageId, Turn, Ui } from '../types'
import { normalGuard, providerOf } from './state'
import { MENTIONS } from './chat-surfaces'
import { AVATAR, JOIN, TAIL, VIBE, boat, chase, chipWidth, dashed, fill, rounded, spriteChip, tint, titleBar } from './chat-art'
import type { Token } from './chat-art'
import type { $, E } from './ui'

const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
// The area is mirrored here so a message redraws on a mode switch, not on every panel click.
const look = atom({ plugin: 'agent-overview', key: 'look' } as const, { area: 'overview', turns: [] } as Look)

// The desktop app sends the owner's prompts through the SDK; an unstamped row from no one else is theirs too.
const owner = (kind: string, other?: unknown) => ['composer', 'bridge', 'sdk'].includes(kind) || kind === 'unclassified' && !other
const BUBBLE = '#34322f', TEXT = '#ece9e4', DIM = '#a19c94', FAINT = '#6f6a63', CLAY = '#d97757', GREEN = '#7fbf7f', LINE = '#3a3835'
type Numbered = Turn & { n: number; newest: boolean }

// FNV-1a of the text: a row finds its turn without the store keeping a copy of every prompt.
export function fingerprint(text: string) {
  let x = 0x811c9dc5
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 0x01000193)
  return `${text.length.toString(36)}.${(x >>> 0).toString(36)}`
}
async function restoreTurns($: $) {
  const id = await $.session.id().catch(() => ''), saved = id ? await $.store.get(`turns:${id}`).catch(() => undefined) : undefined
  await update($, look, l => ({ ...l, session: id, turns: Array.isArray(saved) ? saved as Turn[] : [] }))
}
async function saveTurns($: $, change: (t: Turn[]) => Turn[]) {
  const next = await update($, look, l => ({ ...l, turns: change(l.turns) }))
  const id = await $.session.id().catch(() => '')
  if (id) await $.store.set(`turns:${id}`, next.turns).catch(() => {})
}

const MENTION: Record<string, Provider> = { ...MENTIONS, claude: 'claude' }
const FILE = /[\w-]\.(?:md|mdx|txt|json|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|swift|c|h|cpp|cs|sh|zsh|css|scss|html|svg|png|jpe?g|gif|pdf|csv|sql|gd|tscn|tres|gdshader|lock)$/
const ROOT = /^\/(?:tmp|etc|usr|var|opt|bin|home|Users|private|Volumes|Applications)$/
export function tokenOf(core: string): Token | undefined {
  const name = /^@(\w+)$/.exec(core)?.[1]?.toLowerCase()
  if (name && Object.hasOwn(MENTION, name)) return { kind: 'mention', text: core, p: MENTION[name] }
  if (/^\/[a-z][\w:-]*$/i.test(core) && !ROOT.test(core)) return { kind: 'command', text: core }
  // A path is anchored (/, ~/, ./, ../) or ends in a known file extension; `and/or`, `e.g` and `console.log` stay words.
  if (/^(?:~|\.{1,2})?\/?[\w.-]+(?:\/[\w.-]+)*\/?$/.test(core) && (/^(?:~|\.{1,2})?\/[\w.]/.test(core) || FILE.test(core))) return { kind: 'file', text: core }
}
const split = (word: string) => /^([("'`]*)(.*?)([)"'`.,;:!?]*)$/s.exec(word)!.slice(1) as [string, string, string]

// Default and Work chips are tinted Text runs inside the message's Text, so words flow and select as text.
const plain = (t: Token) => t.kind === 'file' ? { backgroundColor: '#ffffff12', color: '#d6d1c9' } : { backgroundColor: `${tint(t).s}30`, color: tint(t).c }
const tinted = (t: Token) => ({ backgroundColor: `${tint(t).s}30`, color: tint(t).c })
function spans(E: E, text: string, chip: (t: Token) => object, color?: string) {
  const out: any[] = [], push = (s: string) => { if (s) typeof out.at(-1) === 'string' ? out[out.length - 1] += s : out.push(s) }
  for (const piece of text.split(/(\s+)/)) {
    const [pre, core, post] = split(piece), t = core ? tokenOf(core) : undefined
    if (!t) { push(piece); continue }
    push(pre); out.push(<E.Text mono {...chip(t)}>{t.text}</E.Text>); push(post)
  }
  return <E.Text color={color}>{out}</E.Text>
}
// Vibe's sprite chips are images, so the message becomes a wrapping row of words, a cell apart.
function flow(E: E, text: string) {
  return <E.Box flexDirection="column" alignItems="flex-start">{text.split('\n').map(line => <E.Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
    {line.trim() ? line.trim().split(/\s+/).map(word => {
      const [pre, core, post] = split(word), t = core ? tokenOf(core) : undefined
      return !t ? <E.Text color={TEXT}>{word}</E.Text> : <E.Box flexDirection="row" alignItems="center">
        {pre ? <E.Text color={TEXT}>{pre}</E.Text> : null}
        <E.Svg source={spriteChip(t)} alt={t.text} width={chipWidth(t.text)} height={20}/>
        {post ? <E.Text color={TEXT}>{post}</E.Text> : null}
      </E.Box>
    }) : <E.Text> </E.Text>}
  </E.Box>)}</E.Box>
}

// Edge strips: absolute, clipped, flush to their edge; corner pieces sit over the strips' ends.
const SIDE = {
  top: { top: 0, left: 0, right: 0, flexDirection: 'column', justifyContent: 'flex-start' },
  bottom: { bottom: 0, left: 0, right: 0, flexDirection: 'column', justifyContent: 'flex-end' },
  left: { top: 0, bottom: 0, left: 0, flexDirection: 'row', justifyContent: 'flex-start' },
  right: { top: 0, bottom: 0, right: 0, flexDirection: 'row', justifyContent: 'flex-end' },
} as const
const CORNER = { tl: { top: 0, left: 0 }, tr: { top: 0, right: 0 }, br: { bottom: 0, right: 0 }, bl: { bottom: 0, left: 0 } } as const
const edge = (E: E, side: keyof typeof SIDE, source: string, w: number, height: number, alt = 'Frame edge') =>
  <E.Box position="absolute" overflow="hidden" {...SIDE[side]}><E.Svg source={source} alt={alt} width={w} height={height}/></E.Box>
const piece = (E: E, k: keyof typeof CORNER, source: string, w: number, height: number) =>
  <E.Box position="absolute" {...CORNER[k]}><E.Svg source={source} alt="Frame corner" width={w} height={height}/></E.Box>
const rule = (E: E, color: string) => <E.Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" flexDirection="column" justifyContent="center">
  <E.Svg source={fill(4000, 1, color)} alt="Rule" width={4000} height={1}/>
</E.Box>
// Vibe Motion 'still': every SMIL tag goes, so each Svg holds its first frame (eyelids stay hidden, cursors shown).
const freeze = (n: any): any => typeof n === 'string' ? n
  : { ...n, props: n.type === 'Svg' ? { ...n.props, source: n.props.source.replace(/<animate(?:Transform)?\b[^>]*\/>/g, '') } : n.props, children: n.children?.map(freeze) }
const hhmm = (at: number) => new Date(at).toTimeString().slice(0, 5)

function bubble(E: E, text: string, t?: Numbered) {
  return <E.Box flexDirection="column" alignItems="flex-end" width="100%">
    <E.Box flexDirection="column" backgroundColor={BUBBLE} borderStyle="round" borderColor={BUBBLE} paddingX={2} paddingY={1} marginLeft={6}>
      <E.Text size="caption" mono color={FAINT}>{t ? `TURN ${t.n} · DEFAULT` : 'DEFAULT'}</E.Text>
      {spans(E, text, plain, TEXT)}
    </E.Box>
  </E.Box>
}
function ticket(E: E, text: string, t?: Numbered) {
  return <E.Box flexDirection="column" width="100%">
    <E.Box flexDirection="row" justifyContent="space-between" gap={1} backgroundColor="#2e2c29" paddingX={1}>
      <E.Text size="caption" mono color={DIM}>{t?.stage ? ['YOU · ', <E.Text color={CLAY}>{t.stage.toUpperCase()}</E.Text>] : 'YOU'}</E.Text>
      {t ? <E.Text size="caption" mono color={DIM}>{hhmm(t.at)}</E.Text> : null}
    </E.Box>
    <E.Box paddingX={1} paddingY={1}>{spans(E, text, plain)}</E.Box>
    {edge(E, 'top', dashed(false, '#55514b'), 4000, 1)}
    {edge(E, 'bottom', dashed(false, '#55514b', 'xMaxYMax'), 4000, 1)}
    {edge(E, 'left', dashed(true, '#55514b'), 1, 4000)}
    {edge(E, 'right', dashed(true, '#55514b', 'xMaxYMax'), 1, 4000)}
    {(['tl', 'tr', 'br', 'bl'] as const).map(k => piece(E, k, rounded(k, '#55514b', VIBE.chat), 4, 4))}
  </E.Box>
}
const GAP = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="6"/>'
function vibe(E: E, text: string, t?: Numbered) {
  // Long messages, and any token too wide for a fixed-width sprite at 420 px (32 chars = 258 px), keep tinted Text chips, which wrap.
  const words = text.split(/\s+/).filter(Boolean), toks = words.map(w => tokenOf(split(w)[1])).filter(t => t !== undefined)
  const flows = text.length <= 600 && words.length <= 100 && toks.length > 0 && toks.every(t => t.text.length <= 32)
  return <E.Box flexDirection="row" alignItems="flex-start" width="100%">
    <E.Svg source={AVATAR} alt="You" width={22} height={22}/>
    <E.Svg source={TAIL} alt="Speech tail" width={8} height={22}/>
    <E.Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} backgroundColor={VIBE.bg} paddingX={2} paddingTop={3} paddingBottom={1}>
      {/* Spacing comes in whole text rows: 3 is a touch tight under the 22 px bar, 4 too loose, so 6 px more. */}
      <E.Svg source={GAP} alt="Gap" width={1} height={6}/>
      {flows ? flow(E, text) : spans(E, text, tinted, TEXT)}
      {edge(E, 'top', titleBar(t ? `TURN ${t.n} · VIBE` : 'VIBE'), 4000, 22, 'Title bar')}
      {edge(E, 'left', fill(2, 4000, VIBE.line), 2, 4000)}
      {edge(E, 'right', fill(2, 4000, VIBE.line, 'xMaxYMax'), 2, 4000)}
      {edge(E, 'bottom', fill(4000, 2, VIBE.line, 'xMaxYMax'), 4000, 2)}
      {(['tl', 'tr', 'br', 'bl'] as const).map(k => piece(E, k, fill(2, 2, VIBE.chat), 2, 2))}
      {piece(E, 'tl', JOIN, 2, 22)}
    </E.Box>
  </E.Box>
}

const STAGES = ['plan', 'implement', 'review'] as const
// The app redraws a row now and then, which restarts its animation; starting it as far in as the time since the turn
// keeps the divider running on instead of jumping back.
const phased = (source: string, seconds: number) => source.replace(/<(animate|animateTransform) /g, `<$1 begin="-${Math.max(0, seconds).toFixed(2)}s" `)
function divider(E: E, area: Look['area'], t: Numbered, style: 'chase' | 'boat', now: number) {
  if (area === 'vibe') return <E.Box flexDirection="row" justifyContent="center" width="100%">
    <E.Svg source={phased(style === 'boat' ? boat(t.work ?? 0, t.newest) : chase(t.ran ?? [], t.newest), (now - t.at) / 1000)} alt={style === 'boat' ? 'Rowing boat' : 'Pellet chase'} width={320} height={40}/>
  </E.Box>
  // A Work look on a turn sent outside Work mode has no stage to show: it keeps the turn-number divider.
  if (area === 'work' && t.stage) {
    const s: StageId = t.stage, now = s === 'ship' ? STAGES.length : STAGES.indexOf(s)
    return <E.Box flexDirection="row" alignItems="center" width="100%" gap={1}>
      {STAGES.flatMap((name, i) => [i ? rule(E, i <= now ? GREEN : LINE) : null,
        <E.Box flexShrink={0}><E.Text size="caption" mono color={i < now ? GREEN : i === now ? CLAY : FAINT}>{name.toUpperCase()}{i < now ? ' ✓' : i === now ? ' ●' : ''}</E.Text></E.Box>])}
    </E.Box>
  }
  return <E.Box flexDirection="row" alignItems="center" width="100%" gap={1}>
    <E.Box width={5} flexShrink={0} flexDirection="row" justifyContent="flex-end"><E.Text size="heading" color="#514d47">{String(t.n)}</E.Text></E.Box>
    {rule(E, LINE)}
    <E.Box flexShrink={0} borderStyle="round" borderColor={LINE} paddingX={1}><E.Text size="caption" mono color={DIM}>{hhmm(t.at)}</E.Text></E.Box>
    {rule(E, LINE)}
  </E.Box>
}

export function registerChatLook(on: On) {
  // The area is copied in by storeMode (modes.ts), which every mode change passes through.
  on('session.start', {}, async ($, e, next) => {
    const result = await next(e)
    await restoreTurns($)
    return result
  })
  // `/clear` and an in-app resume go on under a new id with no session.start: the new chat must not borrow the old numbers.
  on('session.end', {}, async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await update($, look, l => ({ ...l, session: undefined, turns: [] }))
    return result
  })
  // Registered before the chat surfaces, so this sees the prompt as typed and the text that entered after any rewrite.
  on('prompt.submit', {}, async ($, e, next) => {
    if (!owner(e.origin.kind) || e.isMeta || e.command || /^[!#]/.test(e.text)) return next(e)
    if ((await read($, look)).session !== await $.session.id().catch(() => '')) await restoreTurns($)
    const now = await $.clock.now(), last = (await read($, look)).turns.at(-1)
    let did = {}
    if (last) {
      const runs = (await read($, nodes)).filter(n => n.kind !== 'workflow' && (n.startedAt ?? -1) >= last.at)
      const changed = (await read($, edits)).filter(x => (x.at ?? -1) >= last.at).length
      did = { ran: [...new Set(runs.map(n => n.provider ?? providerOf(n.model)).filter(p => p !== 'claude'))], work: runs.length + changed }
    }
    const turn: Turn = { key: fingerprint(e.text), at: now, area: (await read($, ui)).area ?? 'overview', stage: (await read($, stage))?.at, ...did,
      ...(e.attachments?.length ? { images: e.attachments.length } : {}) }
    const same = (t: Turn) => t.at === now && t.key === turn.key
    await saveTurns($, list => [...list, turn])
    const result = await next(e)
    if (result.drop !== undefined) await saveTurns($, list => list.filter(t => !same(t)))
    else if (result.text !== e.text) await saveTurns($, list => list.map(t => same(t) ? { ...t, sent: fingerprint(result.text) } : t))
    return result
  })
  // The owner's prompt as stored: bind the newest unbound turn with its text to the row's id, which the row is drawn under.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.message.type !== 'user') return result
    const text = (Array.isArray(e.message.content) ? e.message.content : []).map((b: any) => b?.type === 'text' ? b.text : '').join('')
    const key = fingerprint(text), list = (await read($, look)).turns
    const i = list.findLastIndex(t => !t.row && (t.key === key || t.sent === key))
    if (i >= 0) await saveTurns($, all => all.map((t, n) => n === i ? { ...t, row: e.uuid } : t))
    return result
  })
  on('ui.render', { component: 'UserMessage', surface: 'desktop' }, async ($, e, next) => {
    const p = e.props
    if (!owner(p.origin.kind, p.from ?? p.task) || p.text.length > 10000 || /^[!#]/.test(p.text)) return next(e)
    const g = normalGuard(await read($, guard))
    if (!g.chatLook) return next(e)
    const l = await read($, look), key = fingerprint(p.text), still = g.vibe.motion === 'still', now = await $.clock.now()
    // A turn is bound to its stored row (session.append); rows from before that match by text, unbound turns first.
    const byRow = l.turns.findIndex(t => t.row === e.requestId), byText = (t: Turn) => t.key === key || t.sent === key
    const i = byRow >= 0 ? byRow : [l.turns.findIndex(t => !t.row && byText(t)), l.turns.findIndex(byText)].find(n => n >= 0) ?? -1
    const t = i < 0 ? undefined : { ...l.turns[i]!, n: i + 1, newest: i === l.turns.length - 1 && !still }
    const E = $.ui.resolve(e) as E, area = g.chat.theme === 'mode' ? l.area : g.chat.theme
    // The row's images are in the engine's own drawing only: a prompt that carried any keeps it, under our divider
    // (in a Box with no width, which the engine requires around its own drawing).
    if (t?.images) return <E.Box flexDirection="column" alignItems="stretch" gap={1}>
      {t.n > 1 ? divider(E, area, t, g.chat.vibeDivider, now) : null}
      {await next(e)}
    </E.Box>
    const tree = <E.Box flexDirection="column" alignItems="stretch" width="100%" gap={1}>
      {t && t.n > 1 ? divider(E, area, t, g.chat.vibeDivider, now) : null}
      {(area === 'vibe' ? vibe : area === 'work' ? ticket : bubble)(E, p.text, t)}
    </E.Box>
    return still ? freeze(tree) : tree
  })
}
