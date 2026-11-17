import { expect, mock, test } from 'claude-code/testing'
import type { Policy, RouteLogItem } from '../types'
import { agyInText, programWords } from '../hooks/agyguard'
import { defaultPolicy } from '../hooks/policy'
import { defaultRouting } from '../hooks/state'

// Adversarial review round 2: findings A, B, C, D, E (privacy and the Bash guard).
const P = '/Users/sai/site'
const TMP = '/tmp/ao-gemini.Ab12Cd34'
const OK = JSON.stringify({ conversation_id: 'c', status: 'SUCCESS', response: 'fine', duration_seconds: 1, usage: { input_tokens: 10, output_tokens: 2 } })

function held(on: any, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

function harness($: any, on: any, extra: { links?: Record<string, string>; sizes?: Record<string, number>; files?: Record<string, string>; override?: (argv: string[]) => string | undefined } = {}) {
  mock.clock(on); mock.store(on)
  mock.env(on, { HOME: '/home/t', PATH: '/usr/bin:/bin' })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'r2' }))
  on('session.cwd', () => ({ value: P }))
  const sizes = extra.sizes ?? {}
  on('fs.stat', (_$: any, e: any) => {
    if (e.path.endsWith('/.local/bin/agy')) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
    if (e.path in sizes) return { value: { kind: 'file', size: sizes[e.path], mtimeMs: 0, isLink: false } }
    throw new Error('ENOENT')
  })
  on('fs.read', (_$: any, e: any) => {
    if (extra.files && e.path in extra.files) return { value: extra.files[e.path] }
    throw new Error('ENOENT')
  })
  const runs: string[][] = []
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    runs.push(argv)
    let out = ''
    const over = extra.override?.(argv)
    if (over !== undefined) out = over
    else if (argv[0] === '/usr/bin/mktemp') out = `${TMP}\n`
    else if (argv[0] === '/usr/bin/readlink') out = `${extra.links?.[argv.at(-1)!] ?? argv.at(-1)}\n`
    else if (argv[0] === 'git') out = `${P}\n`
    else if (argv[0] === '/usr/bin/stat') out = '1:2 Regular File\n'
    else if (String(argv[0]).endsWith('/agy') && argv.includes('--sandbox')) out = OK
    const code = argv[0] === '/usr/bin/which' ? 1 : 0
    return { value: { stdout: out, stderr: '', exitCode: code, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const state: Record<string, any> = { routing: defaultRouting(), policy: { ...defaultPolicy(), allow: [P] } as Policy, routeLog: [] as RouteLogItem[], nodes: [], confidential: { cwd: P, found: [], sources: [] } }
  held(on, state)
  let n = 0
  const gem = (input: Record<string, unknown>) => ($.tool as any).call({ tool: 'mcp__agent-overview__gemini_run', tool_use_id: `g${++n}`, prompt: 'Describe it.', sensitivity: 'public', ...input })
  const bash = (command: string) => ($.tool as any).call({ tool: 'Bash', tool_use_id: `b${++n}`, command })
  const mcp = (input: Record<string, unknown> = {}) => ($.tool as any).call({ tool: 'mcp__antigravity__gemini_visual_qa', tool_use_id: `m${++n}`, task: 'Check the logo', ...input })
  const agyRuns = () => runs.filter(a => String(a[0]).endsWith('/agy') && a.includes('--sandbox'))
  return { state, runs, gem, bash, mcp, agyRuns }
}
const settle = () => new Promise(done => setTimeout(done, 200))
const node = (id: string, agentId: string, extra: Record<string, unknown> = {}) => ({ id, agentId, label: id, kind: 'task', model: 'm', state: 'running', steps: 0, ...extra })

// ---------- A. sensitivity inheritance fails closed ----------

test('A: an undeclared, exempt or unresolvable subagent counts as internal, so gemini_run (public only) refuses', async ($, on) => {
  const h = harness($, on)
  // A node with no declaration (a fork, resume, teammate or an undeclared spawn under declare:warn).
  h.state.nodes = [node('tu1:1', 'U1')]
  expect((await h.gem({ agentId: 'U1' })).deny).toContain('public material only')
  // No node at all for that agent id (not adopted yet, or evicted), and no kept declaration.
  h.state.nodes = []
  expect((await h.gem({ agentId: 'GHOST' })).deny).toContain('public material only')
  // A declared child under an undeclared parent: the parent drags the chain to internal.
  h.state.nodes = [node('p:1', 'PA'), node('c:1', 'PB', { sensitivity: 'public', parentNode: 'p:1' })]
  expect((await h.gem({ agentId: 'PB' })).deny).toContain('public material only')
  // A parent node that cannot be found counts as internal too.
  h.state.nodes = [node('c:2', 'PC', { sensitivity: 'public', parentNode: 'gone:1' })]
  expect((await h.gem({ agentId: 'PC' })).deny).toContain('public material only')
  expect(h.agyRuns()).toHaveLength(0)
  // The main thread (no agentId) keeps the explicit argument: public goes through, internal is refused.
  expect((await h.gem({})).deny).toBeUndefined()
  expect((await h.gem({ sensitivity: 'internal' })).deny).toContain('public material only')
  expect(h.agyRuns()).toHaveLength(1)
  await settle()
})

test('A: a declared public subagent still passes, and the declaration survives its node being evicted', async ($, on) => {
  const h = harness($, on)
  h.state.nodes = [node('tu1:1', 'D1', { sensitivity: 'public' })]
  expect((await h.gem({ agentId: 'D1' })).deny).toBeUndefined()
  // The 60-node cap evicted every node: the separate map still knows what each agent declared.
  h.state.nodes = []
  h.state.agentSens = [{ agentId: 'D1', sensitivity: 'public' }, { agentId: 'D2', sensitivity: 'client' }, { agentId: 'D3', sensitivity: 'internal' }, { agentId: 'D4', sensitivity: 'public', parent: 'D3' }, { agentId: 'D5', sensitivity: 'public', escalated: true }]
  expect((await h.gem({ agentId: 'D1' })).deny).toBeUndefined()
  expect((await h.gem({ agentId: 'D2' })).deny).toContain('client material')
  expect((await h.gem({ agentId: 'D3' })).deny).toContain('public material only')
  expect((await h.gem({ agentId: 'D4' })).deny).toContain('public material only')
  expect((await h.gem({ agentId: 'D5' })).deny).toContain('side lanes are closed')
  // An agent id that nothing knows is internal.
  expect((await h.gem({ agentId: 'D9' })).deny).toContain('public material only')
  await settle()
})

// ---------- B. the Antigravity MCP gate is public-only ----------

test('B: the mcp__antigravity__ gate takes public material only', async ($, on) => {
  const h = harness($, on)
  const ran: string[] = []
  on('tool.call', (_$: any, e: any) => { ran.push(e.tool_use_id); return { result: 'ok', text: 'ok' } })
  h.state.nodes = [node('a:1', 'M1', { sensitivity: 'public' }), node('b:1', 'M2', { sensitivity: 'internal' }), node('c:1', 'M3')]
  expect((await h.mcp({ agentId: 'M2' })).deny).toContain('public material only')
  expect((await h.mcp({ agentId: 'M3' })).deny).toContain('public material only')
  expect((await h.mcp({ agentId: 'GHOST' })).deny).toContain('public material only')
  expect((await h.mcp({ sensitivity: 'internal' })).deny).toContain('public material only')
  expect(ran).toEqual([])
  expect((await h.mcp({ agentId: 'M1' })).deny).toBeUndefined()
  expect((await h.mcp({})).deny).toBeUndefined()
  expect(ran).toHaveLength(2)
  await settle()
})

// ---------- C. the Bash guard: ordinary commands pass, evasions stay refused ----------

const ORDINARY = [
  'ls -la', 'git status', 'git log --oneline -5', 'git commit -m "mention agy"', 'git diff -- src/agy.ts', 'grep -rn agy src/', 'grep -rn "agy" hooks | head',
  'cat src/agy.ts', 'head -20 hooks/agyguard.ts', 'ls agy-foo/', 'wc -l src/agy.test.ts', 'base64 -d file > out', 'xxd -r -p hex.txt out.bin', "printf '\\033[1m'", "printf '\\x61gy\\n' > f",
  "sed 's/\\x1b//' file", 'echo hello', 'echo "use agy for this"', 'node build.js && echo done', 'echo YWd5 | base64 -d', 'which agy', 'command -v agy', 'rg agy', "find . -name 'agy*' -print",
  'npm run test -- agy', 'mkdir -p src/agy && cp a src/agy/b', "python3 -c 'print(\"agy\")'", 'tar tf archive-agy.tgz', '[ -f x ] && echo yes', 'ls *.ts', 'echo "today is $(date)"',
  'for f in *.ts; do echo $f; done', 'cat > notes.md <<EOF\nwe call agy through gemini_run\nclient_briefs and runs/metrics are private\nEOF', "cat <<'EOF' > x.md\nagy -p hi\nEOF", 'echo x # agy',
]
const EVASIONS = [
  'agy -p hi', 'bash -c "agy -p hi"', '`agy -p hi`', 'A=agy; $A -p hi', 'A=ag; B=y; $A$B -p hi', 'a""gy -p hi', 'ag\\y -p hi', '/Users/sai/.local/bin/agy -p hi', 'env agy -p hi',
  'xargs agy < list', "printf '\\x61gy' | sh", 'echo YWd5 | base64 -d | sh',
  "$'\\x61gy' -p hi", 'eval "agy -p hi"', 'sh -c "$(echo YWd5 | base64 -d) -p hi"', 'eval $(echo YWd5 | base64 --decode)', 'xxd -r -p h | bash', "printf '\\141gy' | zsh",
  'sh <<EOF\nagy -p hi\nEOF', 'cat <<EOF\n$(agy -p hi)\nEOF', 'find . -exec agy {} \\;', 'FOO=1 command agy models', 'cd /tmp && (agy --version)', 'echo yga | rev | sh', 'bash <(echo YWd5 | base64 -d)',
]
test('C: ordinary commands that merely mention the name pass the Bash guard', async ($, on) => {
  const h = harness($, on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  expect(ORDINARY.length).toBeGreaterThanOrEqual(20)
  for (const c of ORDINARY) expect((await h.bash(c)).deny, c).toBeUndefined()
  // Quoted or heredoc text that names the name together with a confidential folder is data, not a command.
  expect(agyInText('cat > f <<EOF\nagy and client_briefs\nEOF')).toBeUndefined()
  expect(agyInText('grep -rn agy src/')).toBeUndefined()
  await settle()
})

test('C: evasions stay refused, including decoding that reaches a shell, eval or the command word', async ($, on) => {
  const h = harness($, on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  for (const c of EVASIONS) expect((await h.bash(c)).deny, c).toBeDefined()
  expect(programWords('cat <<EOF\nagy\nEOF\nls')).toEqual(['cat', 'ls'])
  await settle()
})

// ---------- D. globs and scripts ----------

test('D: a glob command word that could expand to the CLI is refused', async ($, on) => {
  const h = harness($, on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  for (const c of ['ag? -p hi', 'ag[y] -p hi', 'a*y -p hi', '/Users/sai/.local/bin/ag* x', 'a{g,}y', '~/.local/bin/ag?', 'nohup ag?']) expect((await h.bash(c)).deny, c).toBeDefined()
  for (const c of ['ls ag?', 'echo ag*', 'cat src/ag?.ts', 'ls *.ts', './run-tests.sh', '[ -d src ]']) expect((await h.bash(c)).deny, c).toBeUndefined()
  await settle()
})

test('D: sh, bash, zsh or source on a script whose text runs the CLI is refused; an unreadable script is allowed', async ($, on) => {
  const h = harness($, on, { files: { [`${P}/go.sh`]: '#!/bin/sh\necho start\nagy -p hi\n', [`${P}/docs.sh`]: 'grep -rn agy src/\ncat src/agy.ts\n', '/opt/run.sh': 'bash -c "agy models"' } })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  for (const c of ['sh go.sh', 'bash ./go.sh arg', 'zsh go.sh', 'source go.sh', '. ./go.sh', 'bash -x /opt/run.sh', 'cd x; sh go.sh']) expect((await h.bash(c)).deny, c).toBeDefined()
  for (const c of ['sh docs.sh', 'bash missing.sh', 'sh -c "echo hi"', 'bash ~/unreadable.sh']) expect((await h.bash(c)).deny, c).toBeUndefined()
  await settle()
})

// ---------- E. image re-checked right before the copy ----------

test('E: an image swapped for another file or a link between the check and the copy is refused', async ($, on) => {
  const img = `${P}/shots/ok.png`
  let swap: 'none' | 'link' | 'inode' = 'none'
  let reads = 0, stats = 0
  const h = harness($, on, { sizes: { [img]: 100 }, override: argv => {
    if (argv[0] === '/usr/bin/readlink' && argv.at(-1) === img && swap === 'link' && ++reads > 1) return '/home/t/.ssh/id_rsa\n'
    if (argv[0] === '/usr/bin/stat' && argv.at(-1) === img && swap === 'inode' && ++stats > 1) return '1:99 Regular File\n'
    return undefined
  } })
  const copies = () => h.runs.filter(a => a[0] === '/bin/cp')
  swap = 'link'
  expect((await h.gem({ images: [img] })).deny).toContain('changed after it was checked')
  swap = 'inode'
  expect((await h.gem({ images: [img] })).deny).toContain('changed after it was checked')
  expect(copies()).toHaveLength(0)
  expect(h.agyRuns()).toHaveLength(0)
  swap = 'none'
  expect((await h.gem({ images: [img] })).deny).toBeUndefined()
  expect(copies()).toHaveLength(1)
  await settle()
})
