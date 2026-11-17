import { detachedCommand, sideMarkers } from '../hooks/graph'
import { expect, test } from 'claude-code/testing'

import { externalOf, sideCommand, buildTree, labelOf, sideRuns, stagesOf, stateOf, stdinFileOf, taskOf, usageTail } from '../hooks/graph'
import { blank, normalRouting, defaultRouting, withFlags } from '../hooks/state'
import type { AgentNode, Providers } from '../types'

const n = (id: string, extra: Partial<AgentNode> = {}): AgentNode => ({ id, label: id, kind: 'general-purpose', model: 'claude-opus-5-5', state: 'done', steps: 0, startedAt: 0, ...extra })

test('task prompts skip CLI flags and preserve shell quoting', async () => {
  expect(taskOf(`codex exec -m gpt -c 'effort="high"' -s workspace-write -C /repo -o out.txt --full-auto "Fix the parser"`)).toBe('Fix the parser')
  expect(taskOf(`codex --cd '/repo with spaces' e --model=gpt --config=x --sandbox=read-only --output-last-message=out 'Fix it'`)).toBe('Fix it')
  expect(taskOf(`codex exec -- 'A "quoted" task'`)).toBe('A "quoted" task')
  expect(taskOf(`codex exec "It's a \\"test\\""`)).toBe(`It's a "test"`)
  expect(taskOf('codex exec Fix\\ the\\ parser')).toBe('Fix the parser')
  expect(taskOf('codex exec "<Fix> the parser"')).toBe('<Fix> the parser')
  expect(taskOf('codex exec "Fix it\n\n# Task: Parser work"')).toBe('Fix it\n\n# Task: Parser work')
  expect(taskOf('codex exec -m gpt -')).toBeUndefined()
  expect(taskOf('codex exec -m gpt')).toBeUndefined()
  expect(taskOf('exec codex exec "Fix it"')).toBe('Fix it')
  expect(taskOf('codex -C exec exec "Fix it"')).toBe('Fix it')
  expect(taskOf('codex exec < input.md 2> errors.log')).toBeUndefined()
  expect(taskOf('codex exec - < prompt.md')).toBeUndefined()
  expect(taskOf('opencode run --model m --variant high --agent build --format json Fix the "parser tests"')).toBe('Fix the parser tests')
  expect(taskOf('opencode run -m=m --cd=/repo --variant=high "Fix it" --title test')).toBe('Fix it')
  expect(taskOf('opencode run --model m < prompt.md')).toBeUndefined()
  expect(taskOf('cmd --model m --effort high -p "Review the code"')).toBe('Review the code')
  expect(taskOf("command-code --print='Review it' --model=m")).toBe('Review it')
  expect(taskOf(`CC="/Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs"; node "$CC" -p 'Review it'`)).toBe('Review it')
  expect(taskOf('echo "codex exec fake"')).toBeUndefined()
  expect(stdinFileOf(`cd /repo && codex exec - < 'prompt file.md'`)).toBe('prompt file.md')
  expect(stdinFileOf('opencode run < "prompt file.md"')).toBe('prompt file.md')
  expect(stdinFileOf('codex exec "literal < file"')).toBeUndefined()
  expect(stdinFileOf('codex exec - << EOF\nprompt\nEOF')).toBeUndefined()
  expect(stdinFileOf('codex exec - < "$PROMPT"')).toBeUndefined()
})

test('task labels prefer the Task heading, then a heading, then the first line', async () => {
  expect(labelOf('Introduction\n## Context\n# Task:  Fix the parser  \nDetails')).toBe('Fix the parser')
  expect(labelOf('\nIntroduction\r\n### A useful heading\r\nDetails')).toBe('A useful heading')
  expect(labelOf('\n  First useful line  \nDetails')).toBe('First useful line')
  expect(labelOf('a'.repeat(100))).toBe('a'.repeat(70))
  expect(labelOf(' \n\t')).toBe('')
})

test('the tree nests children under parents, running work first', async () => {
  const list = [
    n('ui', { startedAt: 1 }),
    n('ui-a', { parentNode: 'ui', startedAt: 2 }),
    n('ui-b', { parentNode: 'ui', startedAt: 3, state: 'running' }),
    n('ui-b-1', { parentNode: 'ui-b', startedAt: 4 }),
    n('check', { startedAt: 5 }),
  ]
  const rows = buildTree(list)
  expect(rows.map(r => `${r.prefix}${r.node.id}`)).toEqual(['├─check', '╰─ui', '  ├─ui-b', '  │ ╰─ui-b-1', '  ╰─ui-a'])
  expect(buildTree(list, new Set(['check'])).map(r => r.node.id)).toEqual(['check'])
})

test('stages come from the work: shared "word:" labels, else agents started together', async () => {
  const list = [
    n('a', { label: 'scout:transcript', startedAt: 0 }),
    n('b', { label: 'Scout: toggles', startedAt: 1000 }),
    n('c', { label: 'fix the header', startedAt: 20000, state: 'running' }),
    n('d', { label: 'fix the footer', startedAt: 21000 }),
    n('e', { label: 'review:bugs', startedAt: 60000, state: 'failed' }),
    n('f', { label: 'write release notes', startedAt: 90000 }),
  ]
  const st = stagesOf(list)
  expect(st.map(x => [x.name, x.nodes.length, x.state])).toEqual([['Scout', 2, 'done'], ['fix the header +1', 2, 'running'], ['Review', 1, 'failed'], ['write release notes', 1, 'done']])
})

test('a workflow group runs while any of its agents does', async () => {
  const list = [n('wf', { kind: 'workflow', state: 'running' }), n('a', { parentNode: 'wf' }), n('b', { parentNode: 'wf', state: 'running' })]
  expect(stateOf(list[0]!, list)).toBe('running')
  expect(stateOf(list[0]!, [list[0]!, list[1]!])).toBe('done')
})

test('the usage tail lists every provider in one dim line', async () => {
  const blank = { status: 'ok' as const, meters: [], facts: [], models: [] }
  const all: Providers = {
    claude: { ...blank, meters: [{ label: '5-hour', percent: 34.4 }, { label: 'Weekly', percent: 12 }, { label: 'Context', percent: 50 }] },
    codex: { ...blank, meters: [{ label: 'Weekly', percent: 1 }] },
    commandcode: { ...blank, facts: ['54.46 monthly credits left'] },
    opencode: { ...blank, facts: ['$0.71 spent in 7 days'] },
    antigravity: { ...blank, alert: 'quota hit' },
    ollama: blank,
  }
  const r = { ...defaultRouting(), on: { ...defaultRouting().on, codex: false } }
  const usage = 'Claude 5h 66% left wk 88% left · Antigravity quota! · OpenCode $0.71/7d · Command Code 54 cr · Codex off'
  expect(usageTail(all, r)).toBe(`auto · ${usage}`)
  expect(usageTail(all, { ...r, role: 'claude' })).toBe(`claude only · ${usage}`)
  expect(usageTail(all, { ...r, role: 'plan' })).toBe(`plans only · ${usage}`)
  for (const role of ['auto', 'claude', 'plan'] as const) {
    const label = role === 'claude' ? 'claude only' : role === 'plan' ? 'plans only' : 'auto'
    expect(usageTail(all, normalRouting({ ...r, role, tags: { opencode: 'main' }, picks: [{ provider: 'opencode', model: 'main-model' }] }))).toBe(`${label}${role === 'claude' ? '' : ' ⇢ main-model'} · ${usage}`)
    expect(usageTail(all, normalRouting({ ...r, role, tags: { codex: 'main' }, picks: [{ provider: 'codex', model: 'off-main' }] }))).toBe(`${label} · ${usage}`)
    expect(usageTail(all, normalRouting({ ...r, role, tags: { claude: 'main' }, picks: [{ provider: 'claude', model: 'opus' }] }))).toBe(`${label}${role === 'auto' ? ' ⇢ opus' : ''} · ${usage}`)
  }
})


test('process discovery counts wrappers once and ignores app, help and unrelated processes', async () => {
  const cc = '/Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs'
  expect(sideRuns([
    ' 101 02:03 node /usr/local/lib/node_modules/@openai/codex/bin/codex exec -m gpt-6.1-sol -C /repo/mod -',
    ' 102 02:03 /usr/local/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex exec -m gpt-6.1-sol -',
    ' 103 00:40 /Applications/ChatGPT.app/Contents/Resources/codex exec -m gpt-6.1-sol task',
    ' 104 01:02:03 /usr/local/bin/opencode run --model opencode-go/m --cd=/repo/other task',
    ' 105 00:01 codex exec --help',
    ' 106 00:05 pgrep -fl codex exec',
    ` 107 1-02:03:04 node ${cc} -p task --model m`,
    ` 108 00:01 node ${cc} --help -p`,
    ` 109 00:01 node ${cc} --model m`,
    ' 110 00:08 codex e task',
    ' 111 00:01 opencode run --version',
    ' 112 00:01 /usr/bin/python script.py codex exec',
    ' 113 invalid codex exec',
  ].join('\n'))).toEqual([
    { pid: 101, provider: 'codex', model: 'gpt-6.1-sol', dir: '/repo/mod', ms: 123000 },
    { pid: 104, provider: 'opencode', model: 'opencode-go/m', dir: '/repo/other', ms: 3723000 },
    { pid: 107, provider: 'commandcode', model: 'm', ms: 93784000 },
    { pid: 110, provider: 'codex', ms: 8000 },
  ])
})


test('process discovery checks only executable paths for native vendor wrappers', () => {
  const cc = '/Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs'
  const runs = sideRuns([
    '201 00:01 opencode run -m opencode-go/m "review src/vendor/three"',
    '202 00:02 node /opt/homebrew/bin/codex exec -m gpt "see src/vendor/x"',
    `203 00:03 node ${cc} -p "review src/vendor/three" --model m`,
    `204 00:04 node "${cc}" -p "review src/vendor/three" --model m`,
    '205 00:05 /opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex exec task',
  ].join('\n'))
  expect(runs.map(r => [r.pid, r.provider, r.model])).toEqual([[201, 'opencode', 'opencode-go/m'], [202, 'codex', 'gpt'], [203, 'commandcode', 'm'], [204, 'commandcode', 'm']])
})

test('side runs unwrap shell, timeout, nohup and env wrappers without reading task prose', () => {
  const wrap = (inner: string) => `nohup sh -c '${inner}' > log 2>&1 &`
  const commands = [
    wrap('codex exec -m gpt-6.1-sol "Fix it"'),
    `bash -c 'codex exec -m gpt-6.1-sol "Fix it"'`,
    `zsh -lc 'codex exec -m gpt-6.1-sol "Fix it"'`,
    'timeout 60 codex exec -m gpt-6.1-sol "Fix it"',
    'timeout --signal TERM --kill-after 5 60 env X=1 codex exec -m gpt-6.1-sol "Fix it"',
    'env X=1 nohup codex exec -m gpt-6.1-sol "Fix it"',
  ]
  for (const command of commands) {
    expect(externalOf(command)).toEqual({ provider: 'codex', model: 'gpt-6.1-sol' })
    expect(taskOf(command)).toBe('Fix it')
    const changed = withFlags(command, 'codex', { effort: 'xhigh' })
    expect(externalOf(changed)).toEqual({ provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' })
    expect(taskOf(changed)).toBe('Fix it')
  }
  for (const [inner, provider] of [['opencode run -m p/m "Review it"', 'opencode'], ['command-code --model p/m -p "Review it"', 'commandcode']] as const) {
    expect(externalOf(wrap(inner))).toEqual({ provider, model: 'p/m' })
    expect(taskOf(wrap(inner))).toBe('Review it')
  }
  expect(stdinFileOf(wrap('codex exec - < "prompt.md"'))).toBe('prompt.md')
  for (const command of [
    'echo "codex exec -m fake task"',
    `sh -c 'echo "codex exec -m fake task"'`,
    `timeout 5 env X=1 bash -c 'printf "%s" "codex exec"'`,
    `codex exec -m real "Explain nohup sh -c codex exec -m fake"`,
  ]) expect(sideCommand(command)?.model).not.toBe('fake')
  expect(externalOf(`sh -c 'echo "codex exec"'`)).toBeUndefined()
  const nested = String.raw`nohup bash -c "sh -c 'codex exec -m real \"Fix it\"'" > log 2>&1 &`
  expect(externalOf(withFlags(nested, 'codex', { effort: 'high' }))).toEqual({ provider: 'codex', model: 'real', effort: 'high' })
})

test('usage tail marks local estimates and cache age and leaves fresh cache percentages alone', () => {
  const all: Providers = { claude: blank(), codex: blank(), antigravity: blank(), opencode: { ...blank(), meters: [{ label: '5-hour', percent: 50 }] }, commandcode: { ...blank(), usageAt: 0, meters: [{ label: 'Monthly', percent: 62 }] }, ollama: blank() }
  expect(usageTail(all, defaultRouting(), 3 * 3600000)).toContain('Command Code mo 38% left · 3h old')
  expect(usageTail(all, defaultRouting(), 3600000)).not.toContain('old')
  expect(usageTail(all, defaultRouting(), 3 * 3600000)).toContain('OpenCode 5h ≈50% left')
})


test('detached detection finds single shell ampersands anywhere and ignores quotes and redirections', () => {
  for (const command of ['codex exec "task" &', 'codex exec "task" & echo $!', 'codex exec "task" & disown', 'codex exec "task" & sleep 2; tail log', "sh -c 'codex exec task & echo $!'", 'codex exec task >log 2>&1 & echo done']) expect(detachedCommand(command)).toBe(true)
  for (const command of ['codex exec "a & b"', "codex exec 'a & b'", 'codex exec a && echo done', 'codex exec a >&log', 'codex exec a &>log', 'codex exec a 2>&1', String.raw`codex exec a\&b`, 'codex exec a # &', "codex exec - <<'EOF'\na & b\nEOF"]) expect(detachedCommand(command)).toBe(false)
  expect([...sideMarkers('42 00:01 codex exec task OTHER=ignored AO_RUN=tool:42\n43 00:02 codex exec task OTHER=AO_RUN=tool:43')]).toEqual([[42, 'tool:42']])
})
