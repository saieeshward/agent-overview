import { expect, mock, test } from 'claude-code/testing'

import type { GrillItem } from '../types'

test('QA keeps legacy answers and new instructions with distinct chips in both tabs', async ($, on) => {
  mock.clock(on, { now: 1234 })
  await ($.tool as any).call({ tool: 'mcp__agent-overview__grill_log', tool_use_id: 'old', question: 'Which style?', answer: 'Keep it simple.' })
  await ($.tool as any).call({ tool: 'mcp__agent-overview__qa_log', tool_use_id: 'new', question: 'Dependencies', answer: 'Do not add dependencies.', kind: 'instruction' })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: {
    title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {},
  } })
  for (const tab of ['dashboard', 'activity']) {
    await ui.press({ key: `tab:${tab}` })
    expect(await ui.find({ type: 'Text', text: 'QA' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 kept' })).toBeDefined()
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.find(x => x.text === ' Q1 ' && x.props.inverse)?.props).toMatchObject({ inverse: true, color: 'suggestion' })
    expect(texts.find(x => x.text === ' I ' && x.props.inverse)?.props).toMatchObject({ inverse: true, color: 'planMode' })
    expect(await ui.find({ type: 'Text', text: /Dependencies/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Do not add dependencies/ })).toBeDefined()
  }
  await ui.unmount()
})

test('QA timestamps entries, defaults to answers and keeps the last forty', async ($, on) => {
  mock.clock(on, { now: 1234 })
  let items: GrillItem[] = [{ question: 'Legacy entry', answer: 'Still valid.' }]
  let version = 0
  on('state.get', { plugin: 'agent-overview', key: 'grill' }, () => ({ value: { value: items, version } }))
  on('state.set', { plugin: 'agent-overview', key: 'grill' }, (_$, e) => {
    items = e.value
    return { value: { isSet: true, version: ++version } }
  })
  for (let i = 0; i < 41; i++) {
    await ($.tool as any).call({ tool: 'mcp__agent-overview__qa_log', tool_use_id: `qa${i}`, question: `Topic ${i}`, answer: `Answer ${i}` })
  }
  expect(items.length).toBe(40)
  expect(items[0]).toEqual({ question: 'Topic 1', answer: 'Answer 1', kind: 'answer', at: 1234 })
  expect(items[39]).toEqual({ question: 'Topic 40', answer: 'Answer 40', kind: 'answer', at: 1234 })
})

test('QA saves every new entry as one ADR request, and edit mode deletes entries one by one', async ($, on) => {
  mock.clock(on)
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const log = (question: string, answer: string, kind = 'answer') =>
    ($.tool as any).call({ tool: 'mcp__agent-overview__qa_log', tool_use_id: question, question, answer, kind })
  await log('Where do presets live?', 'Presets are saved for every chat.')
  await log('Cost scope', 'Cost counts this chat only.', 'instruction')
  await log('Scratch note', 'Not a decision.')
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: { title: 'Overview', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} } })
  // Delete one entry in edit mode.
  await ui.press({ key: 'qaedit:dash' })
  await ui.press({ key: 'qadel:dash:2' })
  await ui.press({ key: 'qaedit:dash' })
  expect(await ui.find({ type: 'Text', text: /Scratch note/ })).toBeUndefined()
  // Save the rest as one request.
  await ui.press({ key: 'qasave:dash' })
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('ADR')
  expect(sent[0]).toContain('1. Topic: Where do presets live?')
  expect(sent[0]).toContain('2. Topic: Cost scope')
  expect(sent[0]).toContain('Owner instruction: Cost counts this chat only.')
  expect(sent[0]).not.toContain('Scratch note')
  expect(await ui.find({ type: 'Text', text: '✓ saved' })).toBeDefined()
  // A new entry after saving is offered on its own.
  await log('Media cost', 'Outside tools add to the total.')
  await ui.redraw()
  expect((await ui.find({ key: 'qasave:dash' }))?.text).toContain('1 new')
  await ui.unmount()
})
