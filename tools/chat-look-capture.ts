// Mounted desktop UserMessage rows per mode, painted by pane-preview's desktop harness.
import { expect, mock, test } from 'claude-code/testing'
import type { Area, Look, Provider, StageId } from '../types'
import { fingerprint } from '../hooks/chat-look'
import { fixture, NOW } from './pane-fixtures'
import { CONFIG } from './preview-config'

const FIRST = 'Plan the export screen: ask @gemini for a layout check and @opencode for the copy.'
const THIRD = 'Hand the parser fix to @codex, run /handoff if Claude runs low, and check src/parse.ts after.'
const LONG = `Now the long one. ${'Walk through hooks/chat-look.tsx and the settings block, compare the frame with the approved page, and list anything that drifts from it. '.repeat(5)}Then ask @cmd to tidy the copy and run /review on README.md when done.`
const TEXTS = [FIRST, 'Good. Now the export screen.', THIRD, LONG]
const STAGES: StageId[] = ['plan', 'plan', 'implement', 'review']
const RAN: Provider[][] = [[], ['antigravity'], ['codex', 'opencode'], ['antigravity', 'commandcode']]

if (CONFIG.scenario === 'chat-look') test('preview chat look', { timeoutMs: 60000 }, async ($, on) => {
  const state = { ...fixture({ area: 'overview', tab: 'settings', scenario: 'chat-look' }), look: { area: 'overview', turns: [] } as Look }
  state.look.turns = TEXTS.map((text, i) => ({ key: fingerprint(text), at: NOW - (4 - i) * 7 * 60000, area: 'overview' as Area, stage: STAGES[i], ran: RAN[i], work: i * 2 }))
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: (state as any)[e.key] } } as any : r })
  on('session.id', () => ({ value: 'preview-look' }))
  on('ui.render', { component: 'UserMessage' }, (_$, e) => ({ type: 'Text', props: {}, children: [e.props.text] }))
  const reply = (text: string) => ({ type: 'Text', props: {}, children: [{ type: 'Text', props: { color: '#d97757' }, children: ['● '] }, text] })
  for (const width of CONFIG.desktop) for (const area of ['overview', 'work', 'vibe'] as const) for (const divider of area === 'vibe' ? ['chase', 'boat'] as const : ['chase'] as const) {
    state.ui.area = area; state.look.area = area; state.guard.chat.vibeDivider = divider
    const columns = Math.floor((width - 24) / 8), drawn = []
    for (const i of [0, 2, 3]) {
      const row = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'UserMessage', props: { text: TEXTS[i]!, origin: { kind: 'composer' }, isExpanded: true }, viewport: { columns, rows: 40 } })
      drawn.push(await row.drawn(), reply(['Sending the layout check to Gemini and the copy to OpenCode.', '', 'On it: Codex has the failing case attached.', 'Reading the module now.'][i]!))
      await row.unmount()
    }
    const tree = { type: 'Box', props: { flexDirection: 'column', gap: 1, padding: 1, backgroundColor: '#262624' }, children: [
      { type: 'Text', props: { weight: 'bold' }, children: [`${area} · turn 1, turn 3, long turn 4${area === 'vibe' ? ` · ${divider}` : ''}`] }, ...drawn,
    ] }
    expect(JSON.stringify(tree).includes('panel error:')).toBe(false)
    console.log('PANE_TREE:' + JSON.stringify({ surface: 'desktop', width, area, tab: 'chat', scenario: `chat-look${area === 'vibe' ? `-${divider}` : ''}`, tree }))
  }
})
