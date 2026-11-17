import { expect, mock, test } from 'claude-code/testing'
import type { AdversarialRun, Finding, Routing } from '../types'
import { ADVERSARY, ADVERSARY_PROMPT, estimate, isReal, parseArgs, parseFindings, reviewerOf, spawnPrompt } from '../hooks/adversarial'
import { defaultRouting, withPicks } from '../hooks/state'

const P = '/Users/sai/repo'
const DIFF = 'diff --git a/src/parse.ts b/src/parse.ts\n--- a/src/parse.ts\n+++ b/src/parse.ts\n@@ -1 +1 @@\n-old\n+new\n'

test('arguments: go, cancel and status, else a base ref, rounds and the goal', () => {
  expect(parseArgs('go')).toMatchObject({ action: 'go' })
  expect(parseArgs('cancel')).toMatchObject({ action: 'cancel' })
  expect(parseArgs('status')).toMatchObject({ action: 'status' })
  expect(parseArgs('')).toEqual({ action: 'prepare', base: undefined, goal: '', rounds: undefined })
  expect(parseArgs('main make the parser reject empty input')).toEqual({ action: 'prepare', base: 'main', goal: 'make the parser reject empty input', rounds: undefined })
  expect(parseArgs('origin/develop rounds=3 fix it')).toMatchObject({ base: 'origin/develop', rounds: 3, goal: 'fix it' })
  expect(parseArgs('base=feature/x keep exports stable')).toMatchObject({ base: 'feature/x', goal: 'keep exports stable' })
  expect(parseArgs('reject empty input')).toMatchObject({ base: undefined, goal: 'reject empty input' })
  expect(parseArgs('rounds=9 x').rounds).toBeUndefined()
})

test('the reviewer is Opus 5.5 at the owner\'s rounds unless a Claude model is picked; the estimate scales with diff and rounds', () => {
  expect(reviewerOf(defaultRouting())).toEqual({ model: 'claude-opus-5-5', rounds: 2 })
  const r = withPicks(defaultRouting(), [{ provider: 'codex', model: 'gpt-6' }, { provider: 'claude', model: 'claude-sonnet-5-5' }])
  expect(reviewerOf({ ...r, adversary: { provider: 'codex', model: 'gpt-6', rounds: 3 } })).toMatchObject({ model: 'claude-opus-5-5', rounds: 3, note: expect.stringContaining('not a Claude model') })
  expect(reviewerOf({ ...r, adversary: { provider: 'claude', model: 'claude-sonnet-5-5', rounds: 1 } })).toEqual({ model: 'claude-sonnet-5-5', rounds: 1 })
  const one = estimate('claude-opus-5-5', 35000, 1)
  expect(one).toBeGreaterThan(0.05)
  expect(Math.abs(estimate('claude-opus-5-5', 35000, 2) - one * 2)).toBeLessThan(1e-9)
  expect(estimate('claude-opus-5-5', 70000, 1)).toBeGreaterThan(one)
  expect(estimate('claude-haiku-5-5', 35000, 1)).toBeLessThan(one)
  expect(Math.abs(estimate('claude-opus-5-5', 35000, 1, { catalog: { 'claude-opus-5-5': { input: 50, output: 250, source: 'test' } }, overrides: {} }) - one * 10)).toBeLessThan(1e-9)
})

test('the reviewer sees only the goal and the diff, and answers in the findings schema', () => {
  const prompt = spawnPrompt('reject empty input', { text: DIFF, base: 'main' }, 1, 2)
  expect(prompt).toBe(`Goal of the change: reject empty input\nDiff against main, round 1 of 2:\n\n${DIFF}`)
  expect(ADVERSARY_PROMPT).toContain('"severity": "high"|"medium"|"low", "file"')
  for (const key of ['line', 'issue', 'repro', 'confidence']) expect(ADVERSARY_PROMPT).toContain(`"${key}"`)
  const found = parseFindings('Here:\n```json\n[{"severity":"high","file":"src/parse.ts","line":1,"issue":"empty string passes","repro":"parse(\'\')","confidence":0.9},{"severity":"low","file":"a.ts","issue":"nit","repro":"","confidence":"low"},{"oops":1}]\n```')!
  expect(found).toHaveLength(2)
  expect(found[0]).toEqual({ severity: 'high', file: 'src/parse.ts', line: 1, issue: 'empty string passes', repro: "parse('')", confidence: 0.9 })
  expect(found[1]!.confidence).toBe(0.3)
  expect(found.filter(isReal)).toHaveLength(1)
  expect(parseFindings('[]')).toEqual([])
  expect(parseFindings('I could not find anything')).toBeUndefined()
})

function held(on: any, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

test('/review-adversarial shows the cost first, runs only on go, fixes between rounds and stops when nothing real is left', async ($, on) => {
  const clock = mock.clock(on); mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'adv' }))
  on('session.cwd', () => ({ value: P }))
  on('process.run', (_$: any, e: any) => {
    const a = e.argv.join(' ')
    const out = a.includes('--show-toplevel') ? P : a.includes('rev-parse --verify') ? 'abc123' : a.includes('diff --name-only') ? 'src/parse.ts\n' : a.includes('diff --no-color') ? DIFF : ''
    return { value: { stdout: out, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const state: Record<string, any> = { routing: defaultRouting() as Routing, findings: [] as Finding[] }
  held(on, state)
  const spawned: any[] = []
  on('agent.spawn', (_$: any, e: any) => { spawned.push(e); return { model: e.model, agentId: `rev${spawned.length}` } })
  // Reviewers are found by id, or by their round's description when a spawn did not hand the id back.
  on('agent.list', () => ({ value: spawned.map((x, i) => ({ id: `rev${i + 1}`, description: x.description, status: 'completed' })) }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  const submitted: string[] = []
  on('prompt.submit', (_$: any, e: any) => { submitted.push(e.text); return { text: e.text } })
  const cmd = async (args: string) => (await ($.command as any).run({ command: 'review-adversarial', args })).text as string

  // The model can only prepare it, and the owner starts it.
  const prep = await ($.tool as any).call({ tool: 'mcp__agent-overview__adversarial_review', tool_use_id: 't1', goal: 'reject empty input', base: 'main' })
  expect(prep.result).toContain('estimated ≈$')
  expect(prep.result).toContain('only Sai starts it')
  expect(spawned).toHaveLength(0)
  expect((state.adversarial as AdversarialRun).status).toBe('confirm')

  const shown = await cmd('main reject empty input')
  expect(shown).toContain('1 file changed against main, goal "reject empty input"')
  expect(shown).toContain('claude-opus-5-5 at high effort, up to 2 rounds, estimated ≈$')
  expect(spawned).toHaveLength(0)

  expect(await cmd('go')).toContain('round 1 of 2 started on claude-opus-5-5')
  // A plugin's spawn reaches the engine as an Agent call for the reviewer type.
  expect(spawned[0].subagentType ?? spawned[0].subagent_type).toBe(ADVERSARY)
  expect(spawned[0].model).toBe('claude-opus-5-5')
  expect(spawned[0].prompt).toBe(spawnPrompt('reject empty input', { text: DIFF, base: 'main' }, 1, 2))

  // Round 1 finds a real defect: it goes to the Review tab and to the main chat to fix.
  await ($.turn as any).complete({ turnId: 'r1', agentId: 'rev1', reason: 'answer', answer: '[{"severity":"high","file":"src/parse.ts","line":1,"issue":"empty string passes","repro":"parse(\'\')","confidence":0.9}]', isAborted: false, usage: null })
  expect(state.findings).toHaveLength(1)
  expect(state.findings[0]).toMatchObject({ file: 'src/parse.ts', line: 1, severity: 'high', by: ['opus-5-5 adversary r1'] })
  expect(state.findings[0].text).toContain('repro: parse')
  expect(state.adversarial).toMatchObject({ status: 'fixing', found: 1 })
  expect(submitted.at(-1)).toContain('requested by Sai')
  expect(submitted.at(-1)).toContain('src/parse.ts:1: empty string passes')

  // The fixing turn ends; round 2 starts on a fresh diff and finds nothing.
  await ($.turn as any).start({ text: 'fix', turnId: 'fix1' })
  await ($.turn as any).complete({ turnId: 'fix1', reason: 'answer', answer: 'fixed', isAborted: false, usage: null })
  await clock.advance(20)
  expect(spawned).toHaveLength(2)
  expect(spawned[1].prompt).toContain('round 2 of 2')
  await ($.turn as any).complete({ turnId: 'r2', agentId: 'rev2', reason: 'answer', answer: '[]', isAborted: false, usage: null })
  expect(state.adversarial).toMatchObject({ status: 'done', round: 2, note: 'round 2 found nothing real' })
  expect(await cmd('go')).toContain('Nothing to start')
  expect(spawned).toHaveLength(2)
})

test('the reviewer agent type is never offered to the model', async ($, on) => {
  const offered = await ($.agent as any).offer?.({ agent: ADVERSARY, description: 'x', source: 'plugin', provider: { plugin: 'agent-overview', tier: 'user' } }).catch(() => undefined)
  if (offered) expect(offered.isOffered).toBe(false)
})

test('Models shows a pending review with its cost; Run starts it and Cancel drops it', async ($, on) => {
  mock.clock(on); mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: P }))
  on('process.run', (_$: any, e: any) => {
    const a = e.argv.join(' ')
    const out = a.includes('--show-toplevel') ? P : a.includes('rev-parse --verify') ? 'abc123' : a.includes('diff --no-color') ? DIFF : ''
    return { value: { stdout: out, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const pending: AdversarialRun = { status: 'confirm', base: 'HEAD', goal: 'reject empty input', model: 'claude-opus-5-5', round: 0, rounds: 2, estimate: 0.42, diffChars: 101, files: 1, found: 0, at: 0 }
  const state: Record<string, any> = { adversarial: pending }
  held(on, state)
  let spawns = 0
  on('agent.spawn', (_$: any, e: any) => ({ model: e.model, agentId: `r${++spawns}` }))
  const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
  for (const surface of ['terminal', 'desktop'] as const) {
    state.adversarial = pending
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props })
    await ui.press({ key: 'tab:models' })
    expect(await ui.find({ type: 'Text', text: 'ADVERSARIAL REVIEW' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /up to 2 rounds · about 0\.42 USD/ })).toBeDefined()
    await ui.press({ key: 'adversarial:run' })
    expect(state.adversarial.status).toBe('running')
    await ui.press({ key: 'adversarial:cancel' })
    expect(state.adversarial).toMatchObject({ status: 'done', note: 'cancelled by the owner' })
    await ui.unmount()
  }
  expect(spawns).toBe(2)
})
