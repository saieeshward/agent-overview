import { expect, mock, test } from 'claude-code/testing'
import type { AgentNode, Ui } from '../types'

import { parseAgyModels, parseCmdModels, parseCodex, parseOpencodeVerbose, until } from '../hooks/providers'
import { externalOf, reviewCwd } from '../hooks/register'
import { blank, livePicks, move, normalRouting, providerOf, routingText, withPicks } from '../hooks/state'
import { bar, clock, connector, fit, fitStart, marquee, pickRun, runsOf } from '../hooks/view'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = (bodyColumns: number) => ({
  title: 'Overview', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {},
})

test('review directories follow literal cd and Codex directory flags without a shell', async () => {
  expect(reviewCwd('cd ../other && opencode run "fix"', 'opencode')).toEqual({ cwd: '../other' })
  expect(reviewCwd('cd "/repo with spaces"; codex exec "fix"', 'codex')).toEqual({ cwd: '/repo with spaces' })
  expect(reviewCwd('codex exec -C ../other "fix"', 'codex')).toEqual({ cwd: '../other' })
  expect(reviewCwd("codex --cd '/répo spaces' exec 'fix'", 'codex')).toEqual({ cwd: '/répo spaces' })
  expect(externalOf('codex -C ../other exec "fix"')?.provider).toBe('codex')
  expect(reviewCwd('cd /repo && codex exec --cd src "fix"', 'codex')).toEqual({ cwd: '/repo/src' })
  expect(reviewCwd('codex exec -m gpt --cd=/repo "fix"', 'codex')).toEqual({ cwd: '/repo' })
  expect(reviewCwd('codex exec "prompt mentioning -C /elsewhere"', 'codex')).toEqual({ cwd: undefined })
  for (const dir of ['$REPO', '~/repo', '`pwd`', '"broken', 'a"b"']) {
    expect(reviewCwd(`cd ${dir} && codex exec "fix"`, 'codex')).toBeUndefined()
    expect(reviewCwd(`codex exec -C ${dir} "fix"`, 'codex')).toBeUndefined()
  }
})

test('work handed to other models is recognised', async () => {
  expect(providerOf('claude-sonnet-5-5')).toBe('claude')
  expect(providerOf('gemini-3.8-flash-high')).toBe('antigravity')
  expect(providerOf('gpt-6-astra')).toBe('codex')
  expect(externalOf('opencode run -m opencode-go/kimi-k3 "hi"')).toEqual({ provider: 'opencode', model: 'opencode-go/kimi-k3' })
  expect(externalOf('CC="/Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs"; node "$CC" --model deepseek/deepseek-v4-flash -p hi')).toEqual({ provider: 'commandcode', model: 'deepseek/deepseek-v4-flash' })
  expect(externalOf('codex exec "fix it"')?.provider).toBe('codex')
  expect(externalOf('git status')).toBeUndefined()
})

test('only actual side-provider invocations count', async () => {
  for (const command of [
    'opencode run --help', 'codex exec --help', 'codex --version', 'codex exec -h', 'codex e -V',
    'for b in codex opencode; do $b --help; done',
    'find / -path "*command-code/dist/index.mjs"', 'ls /Applications | grep -i command',
    'ls /Applications/Command\\ Code.app/command-code/dist/index.mjs -p',
    'cat /tmp/command-code/dist/index.mjs -p', 'grep command-code/dist/index.mjs -p',
    'pgrep -fl "codex exec"', "python -c 'print(\"codex exec hi\")'",
    'echo "codex exec -m fake task"', 'cmd --model m', 'command-code --help -p',
    'codex exec --help; echo -m fake', 'echo -p; command-code',
    '# codex exec task',
  ]) expect(externalOf(command)).toBeUndefined()
  for (const marker of ['EOF', "'EOF'", '"EOF"', '-EOF']) {
    expect(externalOf(`cat > spec.md <<${marker}\ncodex exec -m fake "task"\nEOF`)).toBeUndefined()
    expect(externalOf(`python <<${marker}\nprint("codex exec hi")\nEOF`)).toBeUndefined()
  }
  expect(externalOf('cat <<-EOF\n\tcodex exec fake\n\tEOF')).toBeUndefined()
  expect(externalOf('codex exec -m gpt-6.1-sol "fix it"')).toEqual({ provider: 'codex', model: 'gpt-6.1-sol' })
  expect(externalOf('cd x && opencode run -m opencode-go/m "task"')).toEqual({ provider: 'opencode', model: 'opencode-go/m' })
  const cc = '"/Applications/Command Code.app/Contents/Resources/app/node_modules/command-code/dist/index.mjs"'
  expect(externalOf(`node ${cc} -p "task" --model m`)).toEqual({ provider: 'commandcode', model: 'm' })
  expect(externalOf(`${cc} --print "task" --model m`)).toEqual({ provider: 'commandcode', model: 'm' })
  expect(externalOf(`find ${cc} -p`)).toBeUndefined()
  expect(externalOf(`node ${cc} --model m`)).toBeUndefined()
  expect(externalOf('codex exec "task with --help and ; opencode run -m fake" -m "real"')).toEqual({ provider: 'codex', model: 'real' })
  expect(externalOf('codex exec "task"; echo --model fake')).toEqual({ provider: 'codex', model: undefined })
  expect(externalOf('codex exec --help; opencode run -m real task')).toEqual({ provider: 'opencode', model: 'real' })
  expect(externalOf('cat <<EOF\ncodex exec -m fake task\nEOF\ncodex exec -m real task')).toEqual({ provider: 'codex', model: 'real' })
})

test('codex app-server answers become meters and models', async () => {
  const out = [
    JSON.stringify({ id: 0, result: {} }),
    JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 26, windowDurationMins: 10080, resetsAt: 1000 + 86400 }, credits: { balance: '62500.0' }, planType: 'prolite' } } }),
    JSON.stringify({ id: 3, result: { data: [
      { id: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: 'Frontier', isDefault: true, hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{}] },
      { id: 'secret', hidden: true },
    ] } }),
    'not json',
  ].join('\n')
  const got = parseCodex(out, [{ home: 'config', toml: 'model = "gpt-6.1-sol"\n' }], 1000 * 1000)
  expect(got.plan).toBe('prolite')
  expect(got.meters[0]).toEqual({ label: 'Weekly', percent: 26, detail: 'resets in 1d 0h' })
  expect(got.models.map(m => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-astra'])
  expect(got.models[0]?.info).toContain('newer than')
  expect(got.models[0]?.isCurrent).toBe(true)
  expect(got.facts[0]).toBe('62.5K credits')
})

test('model lists from the other CLIs parse', async () => {
  const cmd = parseCmdModels('Available models  ·  85 models\n\nOpen Source\n\ndeepseek/deepseek-v4-flash             fast reasoning (default)\nqwen/qwen3.8-max   long work\n\nDecision models (headless only)\nx/y   hidden one\n')
  expect(cmd).toEqual([
    { id: 'deepseek/deepseek-v4-flash', info: 'Open Source · fast reasoning', isDefault: true },
    { id: 'qwen/qwen3.8-max', info: 'Open Source · long work', isDefault: false },
  ])
  const oc = parseOpencodeVerbose('opencode-go/kimi-k3\n{"name":"Kimi K3","limit":{"context":1048576},"cost":{"input":0.6,"output":2.5},"capabilities":{"reasoning":true,"input":{"image":true}}}\nopencode-go/free\n{"cost":{"input":0,"output":0}}\n')
  expect(oc[0]).toEqual({ id: 'opencode-go/kimi-k3', name: 'Kimi K3', info: '1.0M ctx · $0.6/$2.5 per M · reasoning, vision' })
  expect(oc[1]?.info).toBe('free')
  expect(parseAgyModels('gemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-low     Claude Opus 5.5 (Low)\n')).toEqual([
    { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)' },
    { id: 'claude-opus-5-5-low', name: 'Claude Opus 5.5 (Low)' },
  ])
})

test('meters and times read right', async () => {
  expect(bar(0, 4)).toBe('░░░░')
  expect(bar(50, 4)).toBe('██░░')
  expect(bar(100, 4)).toBe('████')
  expect(bar(150, 4)).toBe('████')
  expect(bar(60, 4).length).toBe(4)
  expect(until(90 * 60000)).toBe('1h 30m')
  expect(until(-5)).toBe('')
})

test('routing text tells the model what is on, off and preferred', async () => {
  const r = normalRouting({ order: ['opencode'], on: { commandcode: false }, models: { antigravity: ['gemini-4-argon-high'] }, agyMode: 'visual', role: 'plan', worker: { provider: 'codex', model: 'gpt-6.1-sol' } })
  expect(r.order).toEqual(['opencode', 'antigravity', 'commandcode', 'codex', 'ollama'])
  const text = routingText(r)
  expect(text).toContain('1. gemini-4-argon-high on Antigravity')
  expect(routingText({ ...r, picks: [] })).toContain('1. OpenCode, 2. Antigravity, 3. Codex')
  expect(text).toContain('Claude plans only')
  expect(routingText({ ...r, role: 'claude' })).toContain('Claude only')
  expect(text).toContain('Turned off, never use: Command Code')
  expect(text).toContain('visual and media checks only')
  expect(text).toContain('gemini-4-argon-high')
  expect(text).not.toContain('Main provider: Codex')
  expect(text).toContain('gemini-4-argon-high on Antigravity (#1), takes most delegated tasks')
  expect(move(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
  expect(move(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
})

test('text fits its column', async () => {
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(fitStart('/a/b/c.ts', 6)).toBe('…/c.ts')
  expect(clock(62000)).toBe('1:02')
  expect(clock(3725000)).toBe('1h02')
})

test('an empty session shows a quiet dashboard, not empty sections', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(60) })
  expect(await ui.find({ type: 'Text', text: /no activity/ })).toBeDefined()
  expect(await ui.find({ key: 'fold:usage' })).toBeDefined()
  await ui.press({ key: 'fold:usage' })
  expect(await ui.find({ type: 'Text', text: /limits appear/ })).toBeUndefined()
  await ui.press({ key: 'tab:activity' })
  expect(await ui.find({ type: 'Text', text: /no answers/ })).toBeDefined()
  await ui.unmount()
})

test('models tab switches role, provider order and opens a provider', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(110) })
  await ui.press({ key: 'tab:models' })
  for (const l of ['low', 'medium', 'high', 'xhigh', 'max']) expect(await ui.find({ key: `effort:${l}` })).toBeDefined()
  await ui.press({ key: 'on:commandcode' })
  expect(await ui.find({ type: 'Text', text: /3 on/ })).toBeDefined()
  await ui.press({ key: 'useOrder' })
  expect(await ui.find({ key: 'pup:codex' })).toBeDefined()
  await ui.press({ key: 'seg:CLAUDE:claude' })
  expect(await ui.find({ type: 'Text', text: /paused · Claude only/ })).toBeDefined()
  await ui.press({ key: 'seg:CLAUDE:plan' })
  expect(await ui.find({ key: 'main:clear' })).toBeUndefined()
  await ui.press({ key: 'open:antigravity' })
  expect(await ui.find({ key: 'agy:visual' })).toBeDefined()
  expect(await ui.find({ key: 'agy:coding' })).toBeDefined()
  expect(await ui.find({ key: 'tag:antigravity' })).toBeDefined()
  await ui.press({ key: 'edit:back' })
  expect(await ui.find({ key: 'open:codex' })).toBeDefined()
  await ui.unmount()
})

test('agents draw as a tree and open a detail inside the panel', async ($, on) => {
  mock.clock(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  const spawn = (description: string, extra: object = {}) =>
    ($.agent as any).spawn({ tool_use_id: `t${description.length}`, prompt: description, description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false, ...extra })
  await spawn('Build: redesign the panel')
  await spawn('Build: header and tabs', { parentAgentId: 'a1' })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(60) })
  expect(await ui.find({ type: 'Text', text: /Build/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /redesign the panel/ })).toBeDefined()
  expect(await ui.find({ key: 'fold:stage:tag:build' })).toBeDefined()
  expect(await ui.find({ key: 'fold:graph' })).toBeDefined()
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ type: 'Text', text: /main · / })).toBeDefined()
  await ui.press({ key: 'chip:list' })
  const row = (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('node:')) as any
  expect(row).toBeDefined()
  await ui.press({ key: row.key ?? row.props?.key })
  expect(await ui.find({ key: 'detail:back' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PROMPT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CHILDREN/ })).toBeDefined()
  await ui.press({ key: 'detail:back' })
  expect(await ui.find({ key: 'chip:graph' })).toBeDefined()
  await ui.press({ key: 'chip:history' })
  expect(await ui.find({ type: 'Text', text: /no activity/ })).toBeDefined()
  await ui.unmount()
})

test('Agents → History shows only this session\'s finished agents, never another session\'s or legacy items', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'chat' }))
  on('state.get', { plugin: 'agent-overview', key: 'history' }, () => ({ value: { value: { since: 0, items: [
    { label: 'theirs', at: 3000, ms: 5000, model: 'gpt', state: 'done', session: 'other-chat' },
    { label: 'mine', at: 2000, ms: 10000, model: 'claude', state: 'done', session: 'chat' },
    { label: 'legacy', at: 1000, ms: 5000, model: 'claude', state: 'done' },
  ] }, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(60) })
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'chip:history' })
  expect(await ui.find({ type: 'Text', text: /mine/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /theirs/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /legacy/ })).toBeUndefined()
  await ui.unmount()
})

test('agent spawns retain up to 20000 prompt characters', async ($, on) => {
  mock.clock(on)
  let nodes: AgentNode[] = []
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'prompt-agent' }))
  on('state.set', { plugin: 'agent-overview', key: 'nodes' }, (_$, e, next) => { nodes = e.value; return next(e) })
  const prompt = 'Full prompt\n' + 'x'.repeat(21000)
  await ($.agent as any).spawn({ tool_use_id: 'prompt-tool', prompt, description: 'Long prompt', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  expect(nodes[0]?.input).toBe(prompt.slice(0, 20000))
})

test('agent prompts expand from 14 wrapped lines up to 400', async ($, on) => {
  mock.clock(on)
  const prompt = Array.from({ length: 20 }, (_, i) => `Prompt line ${i + 1}: ${'x'.repeat(20)}`).join('\n')
  let input = prompt
  let kind = 'general-purpose'
  const id = 'prompt-agent'
  on('state.get', { plugin: 'agent-overview', key: 'nodes' }, () => ({ value: { value: [{ id, label: 'Long prompt', model: 'claude', state: 'done', steps: 0, input, kind }], version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'ui' }, async (_$, e, next) => {
    const result = await next(e)
    return { value: { ...result.value!, value: { ...(result.value!.value as Ui), tab: 'agents', detail: id } } }
  })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(120) })
  expect(await ui.findAll({ type: 'Text', text: /^Prompt line / })).toHaveLength(14)
  expect(await ui.find({ type: 'Text', text: /^Prompt line 15:/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '▸ show all (20 lines)' }), 'show all button').toBeDefined()
  await ui.press({ key: `fold:prompt:${id}` })
  expect(await ui.find({ type: 'Text', text: /^Prompt line 20:/ }), 'expanded line 20').toBeDefined()
  input = Array.from({ length: 410 }, (_, i) => `Line ${i}`).join('\n')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Line 399' }), 'expanded line 400').toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Line 400' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '+10 more lines' }), 'overflow count').toBeDefined()
  await ui.press({ key: `fold:prompt:${id}` })
  expect(await ui.find({ type: 'Text', text: 'Line 14' })).toBeUndefined()
  input = 'z'.repeat(1100)
  await ui.redraw()
  expect(await ui.findAll({ type: 'Text', text: /^z+$/ })).toHaveLength(14)
  await ui.press({ key: `fold:prompt:${id}` })
  expect((await ui.findAll({ type: 'Text', text: /^z+$/ })).map(e => e.text).join('')).toBe(input)
  kind = 'workflow'
  input = 'Workflow description'
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: input }), 'workflow description').toBeDefined()
  input = ''
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'PROMPT' })).toBeUndefined()
  await ui.unmount()
})

test('the model mix spans providers and old settings migrate', async () => {
  const old = normalRouting({ agyMode: 'coding', models: { codex: ['gpt-6.1-sol'], antigravity: ['gemini-4-argon-high'] } })
  expect(old.agyVisual && old.agyCoding).toBe(true)
  expect(old.picks.map(x => x.model)).toEqual(['gemini-4-argon-high', 'gpt-6.1-sol'])
  const r = withPicks({ ...old, on: { ...old.on, codex: false } }, [
    { provider: 'codex', model: 'gpt-6.1-sol' },
    { provider: 'antigravity', model: 'gemini-4-argon-high' },
    { provider: 'opencode', model: 'opencode-go/kimi-k3' },
  ])
  expect(r.models.opencode).toEqual(['opencode-go/kimi-k3'])
  expect(livePicks(r).map(x => x.provider)).toEqual(['antigravity', 'opencode'])
  const text = routingText(r)
  expect(text).toContain('gemini-4-argon-high on Antigravity')
  expect(text).toContain('coding: gemini_bounded_task with model "gemini-4-argon-high"')
  expect(text).toContain('visual checks: gemini_visual_qa (and gemini_media_task) with model "gemini-3.8-flash-high"')
  expect(routingText(r)).toContain('1. gemini-4-argon-high on Antigravity, 2. opencode-go/kimi-k3 on OpenCode')
  expect(routingText(r)).toContain('Allowed models, smartest first')
  const noted = normalRouting({ ...r, picks: [{ ...r.picks[1]!, note: '  UI and screenshots  ' }, r.picks[2]!] })
  expect(noted.picks[0]!.note).toBe('UI and screenshots')
  expect(routingText(noted)).toContain('1. gemini-4-argon-high on Antigravity (note: UI and screenshots), 2.')
  expect(routingText(noted)).toContain("owner's guidance")
})

test('activity shows a file change as before and after', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  await ($.tool as any).call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/x/hooks/view.tsx', old_string: 'keep\nold line', new_string: 'keep\nnew line\nanother' })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(110) })
  await ui.press({ key: 'tab:activity' })
  expect(await ui.find({ key: 'file:/x/hooks/view.tsx' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /BEFORE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /AFTER/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 changed · 3 lines/ })).toBeDefined()
  await ui.unmount()
})

test('the main chat counts as running while Claude replies', async ($, on) => {
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await ($.turn as any).start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(110) })
  expect(await ui.find({ type: 'Text', text: /^◆ Claude 0:00/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Claude is working/ })).toBeDefined()
  expect(await ui.find({ key: 'decisions' })).toBeUndefined()
  expect(await ui.find({ key: 'models' })).toBeUndefined()
  await ui.unmount()
})

test('the headline prioritizes live work, fits its width and finds the newest finished run', async ($, on) => {
  mock.clock(on, { now: 65000 })
  let working = true
  on('state.get', { plugin: 'agent-overview', key: 'main' }, () => ({ value: { value: { model: 'claude', working, since: 5000, trail: [{ tool: 'Read', at: 60000 }] }, version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'nodes' }, () => ({ value: { value: [
    { id: 'side', label: 'side task', model: 'gpt', provider: 'codex', kind: 'Codex', state: working ? 'running' : 'done', steps: 0, startedAt: 5000, endedAt: working ? undefined : 55000 },
    { id: 'child', label: 'child task', model: 'claude', kind: 'general-purpose', state: working ? 'running' : 'done', steps: 0, startedAt: 5000, endedAt: working ? undefined : 50000 },
  ], version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'sideLive' }, () => ({ value: { value: { id: 'side', files: [{ path: 'a', added: 1, removed: 0, isNew: true }], at: 60000 }, version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'edits' }, () => ({ value: { value: [{ file: 'a', lines: ['new'], review: 'pending' }], version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'providers' }, () => ({ value: { value: {
    claude: { ...blank(), meters: [{ label: 'Context', percent: 85 }] }, codex: blank(), opencode: blank(), commandcode: blank(), antigravity: blank(),
  }, version: 1 } }))
  on('state.get', { plugin: 'agent-overview', key: 'history' }, () => ({ value: { value: { since: 0, items: [{ label: 'older', at: 1000, ms: 10000, model: 'gpt', state: 'done' }] }, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(220) })
  expect((await ui.find({ type: 'Text', text: /^◆ Claude 1:00/ }))?.text).toBe('◆ Claude 1:00 · Read · ● gpt 1:00 · 1 file changed · 1 subagent · ◆ 1 to review · context 85%')
  await ui.redraw(props(60))
  expect((await ui.find({ type: 'Text', text: /^◆ Claude 1:00/ }))?.text.length).toBe(60)
  working = false
  await ui.redraw(props(220))
  expect((await ui.find({ type: 'Text', text: /^✓ idle/ }))?.text).toBe('✓ idle · last: side task 10s ago · ◆ 1 to review · context 85%')
  await ui.unmount()
})

test('stages follow the live run; finished runs move to earlier runs', async () => {
  const n = (id: string, run: string, state: 'running' | 'done', startedAt: number, extra: object = {}) => ({ id, label: id, kind: 'general-purpose', model: 'm', state, steps: 0, startedAt, endedAt: state === 'done' ? startedAt + 5 : undefined, run, ...extra })
  const runs = runsOf([
    n('wf:1', 'wf:1', 'done', 0, { kind: 'workflow', label: 'design-panel' }),
    n('judge', 'wf:1', 'done', 1, { parentNode: 'wf:1' }),
    n('scout-a', 'wf:2', 'running', 50),
  ] as any, 100)
  expect(runs.map(r => [r.id, r.running, r.label])).toEqual([['wf:2', true, 'scout-a'], ['wf:1', false, 'design-panel']])
  const done = runs.slice(1)
  // A new turn with no agents shows none of the old run; between turns the last run stays.
  expect(pickRun(done, { model: 'm', working: true, since: 60 })).toBeUndefined()
  expect(pickRun(done, { model: 'm' })?.id).toBe('wf:1')
  expect(pickRun(done, { model: 'm', working: true, since: 60 }, 'wf:1')?.id).toBe('wf:1')
})

test('a long decision scrolls like a ticker; a short one stays put', async () => {
  expect(marquee('short', 10, 0)).toBe('short')
  expect(marquee('abcdefghijkl', 5, 0)).toBe('abcde')
  expect(marquee('abcdefghijkl', 5, 350 * 8)).toBe('cdefg')
})

test('graph connectors land on box centres', async () => {
  expect(connector(2, 6, 1, false)).toBe(' ├────┬──────┐')
  expect(connector(1, 6, 1, true)).toBe(' ╰────╮')
  expect(connector(1, 6, 1, true, 3)).toBe('    ╰────╮')
})

test('the dashboard graph draws boxes for the live run', async ($, on) => {
  mock.clock(on)
  let k = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `g${++k}` }))
  const spawn = (description: string, extra: object = {}) =>
    ($.agent as any).spawn({ tool_use_id: `w${description.length}`, prompt: description, description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false, ...extra })
  await spawn('Scout: map the code')
  await spawn('Build: the header', { parentAgentId: 'g1' })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(120) })
  expect(await ui.find({ key: 'fold:graph' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /main · / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /map the code/ })).toBeDefined()
  await ui.unmount()
})


test('LIVE follows Bash activity and the main chip keeps it selected', async ($, on) => {
  const time = mock.clock(on)
  on('tool.call', () => ({ result: 'first\n\nlast' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'live-agent' }))
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'live-bash', command: 'echo hello' })
  await ($.agent as any).spawn({ tool_use_id: 'watch-agent', prompt: 'Look around', description: 'Scout', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props: props(120) })
  expect(await ui.find({ key: 'fold:live' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$ echo hello' })).toBeDefined()
  await ui.press({ key: 'watch:main' })
  await time.advance(1)
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'agent-bash', agentId: 'live-agent', command: 'echo scout' })
  expect(await ui.find({ type: 'Text', text: '$ echo hello' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'last' })).toBeDefined()
  await ui.press({ key: 'watch:follow' })
  expect(await ui.find({ type: 'Text', text: '$ echo scout' })).toBeDefined()
  await ui.press({ key: 'gopen:main' })
  expect(await ui.find({ type: 'Text', text: '$ echo hello' })).toBeDefined()
  const box = (await ui.findAll({ type: 'Button' })).find(x => String(x.key ?? x.props.key).startsWith('gopen:') && x.text.includes('Scout'))!
  await ui.press({ key: String(box.key ?? box.props.key) })
  expect(await ui.find({ type: 'Text', text: '$ echo scout' })).toBeDefined()
  expect(await ui.find({ key: 'detail:back' })).toBeUndefined()
  await ui.press({ key: 'watch:details' })
  expect(await ui.find({ key: 'detail:back' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$ echo scout' })).toBeDefined()
  await ui.press({ key: 'detail:back' })
  await ui.press({ key: String(box.key ?? box.props.key) })
  expect(await ui.find({ key: 'detail:back' })).toBeDefined()
  await ui.unmount()
})

test('reviewCwd unwraps shell, nohup, timeout and env while preserving literal directory changes', () => {
  for (const [provider, cli] of [['codex', 'codex exec -C src fix'], ['opencode', 'opencode run fix'], ['commandcode', 'cmd -p fix']] as const) {
    const expected = provider === 'codex' ? '/repo/src' : '/repo'
    for (const shell of ['sh', 'bash', 'zsh']) expect(reviewCwd(`cd /repo && nohup timeout 90 env X=yes ${shell} -c '${cli}' > log 2>&1 &`, provider)).toEqual({ cwd: expected })
    expect(reviewCwd(`nohup sh -c 'cd /repo && ${cli}' > log 2>&1 &`, provider)).toEqual({ cwd: expected })
  }
  expect(reviewCwd("nohup sh -c 'cd $REPO && codex exec fix' &", 'codex')).toBeUndefined()
})

for (const surface of ['terminal', 'desktop'] as const) test(`History waits until an agent leaves the graph and dashboard last finished stays per session (${surface})`, async ($, on) => {
  mock.clock(on, { now: 100000 }); mock.store(on)
  on('session.id', () => ({ value: 'chat' }))
  let nodes: AgentNode[] = [{ id: 'done', label: 'Mine finished', kind: 'Codex', model: 'gpt', provider: 'codex', state: 'done', steps: 1, startedAt: 1000, endedAt: 90000 }]
  on('state.get', { plugin: 'agent-overview', key: 'nodes' }, () => ({ value: { value: nodes, version: 0 } }))
  on('state.get', { plugin: 'agent-overview', key: 'history' }, () => ({ value: { value: { since: 0, items: [
    { label: 'Other finished', at: 95000, ms: 3000, model: 'gpt', state: 'done', session: 'other' },
    { label: 'Mine finished', at: 1000, ms: 89000, model: 'gpt', state: 'done', session: 'chat' },
  ] }, version: 0 } }))
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props: props(110) })
  expect(await ui.find({ type: 'Text', text: /last: Mine finished/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /last: Other finished/ })).toBeUndefined()
  await ui.press({ key: 'tab:agents' }); await ui.press({ key: 'chip:history' })
  expect(await ui.find({ type: 'Text', text: /Mine finished/ })).toBeUndefined()
  nodes = []; await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Mine finished/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Other finished/ })).toBeUndefined()
  await ui.press({ key: 'tab:dashboard' })
  expect(await ui.find({ type: 'Text', text: /last: Mine finished/ })).toBeDefined()
  await ui.unmount()
})
