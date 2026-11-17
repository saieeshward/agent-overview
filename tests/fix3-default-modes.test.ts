import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { colorOf, nameOf } from '../hooks/state'
import { bigText } from '../hooks/view'
import { fixture, NOW } from '../tools/pane-fixtures'

function setup(on: On, state: Record<string, any>) {
  mock.clock(on, { now: NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
  on('session.id', () => ({ value: 'preview' }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
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
}
const props = (bodyColumns: number) => ({ title: 'Agent panel', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} })

for (const surface of ['desktop', 'terminal'] as const) {
  test(`provider tracks share a scale, retain left labels and use provider colours (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'models', scenario: 'busy-five-agents', busy: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(122) })
    for (const width of surface === 'desktop' ? [84, 122] : [100, 140]) {
      await ui.redraw(props(width))
      const rows = ['claude', ...state.routing.order]
      const tracks: number[] = [], fills: Record<string, number> = {}
      for (const p of rows) {
        if (surface === 'desktop') {
          const svg = (await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith(nameOf(p as any) + ' '))!.props
          const rects = [...String(svg.source).matchAll(/<rect[^>]*width="([\d.]+)"/g)].map(m => Number(m[1]))
          tracks.push(rects[0]!); fills[p] = rects[1]!
          expect(svg.alt).toContain('% left')
        } else {
          const text = (await ui.find({ key: `pcol:usage:${p}` }))!.text
          tracks.push(text.split(' ')[0]!.length)
          expect(text).toContain('% left')
          const bar = (await ui.findAll({ type: 'Text' })).find(t => t.text === text.split(' ')[0])
          expect(bar?.props.color).toBe(colorOf(p))
        }
      }
      expect(new Set(tracks).size).toBe(1)
      if (surface === 'desktop') expect(fills.opencode!).toBeGreaterThan(fills.codex!)
    }
    await ui.unmount()
  })

  test(`usage sorts windows, retains reset times and distinguishes provider pauses from window limits (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'dashboard', scenario: 'quota-paused', quota: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(122) })
    const chartOf = async () => (await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).includes('5h:'))
    const usage = async (p: string) => surface === 'desktop'
      ? String((await chartOf())!.props.alt).split('; ').filter(s => s.startsWith(p === 'codex' ? 'Codex ' : 'OpenCode ')).join('; ')
      : (await ui.find({ key: `usage:${p}` }))!.text
    expect(await usage('codex')).toContain('paused · back')
    expect(await usage('codex')).not.toContain('resets')
    expect(await usage('codex')).not.toContain('58%')
    expect((await usage('opencode')).match(/quota hit/g)).toHaveLength(1)
    expect(await usage('opencode')).not.toContain('% left')
    if (surface === 'desktop') expect((await chartOf())?.props.source).toContain('fill="url(#quota-empty)"')
    Object.assign(state.providers.opencode.meters[0], { limited: true, percent: 99 })
    await ui.redraw()
    const chart = await chartOf()
    const text = chart ? String(chart.props.alt) : (await ui.find({ key: 'usage' }))!.text
    expect(text).toContain('5h' + (chart ? ': empty' : ''))
    expect(text).not.toContain('1% left')
    expect(text).not.toContain('$4.10')
    expect(text).toContain('79% left')
    state.routing.order = ['commandcode']
    state.providers.claude.status = 'missing'
    await ui.redraw()
    const sorted = await chartOf()
    const cc = sorted ? String(sorted.props.source).match(/<text\b[^>]*>[^<]*<\/text>/g)!.join(' ') : (await ui.find({ key: 'usage:commandcode' }))!.text
    expect(cc.indexOf('5h')).toBeLessThan(cc.indexOf('week'))
    expect(cc.indexOf('week')).toBeLessThan(cc.indexOf('month'))
    expect(cc).toContain('12.3/60 cr used · resets 18d')
    await ui.unmount()
  })

  test(`plugin pins stay separate from mode choices and still toggle independently (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'plugins', scenario: 'expanded-plugins', expanded: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(surface === 'desktop' ? 49 : 64) })
    const pin = await ui.find({ key: 'pin:plugin:ponytail' })
    expect(pin?.text).toBe('×')
    expect(await ui.find({ type: 'Text', text: '✓ pinned' })).toBeDefined()
    expect(pin?.props.variant).not.toBe('primary')
    await ui.press({ key: 'pin:plugin:ponytail' })
    expect(state.pins).not.toContain('plugin:ponytail')
    expect(state.toggles['plugin:ponytail']).toBe('force')
    await ui.press({ key: 'mode:skill:ponytail:ponytail-audit:off' })
    expect(state.toggles['skill:ponytail:ponytail-audit']).toBe('off')
    expect(state.toggles['plugin:ponytail']).toBe('force')
    await ui.unmount()
  })

  test(`narrow stages and session history preserve distinct task names; dashboard counts subagents (${surface})`, async ($, on) => {
    const state = fixture({ area: 'overview', tab: 'dashboard', scenario: 'busy-five-agents', busy: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(49) })
    expect((await ui.find({ key: 'tile:run' }))?.text).toContain(surface === 'desktop' ? '5' : bigText('5').join(''))
    if (surface === 'desktop') {
      expect((await ui.find({ key: 'snode:opencode-1' }))?.text).toContain('Check the parser')
      expect((await ui.find({ key: 'snode:claude-1' }))?.text).toContain('Check the plan')
    }
    Object.assign(state, fixture({ area: 'overview', tab: 'agents', scenario: 'agents-history' }))
    await ui.redraw()
    for (const item of state.history.items) {
      const row = await ui.find({ key: `h:${item.at}:${item.label}` })
      expect(row?.text).toContain(item.label)
      expect(row?.text).not.toContain('claude-sonnet')
    }
    state.history.items.push({ ...state.history.items[0], session: 'other', label: 'Other session task' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Other session task/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`Implement uses the same short model name in priority and running rows (${surface})`, async ($, on) => {
    const state = fixture({ area: 'work', tab: 'implement', scenario: 'switch-blocked', stage: 'implement', busy: true })
    setup(on, state)
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(49) })
    expect((await ui.find({ key: 'impl:run:claude-1' }))?.text).toContain('sonnet-5-5')
    expect((await ui.find({ key: 'impl:run:claude-1' }))?.text).not.toContain('claude-sonnet-5-5')
    await ui.unmount()
  })
}
