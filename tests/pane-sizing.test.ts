import { expect, mock, test } from 'claude-code/testing'
import { fixture, LOG, NOW } from '../tools/pane-fixtures'

for (const width of [420, 700, 1000]) test(`desktop graphics fill their slots at ${width}px`, async ($, on) => {
  mock.clock(on, { now: NOW }); mock.store(on)
  const state = fixture({ area: 'work', tab: 'source', scenario: 'sizing', stage: 'review' })
  on('state.get', { plugin: 'agent-overview' }, (_$, e, next) => e.key in state ? { value: { value: state[e.key], version: 0 } } : next(e))
  on('session.id', () => ({ value: 'sizing' }))
  on('process.run', (_$, e) => ({ value: { stdout: e.argv.includes('--show-toplevel') ? '/repo' : e.argv.includes('log') ? LOG : '', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  const bodyColumns = Math.floor((width - 24) / 8), pixelWidth = bodyColumns * 8
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'desktop', component: 'Pane', requestId: 'agent-overview', props: {
    title: 'Agent panel', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 43 }, view: {},
  } })
  let svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.filter(s => String(s.props.alt).startsWith('Commit lanes'))).toHaveLength(6)
  expect(svgs[0]!.props.width).toBe(pixelWidth)
  expect(svgs[1]!.props.width).toBe(pixelWidth)
  expect(String(svgs[0]!.props.source)).toContain('font-size:12px')
  for (const svg of svgs.slice(2).filter(s => String(s.props.alt).startsWith('Commit lanes'))) expect(svg.props.height).toBe(30)
  state.ui = { ...state.ui, area: 'vibe', vibeTab: 'live' }
  await ui.redraw()
  const all = await ui.findAll({ type: 'Svg' })
  svgs = all.filter(s => String(s.props.alt).startsWith('Agent HQ:'))
  for (const icon of all.filter(s => !svgs.includes(s))) expect(icon.props).toMatchObject({ width: 24, height: 24 })
  expect(svgs).toHaveLength(1)
  expect(svgs[0]!.props.width).toBe(pixelWidth)
  expect(Number(svgs[0]!.props.height)).toBeLessThanOrEqual(43 * 20)
  expect(svgs[0]!.props.isInteractive).toBe(true)
  await ui.unmount()
})

test('terminal scene chooses the largest integer scale allowed by columns AND rows', async ($, on) => {
  mock.clock(on, { now: NOW }); mock.store(on)
  const state = fixture({ area: 'vibe', tab: 'live', scenario: 'sizing', busy: true })
  on('state.get', { plugin: 'agent-overview' }, (_$, e, next) => e.key in state ? { value: { value: state[e.key], version: 0 } } : next(e))
  const props = { title: 'Agent panel', isFocused: true, bodyColumns: 320, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 110 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props })
  expect((await ui.find({ key: 'vibe:scene' }))?.props).toMatchObject({ columns: 320, rows: 80 })
  await ui.redraw({ ...props, scroll: { offset: 0, bodyRows: 50 } })
  const small = (await ui.find({ key: 'vibe:scene' }))!.props
  expect(small.columns).toBe(160)
  expect(Number(small.rows)).toBeLessThanOrEqual(40)
  await ui.unmount()
})
