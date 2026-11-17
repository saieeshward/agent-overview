import { expect, mock, test } from 'claude-code/testing'
import type { Confidential, Policy } from '../types'
import { CLIENT_PATTERNS, clientHit, cloudCheck, defaultPolicy, neverCommitPatterns, onAllowlist, patternRegex } from '../hooks/policy'
import { defaultRouting } from '../hooks/state'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const P = '/Users/sai/napkin-studio-os'

test('client patterns match on path boundaries, globs included', () => {
  for (const text of ['read client_briefs/acme.pdf', 'see ./runs/metrics/today.json', 'engine/rag/golden/labels/client/a.jsonl', 'cat .env', 'source prod.env', `${P}/client_briefs/x`, '"client_briefs/x"'])
    expect(clientHit(text, CLIENT_PATTERNS)).toBeDefined()
  for (const text of ['old_client_briefs_note', 'runs/metricsx', '.envrc', 'environment', 'labels/clientele', 'the public brief'])
    expect(clientHit(text, CLIENT_PATTERNS)).toBeUndefined()
  expect(patternRegex('*.key').test('copy deploy.key now')).toBe(true)
})

test('the project\'s "Never commit" section and confidential lines give their backticked paths', () => {
  const md = [
    '# Rules', 'Use `pnpm`.', '',
    '## Never commit', '', '`.env` and `*.env`, `.napkin-dev-signing-key`, `client_briefs/`,',
    '`engine/rag/golden/labels/client/`. Client material is confidential.', '',
    '## Testing', 'Run `pytest -q` in `engine/`.',
    'Keep `exports/clients/` confidential too.',
  ].join('\n')
  expect(neverCommitPatterns(md).sort()).toEqual(['*.env', '.env', '.napkin-dev-signing-key', 'client_briefs/', 'engine/rag/golden/labels/client/', 'exports/clients/'].sort())
  expect(neverCommitPatterns('Nothing secret here; run `make`.')).toEqual([])
})

test('Antigravity needs an allowlisted project, no client sensitivity and no confidential path in the text', () => {
  const p: Policy = { ...defaultPolicy(), allow: [P] }
  expect(onAllowlist(p.allow, P)).toBe(true)
  expect(onAllowlist(p.allow, `${P}/app`)).toBe(true)
  expect(onAllowlist(p.allow, `${P}-other`)).toBe(false)
  expect(onAllowlist(['/'], '/anything')).toBe(true)
  expect(cloudCheck(p, P, { sensitivity: 'public', text: 'check the logo' })).toEqual({ allowed: true })
  expect(cloudCheck(p, P, { sensitivity: 'client' }).why).toContain('client material')
  expect(cloudCheck(p, P, { text: 'look at client_briefs/acme/brief.pdf' }).why).toContain('client_briefs/')
  expect(cloudCheck(p, P, { text: 'look at exports/clients/a.png', found: ['exports/clients/'] }).allowed).toBe(false)
  expect(cloudCheck({ ...p, patterns: ['secret/'] }, P, { text: 'secret/x' }).allowed).toBe(false)
  expect(cloudCheck(defaultPolicy(), P).why).toContain('not on the Antigravity allowlist')
})

function held(on: any, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

test('every way into Antigravity is gated: its MCP tools and Bash agy -p; client paths are refused even when allowed', async ($, on) => {
  mock.clock(on); mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: P }))
  const state: Record<string, any> = { routing: { ...defaultRouting(), agyCoding: true }, policy: defaultPolicy(), confidential: { cwd: P, found: ['exports/clients/'], sources: [`${P}/CLAUDE.md`] } as Confidential }
  held(on, state)
  const ran: string[] = []
  on('tool.call', (_$, e: any) => { ran.push(e.tool_use_id); return { result: 'ok', text: 'ok' } })
  const visual = (id: string, task: string) => ($.tool as any).call({ tool: 'mcp__antigravity__gemini_visual_qa', tool_use_id: id, task })
  const bash = (id: string, command: string) => ($.tool as any).call({ tool: 'Bash', tool_use_id: id, command })

  expect((await visual('v1', 'Check the logo in shot.png')).deny).toContain('not on the Antigravity allowlist')
  expect((await bash('b1', "agy --model gemini-3.8-flash-medium -p 'hi'")).deny).toContain('not on the Antigravity allowlist')
  expect(ran).toEqual([])

  state.policy = { ...defaultPolicy(), allow: [P] }
  expect((await visual('v2', 'Check the logo in shot.png')).deny).toBeUndefined()
  // The CLI never runs from Bash, allowlisted or not: gemini_run is the way in.
  expect((await bash('b2', "cd /tmp/x && agy -p='Check this' --sandbox")).deny).toContain('not run from Bash')
  expect((await visual('v3', 'Check client_briefs/acme/board.png')).deny).toContain('client_briefs/')
  expect((await visual('v4', 'Check exports/clients/a.png')).deny).toContain('exports/clients/')
  expect((await visual('v5', 'task:visual sensitivity:client Check the board')).deny).toContain('client material')
  expect((await bash('b3', 'agy -p "summarise runs/metrics/today.json"')).deny).toContain('runs/metrics/')
  // Any subcommand is refused; other commands are untouched.
  expect((await bash('b4', 'agy models')).deny).toContain('not run from Bash')
  expect((await bash('b6', 'ls /tmp')).deny).toBeUndefined()
  expect(ran).toEqual(['v2', 'b6'])

  state.routing = { ...state.routing, role: 'claude' }
  expect((await bash('b5', "agy -p 'hi'")).deny).toContain('Claude only')
})

test('Models shows the CONFIDENTIAL card: allow this project in one press, list patterns, add one', async ($, on) => {
  mock.clock(on)
  let stored: Policy | undefined
  on('store.set', { key: 'policy' }, (_$, e, next) => { stored = e.value as Policy; return next(e) })
  mock.store(on)
  on('ui.invalidate', () => ({ value: undefined }))
  const state: Record<string, any> = { policy: defaultPolicy(), confidential: { cwd: P, found: ['exports/clients/'], sources: [`${P}/CLAUDE.md`] } }
  held(on, state)
  for (const surface of ['terminal', 'desktop'] as const) {
    state.policy = defaultPolicy()
    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props })
    await ui.press({ key: 'tab:models' })
    expect(await ui.find({ type: 'Text', text: 'CONFIDENTIAL' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /refused everywhere/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /from CLAUDE\.md: exports\/clients\// })).toBeDefined()
    await ui.press({ key: 'conf:here:on' })
    expect(stored?.allow).toEqual([P])
    expect(await ui.find({ key: `conf:allow:${P}` })).toBeDefined()
    await ui.press({ key: 'conf:pattern:add' })
    await ui.input({ key: 'conf:pattern:input', text: 'clients/' })
    expect(stored?.patterns).toEqual(['clients/'])
    await ui.press({ key: 'conf:here:off' })
    expect(stored?.allow).toEqual([])
    await ui.unmount()
  }
})
