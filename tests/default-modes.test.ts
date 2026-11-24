import { expect, mock, test } from 'claude-code/testing'
import { plural, usageDetail } from '../hooks/ui'
import { reactionCaption } from '../hooks/vibe/live'
import { fixture } from '../tools/pane-fixtures'

test('quota details and reactions keep units and use readable labels', () => {
  expect(usageDetail('12.3 of 60 credits · resets in 2h')).toBe('12.3 of 60 credits used · resets in 2h')
  expect(usageDetail('≈ $4.10 of $12 · this machine only')).toBe('≈ $4.10 of $12 used · this machine only')
  expect(usageDetail('12.3 of 60 credits used')).toBe('12.3 of 60 credits used')
  expect(usageDetail('resets in 2h')).toBe('resets in 2h')
  for (const word of ['subagent', 'risk', 'skill', 'tool', 'line']) {
    expect(plural(1, word)).toBe(`1 ${word}`)
    expect(plural(2, word)).toBe(`2 ${word}s`)
  }
  expect(reactionCaption({ kind: 'tag', tag: 'saver', provider: 'claude', at: 0 })).toBe('Claude on saver')
  expect(reactionCaption({ kind: 'provider-on', provider: 'commandcode', at: 0 })).toBe('Command Code on')
  expect(reactionCaption({ kind: 'powerup', key: 'feature:codex-images', mode: 'force', at: 0 })).toBe('Codex image generation forced')
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`quota amounts, plugin controls and side-run prompts stay truthful on ${surface}`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'dashboard', scenario: 'regression' })
    mock.clock(on); mock.store(on); mock.env(on, { HOME: '/preview' })
    on('fs.read', { path: '/preview/.claude/.ponytail-active' }, () => ({ value: 'full' }))
    on('ui.invalidate', () => ({ value: undefined }))
    on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => {
      const r = await next(e)
      return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r
    })
    on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => {
      const r = await next(e)
      if (r.value?.isSet) state[e.key] = e.value
      return r
    })
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
      title: 'Agent panel', isFocused: true, bodyColumns: 122, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {},
    } })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
    expect(text).not.toContain('0 tokens')
    expect(text).not.toContain('Claude is told to use it')
    const folds = (await ui.findAll({ type: 'Button' })).filter(b => /^(fold:stage:|fold:dec:|node:)/.test(b.key ?? ''))
    expect(folds.length).toBeGreaterThan(0)
    expect(folds.every(b => b.text.trim().length === 1)).toBe(true)
    if (surface === 'desktop') {
      const chart = await ui.find({ type: 'Svg' })
      expect(Number(chart?.props.width)).toBeGreaterThan(900)
      expect(chart?.props.alt).toContain('12.3/60 cr used')
      expect(chart?.props.alt).toContain('$4.10 of $12 used')
      expect(chart?.props.alt).toContain('66% left')
    } else {
      expect(text).toContain('12.3/60 cr used')
      expect(text).toContain('66% left')
    }
    await ui.press({ key: 'tab:models' })
    expect(await ui.find({ key: 'preset:Claude only' })).toBeUndefined()
    expect(await ui.find({ key: 'chat:role' })).toBeDefined()
    expect(surface === 'desktop' ? (await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('OpenCode '))?.props.alt : (await ui.find({ key: 'pcol:usage:opencode' }))?.text).toContain('$4.10/$12')
    await ui.press({ key: 'open:claude' })
    expect(await ui.find({ type: 'Text', text: 'CHAT MODEL' })).toBeUndefined()
    await ui.press({ key: 'tab:plugins' })
    await ui.press({ key: 'mode:plugin:supermatt:on' })
    expect(state.toggles['plugin:supermatt']).toBe('on')
    expect(await ui.find({ key: 'cimg:plugins:on' })).toBeUndefined()
    const side = state.nodes.find((n: any) => n.provider === 'codex')
    Object.assign(side, { input: 'Build the pane', output: 'The pane is ready.' })
    state.ui = { ...state.ui, tab: 'agents', detail: side.id }
    await ui.redraw()
    expect(await ui.find({ key: 'act:title' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Codex run/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$ Build the pane/ })).toBeUndefined()
    expect(await ui.find({ key: 'prompt' })).toBeDefined()
    await ui.unmount()
  })
}
