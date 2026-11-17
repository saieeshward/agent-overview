import { expect, mock, test } from 'claude-code/testing'
import type { On, PluginState, RenderElement } from 'claude-code'
import type { AgentNode, Area, Provider } from '../types'
import { normalGuard } from '../hooks/state'
import { fingerprint, tokenOf } from '../hooks/chat-look'
import { boat, chase, titleBar } from '../hooks/chat-art'
import { fixture } from '../tools/pane-fixtures'

type State = Partial<PluginState['agent-overview']>
const NOW = 1000000
const user = { origin: { kind: 'composer' as const }, wait: false }
const pane = { title: 'Agent panel', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const MSG = 'Hand the parser fix to @codex, run /handoff if Claude runs low, and check src/parse.ts after.'
function setup(on: On, area: Area = 'overview') {
  const clock = mock.clock(on, { now: NOW }); mock.env(on, { HOME: '/fixture' })
  const store: Record<string, unknown> = {}, session = { id: 'look' }
  const state = fixture({ area, tab: 'settings', scenario: 'chat-look' }) as State & ReturnType<typeof fixture>
  Object.assign(state, { nodes: [], edits: [], stage: null, look: { area, turns: [] } })
  on('state.get', { plugin: 'agent-overview' }, (_$, e) => ({ value: { value: (state as any)[e.key], version: 0 } } as any))
  on('state.set', { plugin: 'agent-overview' }, (_$, e) => { Object.assign(state, { [e.key]: JSON.parse(JSON.stringify(e.value)) }); return { value: { isSet: true, version: 1 } } })
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.delete', (_$, e) => { delete store[e.key]; return { value: undefined } })
  on('session.id', () => ({ value: session.id }))
  on('session.model', () => ({ value: 'claude' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('agent.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '{}' }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.compose', () => ({ sections: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_$, e) => e.text === 'blocked' ? { drop: 'no' } : { text: e.text, context: e.context })
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text', props: {}, children: ['engine row'] }))
  // A panel switch reaches the look through storeMode; a test that sets the area by hand sets both.
  const mode = (a: Area) => { state.ui = { ...state.ui!, area: a }; state.look = { ...state.look!, area: a } }
  return { state, store, clock, mode, session }
}
type Node = { type: string; props: Record<string, any>; children?: (Node | string)[] }
const walk = (n: RenderElement | Node | string): Node[] => typeof n === 'string' || n.type === 'engine' ? [] : [n as Node, ...((n as Node).children ?? []).flatMap(walk)]
const row = (text: string, kind = 'composer') => ({ text, origin: { kind } as any, isExpanded: true })
async function submit($: any, clock: any, ...texts: string[]) { for (const text of texts) { await clock.advance(60000); await $.prompt.submit({ text, ...user }) } }

test('tokens: mentions, commands and paths are chips; plain words and look-alikes stay words', () => {
  expect(tokenOf('@codex')).toEqual({ kind: 'mention', text: '@codex', p: 'codex' })
  expect(tokenOf('@CMD')?.p).toBe('commandcode')
  expect(tokenOf('@gemini')?.p).toBe('antigravity')
  expect(tokenOf('@claude')?.p).toBe('claude')
  expect(tokenOf('@constructor')).toBeUndefined()
  expect(tokenOf('/handoff')?.kind).toBe('command')
  for (const path of ['src/parse.ts', 'README.md', '~/notes', './run.sh', '../a/b', '/Users/me/x']) expect(tokenOf(path)?.kind).toBe('file')
  for (const word of ['and/or', 'e.g', 'v1.2', '3.14', 'https://x.dev/a', 'hello', 'console.log', 'this.props', 'React.memo', 'example.com', 'claude.ai', 'done.Then']) expect(tokenOf(word)).toBeUndefined()
  for (const root of ['/tmp', '/etc', '/Users']) expect(tokenOf(root)?.kind).toBe('file')
  expect(fingerprint('a')).not.toBe(fingerprint('b'))
  expect(fingerprint(MSG)).toBe(fingerprint(MSG))
})

test('setting defaults and normalisation; Message look and Vibe divider persist from the shared block', async ($, on) => {
  expect(normalGuard({}).chat.vibeDivider).toBe('chase')
  expect(normalGuard({ chat: { vibeDivider: 'boat' } }).chat.vibeDivider).toBe('boat')
  expect(normalGuard({ chat: { vibeDivider: 'bad' } }).chat.vibeDivider).toBe('chase')
  const { state } = setup(on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: pane })
    await ui.press({ key: 'chat:divider:boat' }); expect(state.guard!.chat.vibeDivider).toBe('boat')
    await ui.press({ key: 'chat:look:false' }); expect(state.guard!.chatLook).toBe(false)
    await ui.press({ key: 'chat:look:true' }); expect(state.guard!.chatLook).toBe(true)
    await ui.press({ key: 'chat:divider:chase' }); expect(state.guard!.chat.vibeDivider).toBe('chase')
    await ui.unmount()
  }
})

test('turns number owner prompts in order; pre-recording rows, drops and session restore', async ($, on) => {
  const { state, store, clock } = setup(on)
  await submit($, clock, 'first', 'second', 'blocked', 'third')
  await $.prompt.submit({ text: 'note', wait: false, origin: { kind: 'task-notification' } })
  expect(state.look!.turns.map(t => t.key)).toEqual(['first', 'second', 'third'].map(fingerprint))
  expect(store['turns:look']).toEqual(state.look!.turns)
  // The delegation rewrite of a mention enters other text: both the typed and the entered text find the turn.
  await submit($, clock, '@codex fix the parser')
  const delegated = state.look!.turns[3]!
  expect(delegated.key).toBe(fingerprint('@codex fix the parser'))
  expect(delegated.sent).toBeDefined()
  expect(delegated.sent).not.toBe(delegated.key)
  for (const [text, header] of [['first', 'TURN 1 · DEFAULT'], ['third', 'TURN 3 · DEFAULT'], ['older prompt', 'DEFAULT']]) {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row(text!) })
    expect((await ui.find({ type: 'Text', text: /DEFAULT$/ }))?.text).toBe(header)
    await ui.unmount()
  }
  state.look = { area: 'vibe', turns: [] }
  await ($.session as any).start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  expect(state.look).toMatchObject({ area: 'overview', turns: [{ key: fingerprint('first') }, {}, {}, {}] })
})

test('a new session id (/clear or resume, no session.start) numbers its prompts afresh and leaves the old record', async ($, on) => {
  const { state, store, clock, session } = setup(on)
  session.id = 'a'; await submit($, clock, 'first', 'second')
  const before = JSON.stringify(store['turns:a'])
  session.id = 'b'; await submit($, clock, 'new chat')
  expect(store['turns:b']).toEqual([expect.objectContaining({ key: fingerprint('new chat') })])
  expect(JSON.stringify(store['turns:a'])).toBe(before)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row('new chat') })
  expect((await ui.find({ type: 'Text', text: /DEFAULT$/ }))?.text).toBe('TURN 1 · DEFAULT')
  await ui.unmount()
  // Back to a: its own list comes back; a /clear empties the look until the next prompt.
  session.id = 'a'; await submit($, clock, 'third')
  expect((store['turns:a'] as unknown[]).length).toBe(3)
  await ($.session as any).end({ reason: 'clear', sessionId: 'a', resume: { id: 'a' } })
  expect(state.look!.turns).toEqual([])
})

test('each mode draws its own message on desktop; the terminal, others\' rows and chatLook off keep their drawing', async ($, on) => {
  const { state, clock, mode } = setup(on)
  state.stage = { at: 'implement', reached: ['plan', 'implement'], round: 1 }
  await submit($, clock, 'warm up', 'again', MSG)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row(MSG) })
  const check = async () => {
    const all = walk(await ui.drawn())
    for (const s of all.filter(n => n.type === 'Svg')) {
      expect(String(s.props.alt).length).toBeGreaterThan(0)
      expect(s.props.isInteractive).toBeUndefined()
      expect(String(s.props.source).length).toBeLessThanOrEqual(131072)
      expect(String(s.props.source)).toContain('xmlns="http://www.w3.org/2000/svg"')
    }
    return all
  }
  let all = await check()
  expect(all.some(n => n.type === 'Box' && n.props.backgroundColor === '#34322f' && n.props.borderStyle === 'round' && n.props.borderColor === '#34322f')).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^@codex$/ }))?.props).toMatchObject({ backgroundColor: '#10a37f30', color: '#5fd0ac', mono: true })
  expect((await ui.find({ type: 'Text', text: /^\/handoff$/ }))?.props).toMatchObject({ backgroundColor: '#e0a03030' })
  expect((await ui.find({ type: 'Text', text: /^src\/parse\.ts$/ }))?.props).toMatchObject({ backgroundColor: '#ffffff12' })
  expect((await ui.find({ type: 'Text', text: /^3$/ }))?.props.size).toBe('heading')

  mode('work'); await ui.redraw()
  all = await check()
  expect(await ui.find({ type: 'Text', text: 'YOU · IMPLEMENT' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'IMPLEMENT ●' }))?.props.color).toBe('#d97757')
  expect((await ui.find({ type: 'Text', text: 'PLAN ✓' }))?.props.color).toBe('#7fbf7f')
  expect(all.filter(n => n.type === 'Svg' && String(n.props.source).includes('stroke-dasharray="3 3"')).length).toBe(4)
  expect((await ui.find({ type: 'Text', text: /^@codex$/ }))?.props.backgroundColor).toBe('#10a37f30')

  mode('vibe'); await ui.redraw()
  all = await check()
  const svgs = all.filter(n => n.type === 'Svg')
  expect(svgs.find(n => n.props.alt === 'Title bar')?.props.source).toContain('stroke-dashoffset')
  expect(svgs.find(n => n.props.alt === 'You')?.props).toMatchObject({ width: 22, height: 22 })
  expect(svgs.find(n => n.props.alt === 'Speech tail')?.props).toMatchObject({ width: 8, height: 22 })
  expect(svgs.find(n => n.props.alt === '@codex')?.props.source).toContain('<text')
  expect(svgs.find(n => n.props.alt === '/handoff')?.props.source).toContain('#e0a030')
  expect(svgs.find(n => n.props.alt === 'src/parse.ts')?.props.source).toContain('#4c8df6')
  expect(all.some(n => n.type === 'Box' && n.props.backgroundColor === '#211d2a')).toBe(true)
  expect(svgs.find(n => n.props.alt === 'Pellet chase')).toBeDefined()

  const long = `${MSG} ${'and more words '.repeat(60)}`
  state.look!.turns.push({ key: fingerprint(long), at: NOW, area: 'vibe' })
  await ui.redraw(row(long))
  expect(walk(await ui.drawn()).some(n => n.type === 'Svg' && n.props.alt === '@codex')).toBe(false)
  expect((await ui.find({ type: 'Text', text: /^@codex$/ }))?.props.backgroundColor).toBe('#10a37f30')

  // Line breaks survive in both the Text and the word-row drawings.
  const lines = 'Two lines for @codex:\n\n  check src/parse.ts'
  state.look!.turns.push({ key: fingerprint(lines), at: NOW, area: 'vibe' })
  await ui.redraw(row(lines))
  expect(walk(await ui.drawn()).filter(n => n.type === 'Svg' && /^(@codex|src\/parse\.ts)$/.test(n.props.alt)).length).toBe(2)
  mode('overview'); await ui.redraw(row(lines))
  expect((await ui.find({ type: 'Text', text: /^Two lines/ }))?.text).toBe(lines)
  mode('vibe')
  for (const props of [row(MSG, 'task-notification'), row('x'.repeat(10001)), row('!ls'), row('# remember this')]) {
    await ui.redraw(props); expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  }
  state.guard = normalGuard({ chatLook: false }); await ui.redraw(row(MSG))
  expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
  await ui.unmount()
  state.guard = normalGuard(undefined)
  const terminal = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'UserMessage', props: row(MSG) })
  expect(await terminal.find({ type: 'Text', text: '❯' })).toBeDefined()
  expect(walk(await terminal.drawn()).some(n => n.type === 'Svg')).toBe(false)
  await terminal.unmount()
})

test('a mode switch from the panel redraws the owner\'s messages in the new look', async ($, on) => {
  const { state, clock } = setup(on)
  await submit($, clock, MSG)
  const msg = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row(MSG) })
  const panel = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: pane })
  const boxed = async (bg: string) => { await msg.redraw(); return walk(await msg.drawn()).some(n => n.type === 'Box' && n.props.backgroundColor === bg) }
  for (const [area, bg] of [['vibe', '#211d2a'], ['overview', '#34322f']] as const) {
    // The mocked state does not push changes, so the panel is redrawn by hand to show Switch.
    await panel.press({ key: `area:${area}` }); await panel.redraw(); await panel.press({ key: 'area:confirm' })
    expect(state.ui!.area).toBe(area)
    expect(await boxed(bg)).toBe(true)
  }
  await panel.unmount(); await msg.unmount()
})

test('Vibe: a long path keeps Text chips; Motion still freezes every Svg', async ($, on) => {
  const { state, clock } = setup(on, 'vibe')
  const path = `/Users/me/projects/${'x'.repeat(17)}/chat-look.tsx`, text = `Read ${path} and ask @gemini.`
  expect(path.length).toBe(50)
  await submit($, clock, 'one', text)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row(text) })
  expect(walk(await ui.drawn()).some(n => n.type === 'Svg' && n.props.alt === path)).toBe(false)
  expect(walk(await ui.drawn()).find(n => n.type === 'Text' && n.children?.join('') === path)?.props.backgroundColor).toBe('#4c8df630')
  await ui.redraw(row(MSG))
  expect(walk(await ui.drawn()).some(n => n.type === 'Svg' && n.props.alt === 'src/parse.ts')).toBe(true)
  state.guard = normalGuard({ vibe: { motion: 'still' } })
  for (const props of [row(MSG), row(text)]) {
    await ui.redraw(props)
    const svgs = walk(await ui.drawn()).filter(n => n.type === 'Svg')
    expect(svgs.length).toBeGreaterThan(3)
    for (const n of svgs) expect(String(n.props.source)).not.toContain('<animate')
  }
  await ui.unmount()
})

test('dividers start at turn 2; only the newest Vibe divider moves; ghosts and speed follow the turn before', async ($, on) => {
  const { state, clock, mode } = setup(on, 'vibe')
  await submit($, clock, 'one')
  state.nodes = [{ id: 'c', provider: 'codex', model: 'gpt', kind: 'Codex', label: 'x', state: 'done', steps: 1, startedAt: NOW + 61000 },
    { id: 'o', provider: 'opencode', model: 'kimi', kind: 'OpenCode', label: 'y', state: 'done', steps: 1, startedAt: NOW + 62000 }] as AgentNode[]
  state.edits = [{ file: 'a.ts', lines: [], at: NOW + 63000 }]
  await submit($, clock, 'two', 'three')
  expect(state.look!.turns[1]).toMatchObject({ ran: ['codex', 'opencode'], work: 3 })
  expect(state.look!.turns[2]).toMatchObject({ ran: [], work: 0 })
  const divider = async (text: string) => {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row(text) })
    const svg = walk(await ui.drawn()).find(n => n.type === 'Svg' && /Pellet chase|Rowing boat/.test(n.props.alt))
    await ui.unmount(); return svg?.props as { source: string; alt: string; width: number } | undefined
  }
  expect(await divider('one')).toBeUndefined()
  const two = await divider('two'), three = await divider('three')
  expect(two!.source.includes('<animate')).toBe(false)
  expect(two!.source).toContain('#10a37f')
  expect(two!.source).toContain('#8b5cf6')
  expect(three!.source).toContain('<animateTransform')
  expect(three!.width).toBe(320)
  state.guard = normalGuard({ chat: { vibeDivider: 'boat' } })
  expect((await divider('three'))!.alt).toBe('Rowing boat')
  for (const work of [0, 3, 6, 20]) expect(boat(work, true).length).toBeLessThanOrEqual(131072)
  expect(boat(6, true)).toContain('dur="8.519s"')
  expect(boat(0, true)).toContain('dur="25.556s"')
  expect(chase(['codex', 'antigravity', 'opencode', 'commandcode'] as Provider[], true).length).toBeLessThanOrEqual(131072)
  for (const [area, divided] of [['overview', { type: 'Text', text: /^2$/ }], ['work', { type: 'Text', text: /^PLAN/ }]] as const) {
    mode(area)
    // Turns sent in Work mode carry their stage; the rail draws from it.
    if (area === 'work') state.look = { ...state.look!, turns: state.look!.turns.map(t => ({ ...t, stage: 'implement' as const })) }
    for (const [text, has] of [['one', false], ['two', true]] as const) {
      const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row(text) })
      expect(!!await ui.find(text === 'one' ? { ...divided, text: /^1$|^PLAN/ } : divided)).toBe(has)
      await ui.unmount()
    }
  }
})

test('Chat theme picks a look without changing the mode; Work outside Work mode keeps the turn-number divider', async ($, on) => {
  const { state, clock } = setup(on)
  await submit($, clock, 'first', MSG)
  const msg = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row(MSG) })
  const panel = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: pane })
  const nodes = async () => { await msg.redraw(); return walk(await msg.drawn()) }
  for (const [theme, bg] of [['vibe', '#211d2a'], ['work', '#2e2c29'], ['overview', '#34322f']] as const) {
    await panel.press({ key: `chat:theme:${theme}` })
    expect(state.guard!.chat.theme).toBe(theme)
    expect(state.ui!.area).toBe('overview')
    expect((await nodes()).some(n => n.type === 'Box' && n.props.backgroundColor === bg)).toBe(true)
  }
  await panel.press({ key: 'chat:theme:work' })
  const work = await nodes()
  expect(work.some(n => n.type === 'Text' && n.props.size === 'heading' && n.children?.[0] === '2')).toBe(true)
  expect(work.some(n => n.type === 'Text' && String(n.children?.[0]).startsWith('PLAN'))).toBe(false)
  await panel.press({ key: 'chat:theme:mode' })
  expect((await nodes()).some(n => n.type === 'Box' && n.props.backgroundColor === '#34322f')).toBe(true)
  await panel.unmount(); await msg.unmount()
})

test('desktop prompts (SDK origin) are numbered and restyled; unstamped rows from someone else keep the engine drawing', async ($, on) => {
  const { state, clock } = setup(on, 'vibe')
  for (const text of ['one', 'two']) { await clock.advance(60000); await $.prompt.submit({ text, origin: { kind: 'sdk' }, wait: false } as any) }
  expect(state.look!.turns).toHaveLength(2)
  const drawn = async (props: object) => { const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: props as any }); const n = walk(await ui.drawn()); await ui.unmount(); return n }
  const sdk = await drawn(row('two', 'sdk'))
  expect(sdk.some(n => n.type === 'Box' && n.props.backgroundColor === '#211d2a')).toBe(true)
  expect(sdk.some(n => n.type === 'Svg' && /Pellet chase/.test(n.props.alt))).toBe(true)
  expect((await drawn(row('two', 'unclassified'))).some(n => n.type === 'Box' && n.props.backgroundColor === '#211d2a')).toBe(true)
  expect((await drawn({ ...row('two', 'unclassified'), from: { kind: 'teammate', name: 'x' } })).some(n => n.props?.backgroundColor === '#211d2a')).toBe(false)
})

test('a prompt sent with images keeps the engine drawing (with its images) under the divider', async ($, on) => {
  const { clock } = setup(on, 'vibe')
  await submit($, clock, 'first')
  await clock.advance(60000); await $.prompt.submit({ text: 'see this', ...user, attachments: [{ id: 'img1', type: 'image' }] } as any)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row('see this') })
  const tree = await ui.drawn() as any, all = walk(tree)
  expect(all.some(n => n.props?.backgroundColor === '#211d2a')).toBe(false)
  expect(all.some(n => n.type === 'Svg' && /Pellet chase|Rowing boat/.test(n.props.alt))).toBe(true)
  expect(JSON.stringify(tree)).toContain('engine row')
  expect(tree.props.width).toBeUndefined()
  await ui.unmount()
})

test('a redrawn Vibe divider starts as far into its animation as the time since its turn', async ($, on) => {
  const { clock } = setup(on, 'vibe')
  await submit($, clock, 'one', 'two')
  await clock.advance(7500)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: row('two') })
  const svg = walk(await ui.drawn()).find(n => n.type === 'Svg' && /Pellet chase/.test(n.props.alt))!
  expect(svg.props.source).toContain('<animateTransform begin="-7.50s"')
  expect(svg.props.source).not.toMatch(/<animate(Transform)? (?!begin)/)
  await ui.unmount()
})

test('repeated identical prompts each keep their own turn number once bound to their stored rows', async ($, on) => {
  const { clock } = setup(on, 'vibe')
  mock.session(on)
  const send = async (text: string, uuid: string) => {
    await submit($, clock, text)
    await ($.session as any).append({ message: { type: 'user', content: [{ type: 'text', text }] }, door: 'prompt', origin: { kind: 'person' }, uuid })
  }
  await send('push it', 'r1'); await send('other', 'r2'); await send('push it', 'r3')
  const title = async (requestId: string, text: string) => {
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', requestId, props: row(text) } as any)
    const svg = walk(await ui.drawn()).find(n => n.type === 'Svg' && n.props.alt === 'Title bar')
    await ui.unmount(); return svg?.props.source as string
  }
  expect(await title('r1', 'push it')).toBe(titleBar('TURN 1 · VIBE'))
  expect(await title('r3', 'push it')).toBe(titleBar('TURN 3 · VIBE'))
  expect(await title('r2', 'other')).toBe(titleBar('TURN 2 · VIBE'))
})
