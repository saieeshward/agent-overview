import { expect, mock, test } from 'claude-code/testing'
import type { Policy, RouteLogItem } from '../types'
import { agyInText, expandVars, programWords } from '../hooks/agyguard'
import { geminiPrompt } from '../hooks/gemini'
import { CLIENT_PATTERNS, clientHit, cloudCheck, defaultPolicy, neverCommitPatterns, sideSensitivity, strictest } from '../hooks/policy'
import { defaultRouting } from '../hooks/state'

// Adversarial review round 1: findings 1, 2, 3, 4, 7, 8, 9, 10 (privacy).
const P = '/Users/sai/site'
const TMP = '/tmp/ao-gemini.Ab12Cd34'
const OK = JSON.stringify({ conversation_id: 'c', status: 'SUCCESS', response: 'fine', duration_seconds: 1, usage: { input_tokens: 10, output_tokens: 2 } })

function held(on: any, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

// A session in P with Antigravity allowed; `links` maps a path to what readlink -f says it is, `sizes` gives file sizes.
function harness($: any, on: any, extra: { links?: Record<string, string>; sizes?: Record<string, number>; which?: Record<string, string>; cwd?: string } = {}) {
  mock.clock(on); mock.store(on)
  mock.env(on, { HOME: '/home/t', PATH: '/usr/bin:/bin' })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'r1' }))
  let cwd = extra.cwd ?? P
  on('session.cwd', () => ({ value: cwd }))
  const sizes = extra.sizes ?? {}
  on('fs.stat', (_$: any, e: any) => {
    if (e.path.endsWith('/.local/bin/agy')) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
    if (e.path in sizes) return { value: { kind: e.path === '/dev/zero' ? 'other' : 'file', size: sizes[e.path], mtimeMs: 0, isLink: false } }
    throw new Error('ENOENT')
  })
  const runs: string[][] = []
  let answer = OK
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    runs.push(argv)
    let out = ''
    if (argv[0] === '/usr/bin/mktemp') out = `${TMP}\n`
    else if (argv[0] === '/usr/bin/readlink') out = `${extra.links?.[argv.at(-1)!] ?? argv.at(-1)}\n`
    else if (argv[0] === 'git') out = `${P}\n`
    else if (argv[0] === '/usr/bin/which') out = extra.which?.[argv[1]!] ? `${extra.which[argv[1]!]}\n` : ''
    else if (String(argv[0]).endsWith('/agy') && argv.includes('--sandbox')) out = answer
    const code = argv[0] === '/usr/bin/which' && !out ? 1 : 0
    return { value: { stdout: out, stderr: '', exitCode: code, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const state: Record<string, any> = { routing: defaultRouting(), policy: { ...defaultPolicy(), allow: [P] } as Policy, routeLog: [] as RouteLogItem[], nodes: [], confidential: { cwd: P, found: [], sources: [] } }
  held(on, state)
  let n = 0
  const gem = (input: Record<string, unknown>) => ($.tool as any).call({ tool: 'mcp__agent-overview__gemini_run', tool_use_id: `g${++n}`, prompt: 'Describe it.', sensitivity: 'public', ...input })
  const bash = (command: string, extraInput: Record<string, unknown> = {}) => ($.tool as any).call({ tool: 'Bash', tool_use_id: `b${++n}`, command, ...extraInput })
  const agyRuns = () => runs.filter(a => String(a[0]).endsWith('/agy') && a.includes('--sandbox'))
  return { state, runs, gem, bash, agyRuns, setAnswer: (a: string) => { answer = a }, setCwd: (c: string) => { cwd = c } }
}
// A successful run starts a usage refresh in the background: let it end before the test does.
const settle = () => new Promise(done => setTimeout(done, 200))
const node = (id: string, agentId: string, extra: Record<string, unknown> = {}) => ({ id, agentId, label: id, kind: 'task', model: 'm', state: 'running', steps: 0, ...extra })

// ---------- 1. sensitivity: inherited, never loosened, anything unknown is refused ----------

test('1: sideSensitivity and strictest fail closed', () => {
  expect(sideSensitivity('public', undefined)).toEqual({ sensitivity: 'public' })
  expect(sideSensitivity('internal', 'client')).toEqual({ sensitivity: 'client' })
  expect(sideSensitivity('public', 'internal')).toEqual({ sensitivity: 'internal' })
  for (const bad of [undefined, 'Client', 'confidential', 'publik', '', 'PUBLIC', 7, null]) expect('refuse' in sideSensitivity(bad, undefined)).toBe(true)
  expect(strictest(['public', 'banana'])).toBe('client')
  expect(strictest([undefined, 'internal', 'public'])).toBe('internal')
  expect(strictest([])).toBeUndefined()
  expect(cloudCheck({ ...defaultPolicy(), allow: [P] }, P, { sensitivity: 'Client' }).allowed).toBe(false)
  expect(cloudCheck({ ...defaultPolicy(), allow: [P] }, P, { sensitivity: 'internal', publicOnly: true }).why).toContain('public material only')
})

test('1: a "task:review sensitivity:client" subagent that calls gemini_run with sensitivity internal or public is refused', async ($, on) => {
  const h = harness($, on)
  // The repro from the review: the subagent's declaration is in the route log (and on its node); the call says "internal".
  h.state.routeLog = [{ at: 1, id: 'tu1', agentId: 'A1', tool: 'Agent', type: 'review', sensitivity: 'client', declared: 'ok', lane: 'claude', model: 'm', outcome: 'running' }]
  h.state.nodes = [node('tu1:1', 'A1')]
  for (const sensitivity of ['internal', 'public']) {
    const r = await h.gem({ agentId: 'A1', sensitivity, prompt: 'Summarise this client text.' })
    expect(r.deny).toContain('client material')
  }
  // The same through the node's own declaration, with no route-log row yet.
  h.state.routeLog = []
  h.state.nodes = [node('tu2:1', 'A2', { sensitivity: 'client' })]
  expect((await h.gem({ agentId: 'A2', sensitivity: 'public' })).deny).toContain('client material')
  // A grandchild inherits from its parent chain.
  h.state.nodes = [node('tu3:1', 'A3', { sensitivity: 'client' }), node('tu4:1', 'A4', { parentNode: 'tu3:1' })]
  expect((await h.gem({ agentId: 'A4', sensitivity: 'public' })).deny).toContain('client material')
  // An unknown word in a declaration counts as client; a stricter argument wins over a looser declaration.
  h.state.nodes = [node('tu5:1', 'A5', { sensitivity: 'confidential' })]
  expect((await h.gem({ agentId: 'A5', sensitivity: 'public' })).deny).toContain('client material')
  h.state.nodes = [node('tu6:1', 'A6', { sensitivity: 'public' })]
  expect((await h.gem({ agentId: 'A6', sensitivity: 'client' })).deny).toContain('client material')
  expect(h.agyRuns()).toHaveLength(0)
  // A public chain and a public argument go through.
  expect((await h.gem({ agentId: 'A6', sensitivity: 'public' })).deny).toBeUndefined()
  expect(h.agyRuns()).toHaveLength(1)
  await settle()
})

test('1: a missing, mis-cased or misspelled sensitivity is refused, and the description declaration counts too', async ($, on) => {
  const h = harness($, on)
  for (const sensitivity of [undefined, 'Client', 'confidential', 'publik']) {
    const r = await h.gem({ sensitivity })
    expect(r.deny).toContain('sensitivity must be exactly')
  }
  expect((await h.gem({ description: 'task:visual sensitivity:client check the board' })).deny).toContain('client material')
  expect(h.agyRuns()).toHaveLength(0)
})

test('1: the Antigravity MCP tools and the side lanes inherit the chain too', async ($, on) => {
  const h = harness($, on)
  const ran: string[] = []
  on('tool.call', (_$: any, e: any) => { ran.push(e.tool_use_id); return { result: 'ok', text: 'ok' } })
  h.state.nodes = [node('tu1:1', 'A1', { sensitivity: 'client' })]
  const mcp = (id: string, agentId?: string) => ($.tool as any).call({ tool: 'mcp__antigravity__gemini_visual_qa', tool_use_id: id, task: 'Check the logo', agentId })
  expect((await mcp('m1', 'A1')).deny).toContain('client material')
  expect((await mcp('m2')).deny).toBeUndefined()
  expect(ran).toEqual(['m2'])
  await settle()
})

// ---------- 9. an escalated agent gets no side lane; a failed Gemini run carries the ESCALATED hint ----------

test('9: an escalated agent cannot call gemini_run or ollama_run again; a failed Gemini run says to escalate once', async ($, on) => {
  const h = harness($, on)
  h.state.routing = { ...defaultRouting(), on: { ...defaultRouting().on, ollama: true } }
  h.state.nodes = [node('tu1:1', 'E1', { sensitivity: 'public', escalated: true })]
  expect((await h.gem({ agentId: 'E1' })).deny).toContain('side lanes are closed')
  const ollama = await ($.tool as any).call({ tool: 'mcp__agent-overview__ollama_run', tool_use_id: 'o1', prompt: 'x', agentId: 'E1' })
  expect(ollama.deny).toContain('side lanes are closed')
  expect(h.agyRuns()).toHaveLength(0)
  h.state.nodes = []
  h.setAnswer(JSON.stringify({ status: 'ERROR', error: 'RESOURCE_EXHAUSTED: quota' }))
  const failed = await h.gem({})
  expect(failed.deny).toContain('RESOURCE_EXHAUSTED')
  expect(failed.deny).toContain('ESCALATED')
  expect(failed.deny).toContain('escalated')
  await settle()
})

// ---------- 2. images: resolved, vetted, contained, copied without following links ----------

test('2: images are resolved and must be regular image files, small, inside the project, off confidential paths', async ($, on) => {
  const h = harness($, on, {
    links: {
      [`${P}/shots/ok.png`]: `${P}/shots/ok.png`,
      [`${P}/shots/innocent.png`]: `${P}/client_briefs/a.pdf`, // a symlink to a client brief
      [`${P}/shots/to-key.png`]: '/home/t/.ssh/id_rsa',
      [`${P}/shots/to-png-outside.png`]: '/home/t/Desktop/x.png',
      [`${P}/shots/zero.png`]: '/dev/zero',
      [`${P}/shots/to-env.png`]: `${P}/prod.env`,
    },
    sizes: { [`${P}/shots/ok.png`]: 1000, '/home/t/.ssh/id_rsa': 10, '/home/t/Desktop/x.png': 10, '/dev/zero': 0, [`${P}/client_briefs/a.pdf`]: 5, [`${P}/notes.txt`]: 5, [`${P}/shots/big.png`]: 21 * 1024 * 1024, [`${P}/prod.env`]: 5 },
  })
  const deny = async (images: string[]) => (await h.gem({ images })).deny as string
  expect(await deny([`${P}/shots/innocent.png`])).toContain('client_briefs/')
  expect(await deny([`${P}/shots/to-key.png`])).toContain('not an image file')
  expect(await deny(['/home/t/.ssh/id_rsa'])).toContain('not an image file')
  expect(await deny([`${P}/shots/to-png-outside.png`])).toContain('outside this project')
  expect(await deny(['/dev/zero'])).toContain('not an image file')
  expect(await deny([`${P}/shots/zero.png`])).toContain('not an image file')
  expect(await deny([`${P}/notes.txt`])).toContain('not an image file')
  expect(await deny([`${P}/shots/big.png`])).toContain('larger than 20 MB')
  expect(await deny([`${P}/shots/to-env.png`])).toMatch(/not an image file|prod\.env/)
  expect(await deny(['relative/x.png'])).toContain('absolute')
  expect(await deny(Array.from({ length: 9 }, (_, i) => `${P}/shots/ok${i}.png`))).toContain('at most 8')
  expect(h.agyRuns()).toHaveLength(0)
  expect(h.runs.some(a => a[0] === '/bin/cp')).toBe(false)
  // A good one is copied with -P (a link is never followed) from its resolved path, and named relative to the temp folder.
  const ok = await h.gem({ images: [`${P}/shots/ok.png`] })
  expect(ok.deny).toBeUndefined()
  expect(h.runs.find(a => a[0] === '/bin/cp')).toEqual(['/bin/cp', '-P', '--', `${P}/shots/ok.png`, `${TMP}/1-ok.png`])
  await settle()
})

// ---------- 7. agy gets relative image names and a guard; the lane is public only ----------

test('7: the prompt names images relative to the temp folder, adds a read guard, and the lane refuses internal', async ($, on) => {
  const prompt = geminiPrompt('List the logos.', ['1-a.png'], false)
  expect(prompt).toContain('Open the image 1-a.png in the current folder')
  expect(prompt).toContain('Never open, list, search or fetch any other path')
  expect(prompt).not.toMatch(/\/tmp|\/Users/)
  expect(geminiPrompt('Summarise.', [], false)).toContain('do not open any path')
  const h = harness($, on)
  expect((await h.gem({ sensitivity: 'internal' })).deny).toContain('public material only')
  expect(h.agyRuns()).toHaveLength(0)
})

// ---------- 3. agy in Bash, in any form ----------

const EVASIONS = [
  'agy -p hi', 'bash -c "agy -p hi"', "sh -c 'agy -p hi'", 'zsh -lc "agy -p hi"', '`agy -p hi`', 'echo $(agy -p hi)', 'A=agy; $A -p hi', 'A=ag; B=y; $A$B -p hi',
  'agy -p"hi"', 'agy -pm hi', '"agy" -p hi', "'agy' -p hi", 'a""gy -p hi', 'ag\\y -p hi', '/Users/sai/.local/bin/agy -p hi', 'env agy -p hi', 'nohup agy models &',
  'agy models', 'agy', 'cd /tmp && agy --version', 'xargs agy < list', "printf '\\x61gy' | sh", 'echo YWd5 | base64 -d | sh',
]
test('3: no Bash command runs agy in any form, with every switch in every state', async ($, on) => {
  const h = harness($, on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  for (const c of EVASIONS) {
    const r = await h.bash(c)
    expect(r.deny, c).toBeDefined()
  }
  // Allowed, on and allowlisted: still not from Bash.
  expect((await h.bash('agy -p hi')).deny).toContain('gemini_run')
  // The reasons when it is off, paused or the project is not allowlisted.
  h.state.routing = { ...defaultRouting(), role: 'claude' }
  expect((await h.bash('bash -c "agy -p hi"')).deny).toContain('Claude only')
  h.state.routing = { ...defaultRouting(), on: { ...defaultRouting().on, antigravity: false } }
  expect((await h.bash('A=agy; $A -p hi')).deny).toContain('turned off')
  h.state.routing = defaultRouting()
  h.state.policy = defaultPolicy()
  expect((await h.bash('`agy -p hi`')).deny).toContain('allowlist')
  // Ordinary commands go through.
  h.state.policy = { ...defaultPolicy(), allow: [P] }
  for (const c of ['ls -la', 'git status', 'echo hello', 'grep -rn gemini src', 'node build.js && echo done']) expect((await h.bash(c)).deny, c).toBeUndefined()
  await settle()
})

test('3: a symlink to the agy binary is found through PATH and readlink', async ($, on) => {
  const h = harness($, on, { which: { gem: '/home/t/bin/gem' }, links: { '/home/t/bin/gem': '/home/t/.local/bin/agy', '/home/t/.local/bin/agy': '/home/t/.local/bin/agy', './lnk': '/opt/tools/agy' } })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  expect((await h.bash('gem -p "hi"')).deny).toContain('resolves to the agy binary')
  expect((await h.bash('FOO=1 timeout 5 gem models')).deny).toContain('resolves to the agy binary')
  expect((await h.bash('./lnk -p hi')).deny).toContain('resolves to the agy binary')
  expect((await h.bash('ls')).deny).toBeUndefined()
})

test('3: the text checks themselves', () => {
  expect(expandVars('A=ag; B="y"; echo $A${B}')).toBe('A=ag; B="y"; echo agy')
  expect(programWords('FOO=1 env -i bash -c "cd x && gem -p hi" | cat')).toEqual(expect.arrayContaining(['gem', 'cd', 'cat']))
  expect(agyInText('echo legacy pedagogy')).toBeUndefined()
  expect(agyInText('run /opt/x/bin/tool', ['/opt/x/bin/tool'])).toContain('binary')
})

// ---------- 8. every Antigravity MCP tool is gated ----------

test('8: any mcp__antigravity__ tool takes the gate, not only three of them', async ($, on) => {
  const h = harness($, on)
  const ran: string[] = []
  on('tool.call', (_$: any, e: any) => { ran.push(e.tool_use_id); return { result: 'ok', text: 'ok' } })
  const call = (tool: string, id: string) => ($.tool as any).call({ tool, tool_use_id: id, task: 'x' })
  h.state.policy = defaultPolicy()
  expect((await call('mcp__antigravity__gemini_new_tool', 'n1')).deny).toContain('allowlist')
  expect((await call('mcp__antigravity__browser_open', 'n2')).deny).toContain('allowlist')
  h.state.routing = { ...defaultRouting(), role: 'claude' }
  expect((await call('mcp__antigravity__anything', 'n3')).deny).toContain('Claude only')
  expect(ran).toEqual([])
})

// ---------- 4. directory patterns without a trailing slash, and globs ----------

test('4: directory patterns match with no trailing slash and as globs', () => {
  for (const text of ['cd client_briefs && ls', 'ls runs/metrics', 'cat client_briefs', 'cd "client_briefs"', 'tar czf x.tgz runs/metrics;', 'ls client_br*/x', 'cat client_*/a.pdf', 'ls ./runs/met*', 'cat /Users/sai/site/client_br*/x', 'cp engine/rag/golden/labels/cli* /tmp'])
    expect(clientHit(text, CLIENT_PATTERNS), text).toBeDefined()
  for (const text of ['ls client_briefs_old', 'ls runs/metricsx', 'cat my_client_briefs', 'ls src/*.ts', 'ls *', 'ls */', 'cat client_notes.md', 'ls runs'])
    expect(clientHit(text, CLIENT_PATTERNS), text).toBeUndefined()
})

test('4: gemini_run and the MCP gate refuse a client directory named without a slash', async ($, on) => {
  const h = harness($, on)
  expect((await h.gem({ prompt: 'cd client_briefs and read it' })).deny).toContain('client_briefs')
  expect((await h.gem({ prompt: 'summarise runs/metrics' })).deny).toContain('runs/metrics')
  expect((await h.gem({ prompt: 'open client_br*/board.png' })).deny).toContain('client_briefs')
  expect(h.agyRuns()).toHaveLength(0)
})

// ---------- 10. confidential discovery fails closed ----------

test('10: "do not commit" lines and unbackticked paths are found', () => {
  const md = [
    '# Project', 'Do not commit exports/clients/ or secrets.json to git.', "Don't commit .napkin-key.", 'Never share client_briefs/ outside the team.',
    '## Confidential', 'The folder data/private/ and the file notes/plan.md stay local; also *.pem files.', '## Other', 'Use make.',
  ].join('\n')
  const found = neverCommitPatterns(md)
  for (const p of ['exports/clients/', '.napkin-key', 'client_briefs/', 'data/private/', '*.pem']) expect(found, p).toContain(p)
  expect(neverCommitPatterns('Use make and run tests.')).toEqual([])
})

test('10: a folder inside a confidential path is refused, and the folder is read live, not frozen at session start', async ($, on) => {
  expect(cloudCheck({ ...defaultPolicy(), allow: [P] }, `${P}/client_briefs/acme`, { sensitivity: 'public' }).why).toContain('inside a confidential path')
  expect(cloudCheck({ ...defaultPolicy(), allow: [P] }, `${P}/src`, { sensitivity: 'public' }).allowed).toBe(true)
  const h = harness($, on)
  expect((await h.gem({})).deny).toBeUndefined()
  await settle()
  // The session folder moves into a client folder of the same allowlisted repo; the stored confidential.cwd is still the old one.
  h.setCwd(`${P}/client_briefs/acme`)
  expect((await h.gem({})).deny).toContain('inside a confidential path')
  h.setCwd('/Users/sai/elsewhere')
  expect((await h.gem({})).deny).toContain('allowlist')
})
