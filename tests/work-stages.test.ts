import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PluginState } from 'claude-code'
import type { EditItem, Finding, GrillItem, Impl, Mode, ReviewProfile, Routing, Stage, Ui } from '../types'
import { blank, defaultRouting, normalGuard } from '../hooks/state'
import { PLAN_LOCK, SEED_PROFILES, STAGES, DEFAULT_PROFILE, advance, adrOf, commitPreview, commitPrompt, findingKey, fixPrompt, freshStage, stageDeny, agentBlock, reviewerBlock, runBusy, implAgents, implementPrompt, mergeFinding, normalProfiles, planCounts, taskQa, planLockDeny, prPrompt, pushPrompt, reviewPrompt, workText, writesFiles } from '../hooks/work/stage'
import { skillMode } from '../hooks/toggles'

function held<T>(on: On, key: keyof PluginState['agent-overview'], initial: T) {
  let value = initial, writes = 0
  const hook = on as any
  hook('state.get', { plugin: 'agent-overview', key }, async (_$: unknown, e: any, next: any) => {
    const result = await next(e)
    return { value: { ...result.value, value } } as any
  })
  hook('state.set', { plugin: 'agent-overview', key }, async (_$: unknown, e: any, next: any) => {
    const result = await next(e)
    if (result.value?.isSet) { value = e.value as T; writes++ }
    return result
  })
  return { get: () => value, writes: () => writes, set: (next: T) => { value = next } }
}
const props = (bodyColumns = 110) => ({ title: 'Overview', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} })
const mount = ($: Engine, surface: 'terminal' | 'desktop', width = 110) => $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: props(width) })
function setup(on: On, failSubmit: boolean | 'drop' = false, withClock = true) {
  if (withClock) mock.clock(on, { now: 10000 })
  mock.store(on)
  on('session.id', () => ({ value: 'work-test' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('process.run', () => ({ value: { stdout: 'abc123\n', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  const sent: string[] = []
  on('prompt.submit', (_$, e) => { if (failSubmit === 'drop') return { drop: 'queue refused this prompt' }; if (failSubmit) throw new Error('offline'); sent.push(e.text); return { text: e.text } })
  return sent
}
const picks: Routing['picks'] = [
  { provider: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  { provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' },
  { provider: 'opencode', model: 'opencode-go/deepseek-v4-pro', effort: 'max' },
]
const route = (): Routing => ({ ...defaultRouting(), picks, order: ['opencode', 'codex', 'claude'], tags: { codex: 'main', claude: 'saver' } })
const finding: Finding = { file: 'hooks/a.ts', line: 12, severity: 'medium', text: 'Handle a missing value', by: ['gpt-6.1-sol'], at: 100 }
const reviewStage = (): Stage => ({ ...freshStage(), at: 'review', reached: ['plan', 'implement', 'review'], since: 'abc123' })

test('writesFiles recognizes file writers only at command positions and preserves read-only commands', () => {
  for (const command of [
    ...['python', 'python3', 'node', 'ruby', 'perl', 'php', 'deno', 'bun'].flatMap(p => [`${p} -c 'open("a","w")'`, `${p} -e 'write()'`, `${p} eval 'write()'`, `${p} -i input`]),
    "sh -c 'touch file'", "bash -c 'python3 -c \"write()\"'", "zsh -lc 'echo hi > file'",
    'echo x > f', 'echo x >> "a b"', 'rm f', 'rmdir dir', 'mv a b', 'cp a b', 'mkdir x', 'touch x', 'ln a b', 'chmod +x f', 'chown user f', 'tee f', 'truncate -s 0 f', 'dd if=a of=b', 'install a b', 'patch -p1', 'rsync a b', 'unzip f', 'tar -xf a.tar', 'tar xf a.tar',
    'sed -i s/a/b/ f', "perl -pi -e 's/a/b/' f", 'git add f', 'git -C repo commit -m x', 'git checkout main', 'git switch main', 'git reset --hard', 'git restore f', 'git apply f', 'git am f', 'git merge branch', 'git rebase main', 'git cherry-pick abc', 'git revert abc', 'git stash', 'git push', 'git pull', 'git clean -fd', 'git rm f', 'git mv a b', 'git tag v1', 'git worktree add x',
    'npm install', 'pnpm i', 'yarn add pkg', 'bun remove pkg', 'npm ci', 'pnpm update', 'pip install pkg', 'ls; rm f', 'ls && cp a b', 'false || touch a', 'cat f | tee g', '(mkdir dir)', 'echo $(touch f)', 'sudo rm f', 'sudo -n rm f', 'sudo -E touch f', 'xargs -n 1 rm', 'echo "$(touch f)"', 'sudo -u user cp a b', 'find . | xargs rm', 'env FOO=bar touch f', 'FOO="hello world" touch f', 'FOO="$(touch f)" echo ok', 'FOO=bar mkdir dir', 'find . -delete', 'codex exec "implement this"', 'opencode run -m p/m "task"',
  ]) expect(writesFiles(command)).toBe(true)
  for (const command of [
    "sh -c 'git status'", "bash -c 'echo codex exec'", "zsh -c 'cat file'", "echo 'python3 -c write()'",
    'ls -la', 'cat f', 'grep rm f', 'git status', 'git log --oneline', 'git diff', 'git show HEAD', 'rg touch .', 'find . -name x', "sed -n '1,20p' f", 'cat f 2>&1', 'ls >/dev/null', 'echo x >> /dev/null', 'echo x >&2', 'echo "rm f"', 'echo "x > f"', 'echo cp a b', 'git status && cat f', 'tar -tf a.tar', 'codex exec -s read-only "inspect this"',
  ]) expect(writesFiles(command)).toBe(false)
})

test('stage transitions, lock conditions and Plan prompt text', () => {
  expect(STAGES).toEqual(['plan', 'implement', 'review', 'ship'])
  expect(freshStage(123)).toEqual({ at: 'plan', reached: ['plan'], round: 1, startedAt: 123, seen: ['plan'] })
  const s = advance({ ...freshStage(), adr: 'docs/adr/0003-work-stages.md', since: 'head' }, 'implement')
  expect(s).toEqual({ startedAt: 0, seen: ['plan'], at: 'implement', reached: ['plan', 'implement'], round: 1, adr: 'docs/adr/0003-work-stages.md', since: 'head' })
  expect(advance(advance(s, 'review'), 'implement', { round: 2 })).toMatchObject({ at: 'implement', reached: ['plan', 'implement', 'review'], round: 2 })
  expect(advance(null, 'implement').reached).toEqual(['plan', 'implement'])
  expect(planLockDeny({ ...freshStage() }, { tool: 'Write' })).toBe(PLAN_LOCK)
  expect(planLockDeny(null, { tool: 'Write' })).toBeUndefined()
  expect(planLockDeny({ ...s }, { tool: 'Write' })).toBeUndefined()
  expect(workText('work', null, { grill: true })).toContain('supermatt:grilling')
  expect(workText('work', freshStage(), { grill: false })).toContain('No code changes')
  expect(workText('work', freshStage(), { grill: false })).not.toContain('supermatt:grilling')
  expect(workText('overview', freshStage(), { grill: true })).toBe('')
  expect(workText('vibe', freshStage(), { grill: true })).toContain('No stages, no grilling')
  expect(workText('work', s, { grill: true })).toContain('stage: Implement')
})

test('review profiles normalize persisted data and findings merge without losing the original text or dismissal', () => {
  expect(DEFAULT_PROFILE).toBe('deep')
  for (const data of [undefined, null, {}, [], [null], [{ id: 'x', name: 'X', reviewers: null }]]) expect(normalProfiles(data)).toEqual(SEED_PROFILES)
  expect(SEED_PROFILES.map(p => [p.id, p.name, p.reviewers.length])).toEqual([['quick', 'Quick', 1], ['deep', 'Deep', 3], ['ship', 'Ship gate', 3]])
  expect(normalProfiles([{ id: 'x', name: 'X', reviewers: [{ provider: 'bad', model: 'x' }, { provider: 'codex', model: 'sol', effort: 3, focus: false }] }])).toEqual([{ id: 'x', name: 'X', instructions: '', reviewers: [{ provider: 'codex', model: 'sol', effort: undefined, focus: '' }] }])
  let list = mergeFinding([], { ...finding, file: ' hooks/a.ts ', by: 'one' }, 10)
  list = mergeFinding(list, { ...finding, severity: 'high', text: 'new text', by: 'two' }, 20)
  list = mergeFinding(list, { ...finding, by: 'two' }, 30)
  expect(list).toEqual([{ ...finding, severity: 'high', by: ['one', 'two'], at: 10 }])
  list = mergeFinding([{ ...list[0]!, dismissed: true }], { ...finding, by: 'three' }, 40)
  expect(list[0]!.dismissed).toBe(true)
  expect(list[0]!.by.length).toBe(3)
  expect(mergeFinding(list, { ...finding, line: 13, by: 'one' }, 50).length).toBe(2)
  expect(mergeFinding(list, { file: ' ' }, 60)).toBe(list)
  expect(mergeFinding(list, { file: 3 }, 60)).toBe(list)
  expect(mergeFinding([], { file: 'f', line: -1, severity: 'bad', text: 2 }, 70)).toEqual([{ file: 'f', line: undefined, severity: 'low', text: '', by: ['reviewer'], at: 70 }])
  expect(mergeFinding(Array.from({ length: 200 }, (_, i) => ({ ...finding, file: `${i}` })), { file: 'new' }, 80).length).toBe(200)
  expect(findingKey({ file: 'f' })).toBe('f:')
})

test('implementation agents follow tags and provider order and preserve explicit choices as picks change', () => {
  const r = route()
  expect(implAgents(r, { agents: [] }).map(a => a.provider)).toEqual(['codex', 'opencode', 'claude'])
  expect(implAgents({ ...r, tags: {}, useOrder: false }, { agents: [] }).map(a => a.provider)).toEqual(['claude', 'codex', 'opencode'])
  const agents = implAgents(r, { agents: [{ provider: 'opencode', model: picks[2]!.model, effort: 'old', on: true }, { provider: 'codex', model: 'gone', on: true }, { provider: 'claude', model: picks[0]!.model, on: false }] })
  expect(agents.map(a => [a.provider, a.effort, a.on])).toEqual([['opencode', 'max', true], ['claude', 'high', false], ['codex', 'xhigh', false]])
  expect(implAgents({ ...r, on: { ...r.on, codex: false } }, { agents: [] }).some(a => a.provider === 'codex')).toBe(false)
})

test('plan counts, ADR lookup and all launch and shipping prompts carry the required context', () => {
  const qa: GrillItem[] = [{ question: 'Work stages', answer: 'Use stages.' }, ...['', 'Later', 'TBD', 'Unsure', 'Not sure yet', "Don't know", 'Maybe?'].map(answer => ({ question: 'Open', answer })), { question: 'Rule', answer: 'Keep it small.', kind: 'instruction' }]
  expect(planCounts(qa)).toEqual({ answers: 1, open: 7 })
  const edits: EditItem[] = [{ file: 'docs/adr/0001-old.md', lines: [], at: 1 }, { file: 'docs/decisions/0003-work-stages.md', lines: [], at: 3 }, { file: 'other.md', lines: [], at: 4 }]
  expect(adrOf(null, edits)).toBe(edits[1]!.file)
  expect(adrOf({ ...freshStage(), adr: 'chosen.md' }, edits)).toBe('chosen.md')
  expect(adrOf(null, [])).toBeUndefined()
  expect(commitPreview([], 'docs/adr/0003-work-stages.md')).toBe('Work stages\n\n')
  expect(commitPreview([], 'docs/adr/0003-work-stages.md', 'Keep Work read-only until Implement')).toBe('Keep Work read-only until Implement\n\n')
  expect(commitPreview([...edits, edits[0]!], undefined)).toBe('message written from the diff\n\n- docs/adr/0001-old.md\n- docs/decisions/0003-work-stages.md\n- other.md')
  expect(commitPreview([], undefined)).toBe('message written from the diff\n\n')
  const agents = implAgents(route(), { agents: [] })
  const implementation = implementPrompt(agents, undefined, qa)
  for (const text of ['- Work stages: Use stages.', '1. gpt-6.1-sol (xhigh) on Codex', 'next only if it fails', 'Do not commit.']) expect(implementation).toContain(text)
  expect(implementPrompt(agents, 'plan.md', qa)).toContain('in plan.md')
  expect(implementPrompt(agents, 'plan.md', qa)).toContain('- Work stages: Use stages.')
  const review = reviewPrompt(SEED_PROFILES[1]!, 'abc123', 'Watch races', 'plan.md')
  for (const text of ['git diff abc123', 'git status --porcelain', 'git diff --no-index /dev/null <file>', 'Give every reviewer these new files', 'uncommitted changes', 'parallel', 'logic, edge cases, races', 'Agent tool', 'plan.md', 'Watch races', 'mcp__agent-overview__review_log', 'Do not fix']) expect(review).toContain(text)
  expect(reviewPrompt(SEED_PROFILES[0]!, undefined, undefined, undefined)).toContain('git diff HEAD')
  const fix = fixPrompt([finding], 2, agents)
  for (const text of ['round 2', '[medium] hooks/a.ts:12', 'Handle a missing value', 'by gpt-6.1-sol', 'priority order', 'Do not commit']) expect(fix).toContain(text)
  expect(commitPrompt('abc123', 'Preview')).toContain('Stop and report if checks fail')
  expect(commitPrompt(undefined, 'Preview')).toContain('since HEAD')
  expect(pushPrompt()).toContain('wait for their yes')
  expect(prPrompt()).toContain('wait for their yes')
})

test('Plan lock denies writing tools and commands and allows reads inside Work', async ($, on) => {
  setup(on)
  const stage = held(on, 'stage', { ...freshStage() })
  held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work' })
  on('tool.call', () => ({ result: 'ok' }))
  let i = 0
  const call = (tool: string, command?: string) => ($.tool as any).call({ tool, tool_use_id: `lock${i++}`, command })
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) expect((await call(tool)).deny).toBe(PLAN_LOCK)
  expect((await call('Bash', 'echo x > f.txt')).deny).toBe(PLAN_LOCK)
  for (const tool of ['Read', 'Grep']) expect((await call(tool)).deny).toBeUndefined()
  expect((await call('Bash', 'git status')).deny).toBeUndefined()
  stage.set(freshStage())
  expect((await call('Edit')).deny).toBe(PLAN_LOCK)
  stage.set({ ...freshStage(), at: 'implement' })
  expect((await call('Edit')).deny).toBeUndefined()
})

test('Work prompt composition follows the area, stage and docs switch', async ($, on) => {
  setup(on)
  const state = held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work' })
  const guard = held(on, 'guard', normalGuard(undefined))
  const stage = held<Stage | null>(on, 'stage', freshStage())
  on('prompt.compose', () => ({ sections: [] }))
  const text = async () => (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })).sections.find(s => s.id === 'agent-overview:work')?.text
  expect(await text()).toContain('qa_log')
  expect(await text()).toContain('supermatt:grilling')
  guard.set(normalGuard({ work: { grill: false } }))
  expect(await text()).not.toContain('supermatt:grilling')
  state.set({ ...state.get(), area: 'overview' })
  expect(await text()).toBeUndefined()
  state.set({ ...state.get(), area: 'work' })
  stage.set(advance(freshStage(), 'implement'))
  expect(await text()).toContain('stage: Implement')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Ponytail restores forced and absent owner settings when leaving Work or switching on (${surface})`, async ($, on) => {
    setup(on)
    const toggles = held<Record<string, Mode>>(on, 'toggles', { 'plugin:ponytail': 'force' })
    held(on, 'guard', normalGuard({ work: { ponytail: false } }))
    const ui = await mount($, surface)
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(toggles.get()['plugin:ponytail']).toBe('off')
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    await ui.press({ key: 'area:overview' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(toggles.get()['plugin:ponytail']).toBe('force')
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    await ui.press({ key: 'wtab:settings' })
    await ui.press({ key: 'wset:ponytail:on' })
    expect(toggles.get()['plugin:ponytail']).toBe('on')
    await ui.press({ key: 'wset:ponytail:off' })
    expect(toggles.get()['plugin:ponytail']).toBe('off')
    await ui.press({ key: 'area:vibe' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    expect(toggles.get()).toEqual({ 'plugin:ponytail': 'force' })
    await ui.unmount()
  })

  test(`complete Plan to Implement to Review, findings loop and ship flow (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held<Stage | null>(on, 'stage', null)
    const impl = held<Impl>(on, 'impl', { agents: [] })
    const findings = held<Finding[]>(on, 'findings', [])
    held(on, 'routing', route())
    held<GrillItem[]>(on, 'grill', [{ question: 'Work stages', answer: 'Keep the plan and review visible.', at: 10000 }])
    const ui = await mount($, surface)
    await ui.press({ key: 'area:work' }); if (await ui.find({ key: 'area:confirm' })) await ui.press({ key: 'area:confirm' })
    await ui.press({ key: 'wtab:plan' })
    expect(await ui.find({ key: 'plan:lock' })).toBeUndefined()
    expect(await ui.find({ key: 'plan:q:0' })).toBeDefined()
    await ui.press({ key: 'plan:advance' })
    expect(stage.get()).toEqual({ at: 'implement', reached: ['plan', 'implement'], round: 1, since: 'abc123', startedAt: 10000, seen: ['plan', 'implement'] })
    expect(sent[0]).toContain('ADR')
    expect(await ui.find({ key: 'wtab:implement' })).toBeDefined()
    await ui.press({ key: 'impl:on:2' })
    await ui.press({ key: 'impl:up:1' })
    expect(impl.get().agents.map(a => [a.provider, a.on])).toEqual([['opencode', true], ['codex', true], ['claude', false]])
    await ui.press({ key: 'impl:launch' })
    expect(sent[1]).toContain('1. opencode-go/deepseek-v4-pro (max) on OpenCode')
    expect(sent[1]).toContain('2. gpt-6.1-sol (xhigh) on Codex')
    expect(impl.get().launchedAt).toBe(10000)
    await ui.press({ key: 'impl:review' })
    expect(stage.get()?.at).toBe('review')
    expect(await ui.find({ key: 'review:ship' })).toBeDefined()
    await ui.press({ key: 'rev:launch' })
    expect(sent[2]).toContain('git diff abc123')
    await ($.tool as any).call({ tool: 'mcp__agent-overview__review_log', tool_use_id: 'one', ...finding, by: 'gpt-6.1-sol' })
    await ($.tool as any).call({ tool: 'mcp__agent-overview__review_log', tool_use_id: 'two', ...finding, severity: 'high', by: 'claude-opus-5-5' })
    expect(findings.get().length).toBe(1)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: '●●' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /by gpt-6.1-sol, claude-opus-5-5/ })).toBeDefined()
    await ui.press({ key: `find:${findingKey(finding)}` })
    await ui.press({ key: 'find:fix' })
    expect(stage.get()).toMatchObject({ at: 'implement', round: 2, reached: ['plan', 'implement', 'review'] })
    expect(sent[sent.length - 1]).toContain('Handle a missing value')
    await ui.press({ key: 'impl:review' })
    await ui.press({ key: `find:${findingKey(finding)}` })
    await ui.press({ key: 'find:dismiss' })
    expect(findings.get()[0]!.dismissed).toBe(true)
    expect(await ui.find({ key: 'ship:push' })).toBeUndefined()
    expect(await ui.find({ key: 'ship:pr' })).toBeUndefined()
    await ui.press({ key: 'ship:commit' })
    expect(stage.get()?.at).toBe('ship')
    expect(sent[sent.length - 1]).toContain('commit the work since abc123')
    await ui.press({ key: 'wtab:plan' })
    expect(await ui.find({ type: 'Text', text: 'read-only · the work is at SHIP' })).toBeDefined()
    expect(await ui.find({ key: 'plan:advance' })).toBeUndefined()
    expect((await ui.find({ key: 'wtab:review' }))?.text).not.toContain('◆')
    await ui.unmount()
  })

  test(`review profile edits persist model, effort, focus and instructions (${surface})`, async ($, on) => {
    let saved: ReviewProfile[] = []
    on('store.set', { key: 'reviewProfiles' }, (_$, e, next) => { saved = e.value as ReviewProfile[]; return next(e) })
    setup(on)
    held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review' })
    held(on, 'providers', { claude: blank(), codex: { ...blank(), models: [{ id: 'other', efforts: ['low', 'high'] }] }, commandcode: blank(), opencode: blank(), antigravity: blank() })
    const profiles = held<ReviewProfile[]>(on, 'reviewProfiles', [])
    const ui = await mount($, surface)
    expect(profiles.get()).toEqual([])
    for (let i = 0; i < 3; i++) expect(await ui.find({ key: `rev:row:${i}` })).toBeDefined()
    await ui.press({ key: 'rprof:edit' })
    await ui.select({ key: 'rev:effort:0', value: 'high' })
    await ui.input({ key: 'rev:focus:0', text: 'Check races carefully' })
    await ui.input({ key: 'rev:instructions', text: 'Give reproduction steps' })
    const deep = saved.find(p => p.id === 'deep')!
    expect(deep.reviewers[0]).toMatchObject({ effort: 'high', focus: 'Check races carefully' })
    expect(deep.instructions).toBe('Give reproduction steps')
    await ui.select({ key: 'rev:model:0', value: 'other' })
    expect(profiles.get()[1]!.reviewers[0]!.model).toBe('other')
    await ui.select({ key: 'rev:effort:0', value: 'default' })
    expect(profiles.get()[1]!.reviewers[0]!.effort).toBeUndefined()
    await ui.select({ key: 'rev:provider:0', value: 'claude' })
    expect(profiles.get()[1]!.reviewers[0]!.provider).toBe('claude')
    await ui.press({ key: 'rev:add' })
    expect(profiles.get()[1]!.reviewers.length).toBe(4)
    await ui.press({ key: 'rev:del:3' })
    expect(profiles.get()[1]!.reviewers.length).toBe(3)
    await ui.press({ key: 'rprof:quick' })
    expect(await ui.find({ key: 'rev:row:1' })).toBeUndefined()
    await ui.unmount()
  })

  test(`Plan model and effort selectors preserve model flags (${surface})`, async ($, on) => {
    setup(on)
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'plan' })
    held(on, 'providers', { claude: { ...blank(), models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet', efforts: ['medium', 'high'] }] }, codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank() })
    const main = held(on, 'main', { model: 'claude-opus-5-5[1m]', effort: 'medium' })
    const commands: { command: string; args?: string }[] = []
    on('command.run', (_$, e) => { commands.push({ command: e.command, args: e.args }); return { text: 'switched' } })
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'plan:model' }))?.props.options).toContainEqual({ value: 'claude-opus-5-5', label: 'opus-5-5' })
    await ui.select({ key: 'plan:model', value: 'claude-sonnet-5-5' })
    await ui.select({ key: 'plan:effort', value: 'high' })
    expect(commands).toEqual([{ command: 'model', args: 'claude-sonnet-5-5[1m]' }, { command: 'effort', args: 'high' }])
    expect(main.get()).toMatchObject({ model: 'claude-sonnet-5-5[1m]', effort: 'high' })
    await ui.unmount()
  })

  for (const width of [64, 110]) test(`all Work tabs render, earlier stages are read-only and reset clears review state (${surface}, ${width})`, async ($, on) => {
    setup(on)
    const stage = held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'source', findSel: [findingKey(finding)] })
    const findings = held(on, 'findings', [finding])
    const impl = held<Impl>(on, 'impl', { agents: [{ provider: 'codex', model: 'gpt-6.1-sol', on: true }], launchedAt: 10 })
    held(on, 'routing', route())
    const ui = await mount($, surface, width)
    for (const tab of ['source', 'plan', 'implement', 'review', 'settings']) {
      await ui.press({ key: `wtab:${tab}` })
      expect(await ui.find({ key: `work:${tab}` })).toBeDefined()
      if (tab === 'plan') for (const key of ['plan:lock', 'plan:advance', 'plan:model', 'plan:effort']) expect(await ui.find({ key })).toBeUndefined()
      if (tab === 'implement') for (const key of ['impl:launch', 'impl:on:0', 'impl:review']) expect(await ui.find({ key })).toBeUndefined()
    }
    await ui.press({ key: 'wset:reset' })
    await ui.press({ key: 'wset:reset:no' })
    expect(stage.get().at).toBe('review')
    await ui.press({ key: 'wset:reset' })
    await ui.press({ key: 'wset:reset:yes' })
    expect(stage.get()).toEqual(freshStage(10000))
    expect(findings.get()).toEqual([])
    expect(impl.get()).toEqual({ agents: [] })
    expect(await ui.find({ key: 'work:plan' })).toBeDefined()
    expect(await ui.find({ key: 'wtab:review' })).toBeUndefined()
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`implementation activity includes only this launch and groups changed files (${surface})`, async ($, on) => {
    setup(on)
    held(on, 'stage', advance(freshStage(), 'implement'))
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'implement' })
    held<Impl>(on, 'impl', { agents: [], launchedAt: 9000 })
    held(on, 'nodes', [
      { id: 'current', kind: 'agent', model: 'gpt-6.1-sol', provider: 'codex', label: 'Current build', state: 'running', steps: 3, startedAt: 9000 },
      { id: 'old', kind: 'agent', model: 'old', label: 'Old build', state: 'done', steps: 9, startedAt: 8000 },
      { id: 'wf', kind: 'workflow', model: 'workflow', label: 'Workflow wrapper', state: 'running', steps: 0, startedAt: 9000 },
    ])
    held<EditItem[]>(on, 'edits', [
      { file: 'src/current.ts', lines: [], added: 4, removed: 1, at: 9001, provider: 'codex' },
      { file: 'src/current.ts', lines: [], added: 2, removed: 3, at: 9002, provider: 'codex' },
      { file: 'src/old.ts', lines: [], added: 999, at: 8000 },
    ])
    held(on, 'acts', {
      current: { key: 'current', tool: 'Bash', title: 'Run current checks', state: 'failed', at: 9500 },
      old: { key: 'old', tool: 'Bash', title: 'Old command', state: 'done', at: 8000 },
    })
    held(on, 'turnCosts', [{ durationMs: 1000, at: 9500, tokens: 100, usd: 1.23 }, { durationMs: 1000, at: 8000, tokens: 999, usd: 99 }])
    const ui = await mount($, surface, 64)
    for (const text of ['Current build', 'src/current.ts', '+6', '−4', 'Run current checks', '100 tokens · $1.23']) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    for (const text of ['Old build', 'Workflow wrapper', 'src/old.ts', 'Old command']) expect(await ui.find({ type: 'Text', text })).toBeUndefined()
    await ui.unmount()
  })

  test(`failed review and fix submissions preserve findings and the stage (${surface})`, async ($, on) => {
    setup(on, true)
    const stage = held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review', findSel: [findingKey(finding)] })
    const findings = held(on, 'findings', [finding])
    const toasts: string[] = []
    on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
    const ui = await mount($, surface)
    await ui.press({ key: 'rev:launch' })
    expect(findings.get()).toEqual([finding])
    await ui.press({ key: 'find:fix' })
    expect(stage.get().at).toBe('review')
    await ui.press({ key: 'ship:commit' })
    expect(stage.get().at).toBe('review')
    expect(toasts.length).toBe(3)
    await ui.unmount()
  })

  test(`saved reviewer profiles load without drawing writes and an empty implementation cannot launch (${surface})`, async ($, on) => {
    const saved: ReviewProfile[] = [{ id: 'custom', name: 'Custom', instructions: 'Local profile', reviewers: [{ provider: 'codex', model: 'custom-model', focus: 'Local focus' }] }]
    on('store.get', { key: 'reviewProfiles' }, () => ({ value: saved }))
    const sent = setup(on)
    const stage = held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review' })
    let writes = 0
    on('state.set', { plugin: 'agent-overview', key: 'reviewProfiles' }, (_$, e, next) => { writes++; return next(e) })
    const ui = await mount($, surface)
    expect(await ui.find({ key: 'rprof:custom' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'custom-model' })).toBeDefined()
    expect(writes).toBe(0)
    stage.set(advance(stage.get(), 'implement'))
    await ui.press({ key: 'wtab:implement' })
    await ui.press({ key: 'impl:launch' })
    expect(sent.length).toBe(0)
    await ui.unmount()
  })
}

test('session start registers the review logging schema', async ($, on) => {
  const registered: any[] = []
  const commands: string[] = []
  on('tool.register', (_$, e) => { registered.push(e); return { value: { tool: e.name } } })
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/test' })
  on('command.register', (_$, e) => { commands.push(e.name); return { value: { command: e.name } } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'test' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: '{}' }))
  on('fs.list', () => ({ value: [] }))
  await ($.session as any).start({ cwd: '/test', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(commands).toEqual(['default', 'overview', 'clean-worktrees', 'review-adversarial', 'handover', 'mode', 'preset', 'guard', 'usage', 'decisions'])
  expect(registered.find(t => t.name === 'review_log')).toMatchObject({ isDeferred: false, inputSchema: { required: ['file', 'severity', 'text', 'by'], properties: { severity: { enum: ['high', 'medium', 'low'] }, line: { type: 'integer' } } } })
})


test('implementation choices exclude unavailable providers for default and saved selections', () => {
  const r: Routing = { ...route(), agyCoding: false, picks: [...picks, { provider: 'antigravity', model: 'gemini' }],
    on: { ...route().on, codex: false }, paused: { opencode: { at: 0, until: 99999, why: 'quota' } } }
  const explicit: Impl = { agents: r.picks.map(p => ({ ...p, on: true })) }
  for (const held of [{ agents: [] } as Impl, explicit]) expect(implAgents(r, held, ['claude'])).toEqual([])
  expect(agentBlock(r, 'codex')).toBe('provider off')
  expect(agentBlock(r, 'opencode')).toBe('provider paused')
  expect(agentBlock(r, 'claude', ['claude'])).toBe('over spend cap')
  expect(agentBlock(r, 'antigravity')).toContain('coding disabled')
  expect(reviewerBlock({ ...route(), role: 'plan' }, SEED_PROFILES[0]!.reviewers[0]!, normalGuard(undefined))).toContain('subagents blocked')
  expect(reviewerBlock({ ...route(), role: 'plan' }, SEED_PROFILES[0]!.reviewers[0]!, normalGuard({ planSubagents: 'handoff' }))).toBeUndefined()
  expect(reviewerBlock(route(), { provider: 'antigravity', model: 'gemini', focus: 'visual and logic correctness' }, normalGuard(undefined))).toContain('coding disabled')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`dropped Work prompts preserve all work state and toast the reason (${surface})`, async ($, on) => {
    setup(on, 'drop')
    const stage = held<Stage | null>(on, 'stage', { ...freshStage() })
    const findings = held(on, 'findings', [finding])
    const impl = held<Impl>(on, 'impl', { agents: [] })
    const grill = held<GrillItem[]>(on, 'grill', [{ question: 'Plan', answer: 'Keep it', documented: false }])
    const state = held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'plan', findSel: [findingKey(finding)] })
    held(on, 'routing', route())
    const toasts: string[] = []
    on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
    const ui = await mount($, surface)
    const plan = stage.get()
    await ui.press({ key: 'plan:advance' })
    expect(stage.get()).toEqual(plan)
    expect(grill.get()[0]!.documented).toBe(false)
    expect(await ui.find({ key: 'wtab:implement' })).toBeUndefined()
    stage.set(advance(plan, 'implement')); state.set({ ...state.get(), workTab: 'implement' }); await ui.redraw()
    await ui.press({ key: 'impl:launch' })
    expect(impl.get()).toEqual({ agents: [] })
    stage.set(reviewStage()); state.set({ ...state.get(), workTab: 'review' }); await ui.redraw()
    for (const key of ['rev:launch', 'find:fix', 'ship:commit']) await ui.press({ key })
    expect(stage.get()).toEqual(reviewStage())
    expect(findings.get()).toEqual([finding]); expect(findings.writes()).toBe(0)
    expect(toasts).toEqual(Array(5).fill('queue refused this prompt'))
    await ui.unmount()
  })

  test(`profile saves merge the latest profiles from other chats (${surface})`, async ($, on) => {
    let saved = normalProfiles(SEED_PROFILES)
    on('store.get', { key: 'reviewProfiles' }, () => ({ value: saved }))
    on('store.set', { key: 'reviewProfiles' }, (_$, e, next) => { saved = e.value as ReviewProfile[]; return next(e) })
    setup(on)
    held(on, 'reviewProfiles', normalProfiles(SEED_PROFILES))
    held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review' })
    const ui = await mount($, surface)
    await ui.press({ key: 'rprof:edit' })
    saved = saved.map(p => p.id === 'quick' ? { ...p, instructions: 'Changed in another chat' } : p)
    await ui.input({ key: 'rev:instructions', text: 'Changed here' })
    expect(saved.find(p => p.id === 'quick')!.instructions).toBe('Changed in another chat')
    expect(saved.find(p => p.id === 'deep')!.instructions).toBe('Changed here')
    await ui.unmount()
  })

  test(`ADR tracking keeps the first successful ADR after advancing (${surface})`, async ($, on) => {
    const sent = setup(on)
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'plan' })
    const stage = held<Stage | null>(on, 'stage', { ...freshStage() })
    held<EditItem[]>(on, 'edits', [{ file: 'docs/adr/old.md', lines: [], at: 100 }])
    held<GrillItem[]>(on, 'grill', [{ question: 'Why?', answer: 'Clarity', documented: true }])
    on('tool.call', (_$, e) => (e as any).tool_use_id === 'bad' ? { isError: true, result: 'failed' } : { result: 'ok' })
    const ui = await mount($, surface)
    await ui.press({ key: 'plan:advance' })
    expect(sent).toEqual([]); expect(stage.get()?.at).toBe('implement')
    const write = (file: string, id = file) => ($.tool as any).call({ tool: 'Write', tool_use_id: id, file_path: file, content: 'Decision' })
    await write('docs/adr/failed.md', 'bad'); expect(stage.get()?.adr).toBeUndefined()
    await write('README.md'); expect(stage.get()?.adr).toBeUndefined()
    await write('docs/adr/0002-plan.md'); expect(stage.get()?.adr).toBe('docs/adr/0002-plan.md')
    await write('decisions/later.md'); expect(stage.get()?.adr).toBe('docs/adr/0002-plan.md')
    await ui.unmount()
  })

  test(`review warnings omit blocked reviewers and implementation explains exclusions (${surface})`, async ($, on) => {
    const sent = setup(on)
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review' })
    const r = { ...route(), role: 'plan' as const, on: { ...route().on, codex: false } }
    held(on, 'routing', r)
    held(on, 'reviewProfiles', [{ id: 'deep', name: 'Deep', instructions: '', reviewers: [...SEED_PROFILES[1]!.reviewers, { provider: 'antigravity', model: 'coding-review', focus: 'logic' }] }])
    const stage = held(on, 'stage', reviewStage())
    const ui = await mount($, surface)
    for (const i of [0, 1, 3]) expect(await ui.find({ key: `rev:warning:${i}` })).toBeDefined()
    expect(await ui.find({ key: 'rev:warning:2' })).toBeUndefined()
    await ui.press({ key: 'rev:launch' })
    expect(sent[0]).toContain('1. gemini-3.8-flash-high')
    expect(sent[0]).toContain('Omitted by current routing:')
    expect(sent[0]).not.toContain('1. gpt-6.1-sol')
    stage.set(advance(stage.get(), 'implement')); await ui.press({ key: 'wtab:implement' })
    expect(await ui.find({ key: 'impl:excluded:codex/gpt-6.1-sol' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /provider off/ })).toBeDefined()
    await ui.unmount()
  })
}


for (const surface of ['terminal', 'desktop'] as const) test(`over-cap implementation agents are dimmed and cannot launch (${surface})`, async ($, on) => {
  const sent = setup(on)
  held(on, 'stage', advance(freshStage(), 'implement'))
  held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'implement' })
  held(on, 'routing', { ...route(), picks: [picks[1]!] })
  held<Impl>(on, 'impl', { agents: [{ ...picks[1]!, on: true }] })
  held(on, 'guard', normalGuard({ caps: { codex: 5 } }))
  held(on, 'costs', { rows: [{ provider: 'codex', model: 'gpt-6.1-sol', period: 'today', reported: 6, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }], claude: {}, agy: {} })
  const ui = await mount($, surface)
  const row = await ui.find({ key: 'impl:excluded:codex/gpt-6.1-sol' })
  expect(row?.text).toContain('over spend cap')
  expect(await ui.find({ type: 'Text', text: /over spend cap/ })).toMatchObject({ props: { dimColor: true } })
  await ui.press({ key: 'impl:launch' }); expect(sent).toEqual([])
  await ui.unmount()
})

test('default implementation ranks tags before models, with no special rank for Claude or provider order', () => {
  const r: Routing = { ...defaultRouting(), order: ['commandcode', 'opencode', 'antigravity', 'codex'], tags: { commandcode: 'main', claude: 'saver' }, picks: [
    { provider: 'codex', model: 'smartest' }, { provider: 'claude', model: 'saver' },
    { provider: 'opencode', model: 'middle' }, { provider: 'codex', model: 'small' },
    { provider: 'commandcode', model: 'main' },
  ] }
  for (const useOrder of [true, false]) expect(implAgents({ ...r, useOrder }, { agents: [] }).map(a => a.model)).toEqual(['main', 'smartest', 'middle', 'small', 'saver'])
  expect(implAgents({ ...r, tags: {} }, { agents: [] }).map(a => a.model)).toEqual(r.picks.map(a => a.model))
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`stage highlights survive time and later stages until the tab is first opened (${surface})`, async ($, on) => {
    setup(on, false, false)
    const clock = mock.clock(on, { now: 10000 })
    const stage = held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'source' })
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: 'Implement ◆' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Review ◆' })).toBeDefined()
    await ui.press({ key: 'wtab:review' })
    expect(stage.get().seen).toEqual(['plan', 'review'])
    await ui.press({ key: 'wtab:source' })
    await clock.advance(120000); await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Implement ◆' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Review ◆' })).toBeUndefined()
    await ui.press({ key: 'wtab:implement' }); await ui.press({ key: 'wtab:source' })
    expect(stage.get().seen).toEqual(['plan', 'review', 'implement'])
    expect(await ui.find({ type: 'Text', text: 'Implement ◆' })).toBeUndefined()
    await ui.unmount()
  })

  test(`custom review input reaches the launch and grill buttons change the Plan prompt (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held(on, 'stage', freshStage(10000))
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'settings' })
    held(on, 'guard', normalGuard(undefined))
    on('prompt.compose', () => ({ sections: [] }))
    const text = async () => (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [surface], tools: [], outputStyle: null, traits: [] })).sections.find(s => s.id === 'agent-overview:work')?.text
    const ui = await mount($, surface)
    await ui.press({ key: 'wset:grill:off' })
    expect(await text()).not.toContain('supermatt:grilling')
    await ui.press({ key: 'wset:grill:on' })
    expect(await text()).toContain('supermatt:grilling')
    stage.set(reviewStage())
    await ui.redraw(); await ui.press({ key: 'wtab:review' })
    await ui.input({ key: 'rev:note', text: 'Check cancellation during the final write.', kind: 'change' })
    await ui.press({ key: 'rev:launch' })
    expect(sent[sent.length - 1]).toContain("Owner's instructions for this run: Check cancellation during the final write.")
    await ui.unmount()
  })

  test(`Reset excludes old ADR edits from the next implementation and review (${surface})`, async ($, on) => {
    const sent = setup(on, false, false), clock = mock.clock(on, { now: 10000 })
    const stage = held(on, 'stage', { ...reviewStage(), adr: 'docs/adr/old.md' })
    const edits = held<EditItem[]>(on, 'edits', [{ file: 'docs/adr/old.md', at: 9999, lines: [] }])
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'settings' })
    held(on, 'routing', route())
    const ui = await mount($, surface)
    await ui.press({ key: 'wset:reset' }); await ui.press({ key: 'wset:reset:yes' })
    expect(stage.get().startedAt).toBe(10000)
    expect(adrOf(stage.get(), edits.get())).toBeUndefined()
    await ui.press({ key: 'plan:advance' }); await ui.press({ key: 'impl:launch' })
    expect(sent[sent.length - 1]).not.toContain('old.md')
    await clock.advance(1)
    edits.set([...edits.get(), { file: 'docs/adr/current.md', lines: [], at: 10001 }])
    expect(adrOf(stage.get(), edits.get())).toBe('docs/adr/current.md')
    await ui.press({ key: 'impl:review' }); await ui.press({ key: 'rev:launch' })
    expect(sent[sent.length - 1]).toContain('docs/adr/current.md')
    expect(sent[sent.length - 1]).not.toContain('old.md')
    await ui.unmount()
  })
}

test('read-only CLI guards require real provider flags on every command', () => {
  const allowed = [
    'codex exec -s read-only "Review the diff"',
    'codex exec --sandbox read-only "Review the diff"',
    'codex --sandbox read-only exec "Review the diff"',
  ]
  const blocked = [
    'opencode run --agent plan -m p/m "Review the diff"',
    'opencode run --agent "plan" "Review the diff"',
    'opencode run --agent readonly "Review the diff"',
    'codex exec -s read-only "task" && opencode run --agent plan "task"',
    'codex exec "Review read-only"', 'opencode run -m p/m "Review the diff, read-only"',
    'codex exec "-s read-only"', 'opencode run "--agent plan"',
    'codex exec -- -s read-only', 'opencode run -- --agent plan',
    'codex exec -m --sandbox read-only "task"',
    'codex exec -s read-only -s workspace-write "task"',
    'codex --sandbox workspace-write exec "task"',
    'codex exec -s read-only --full-auto "task"',
    'opencode run --agent plan --agent build "task"',
    'opencode run --agent=plan "task"',
    'cmd -p "review the diff, read-only" --model moonshotai/kimi-k3',
    'codex exec -s read-only "task" && opencode run "Review read-only"',
  ]
  for (const at of ['plan', 'review'] as const) {
    const stage = advance(freshStage(), at)
    for (const command of allowed) expect(stageDeny('work', stage, { tool: 'Bash', command })).toBeUndefined()
    for (const command of blocked) expect(stageDeny('work', stage, { tool: 'Bash', command })).toBeDefined()
    expect(stageDeny('work', stage, { tool: 'Edit' })).toBeDefined()
  }
  expect(stageDeny('work', null, { tool: 'Write' })).toBe(PLAN_LOCK)
  for (const provider of ['commandcode', 'opencode'] as const) expect(reviewerBlock(route(), { provider, model: 'blocked', focus: 'logic' }, normalGuard(undefined))).toBe('no read-only mode')
  for (const a of SEED_PROFILES[2]!.reviewers) expect(reviewerBlock(route(), a, normalGuard(undefined))).toBeUndefined()
  const prompt = reviewPrompt(SEED_PROFILES[2]!, undefined, undefined, undefined)
  expect(prompt).toContain('codex exec -s read-only')
  expect(prompt).toContain('missing tests, docs')
  expect(prompt).not.toContain('opencode run')
  expect(prompt).not.toContain('3. moonshotai')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`open questions confirm advancement and Grill off skips ADR (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held(on, 'stage', freshStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'plan' })
    held(on, 'guard', normalGuard({ work: { grill: false } }))
    held<GrillItem[]>(on, 'grill', [{ question: 'Unresolved?', answer: '' }])
    const ui = await mount($, surface)
    await ui.press({ key: 'plan:advance' })
    expect(stage.get().at).toBe('plan'); expect(sent).toEqual([])
    await ui.redraw()
    expect((await ui.find({ key: 'plan:advance' }))?.text).toContain('Advance with 1 open?')
    await ui.press({ key: 'plan:advance' })
    expect(stage.get().at).toBe('implement'); expect(sent).toEqual([])
    for (const text of ['qa_log', 'Grill the owner', 'Q&A doc']) expect(workText('work', freshStage(), { grill: false })).not.toContain(text)
    expect(await ui.find({ key: 'impl:review' })).toBeUndefined()
    await ui.unmount()
  })

  test(`running launches cannot be repeated and zero costs stay hidden (${surface})`, async ($, on) => {
    const sent = setup(on)
    held(on, 'stage', advance(freshStage(), 'implement'))
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'implement' })
    held(on, 'routing', route())
    held<Impl>(on, 'impl', { agents: [], launchedAt: 9000 })
    const main = held(on, 'main', { model: 'opus', working: true })
    const nodes = held(on, 'nodes', [{ id: 'worker', kind: 'task', state: 'running', model: 'gpt', steps: 3, label: 'Build', startedAt: 9000 }])
    const ui = await mount($, surface)
    expect(await ui.find({ key: 'impl:launch' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Running · 1 agent' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0 tokens/ })).toBeUndefined()
    nodes.set([]); await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Running' })).toBeDefined()
    nodes.set([{ id: 'worker', kind: 'task', state: 'running', model: 'gpt', steps: 3, label: 'Build', startedAt: 9000 }])
    main.set({ model: 'opus', working: false }); await ui.redraw()
    expect(await ui.find({ key: 'impl:launch' })).toBeUndefined()
    nodes.set([]); await ui.redraw()
    expect(await ui.find({ key: 'impl:launch' })).toBeDefined()
    expect(sent).toEqual([])
    await ui.unmount()
  })

  test(`Ship waits for a commit, then shows delivery actions and starts a new task (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review', findSel: [findingKey(finding)] })
    const findings = held(on, 'findings', [{ ...finding, severity: 'high' as const }])
    const impl = held<Impl>(on, 'impl', { agents: [], launchedAt: 1 })
    const git = held(on, 'git', { branch: 'work', commit: 'abc123', dirty: 1, ahead: '' })
    const acts = held(on, 'acts', { pr: { key: 'pr', tool: 'Bash', title: 'gh pr create', state: 'done', at: 10000, output: ['https://github.com/example/panel/pull/42'] } })
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: '1 high finding open' })).toBeDefined()
    await ui.press({ key: 'ship:commit' }); expect(sent).toEqual([])
    expect(stage.get().at).toBe('review')
    await ui.press({ key: 'find:dismiss' })
    await ui.press({ key: 'ship:commit' })
    expect(stage.get().at).toBe('ship')
    expect(await ui.find({ type: 'Text', text: 'Commit pending' })).toBeDefined()
    expect(await ui.find({ key: 'ship:push' })).toBeUndefined()
    git.set({ branch: 'work', commit: 'def456 Fix Work', dirty: 0, ahead: '↑1' }); await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Committed · def456' })).toBeDefined()
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://github.com/example/panel/pull/42')
    expect(await ui.find({ key: 'rev:launch' })).toBeUndefined()
    await ui.press({ key: 'ship:push' }); expect(sent.at(-1)).toContain('wait for their yes')
    await ui.press({ key: 'ship:pr' }); expect(sent.at(-1)).toContain('title, body and target')
    expect((await ui.find({ key: 'wtab:review' }))?.text).toContain('Ship')
    for (const [state, title, ahead, label] of [
      ['failed', 'git push origin work', '↑1', 'Committed'],
      ['done', 'git push --dry-run origin work', '', 'Committed'],
      ['done', 'git push origin work', '↑1', 'Committed'],
      ['done', 'git push origin work', '', 'Pushed'],
    ] as const) {
      acts.set({ ...acts.get(), push: { key: 'push', tool: 'Bash', title, state, at: 10000 } } as any)
      git.set({ branch: 'work', commit: 'def456 Fix Work', dirty: 0, ahead })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: `${label} · def456` })).toBeDefined()
    }
    await ui.press({ key: 'ship:new' })
    expect(stage.get()).toEqual(freshStage(10000))
    expect(findings.get()).toEqual([]); expect(impl.get()).toEqual({ agents: [] })
    expect(await ui.find({ key: 'work:plan' })).toBeDefined()
    await ui.unmount()
  })
}


test('ADR requests leave unanswered questions open and omit empty owner answers', async ($, on) => {
  const sent = setup(on)
  const qa = held<GrillItem[]>(on, 'grill', [{ question: 'Settled', answer: 'Keep it small' }, { question: 'Unresolved', answer: '' }])
  held(on, 'stage', freshStage())
  held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'plan' })
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'plan:advance' })
  expect(sent).toEqual([])
  await ui.press({ key: 'plan:advance' })
  expect(sent[0]).toContain('Owner answer: Keep it small')
  expect(sent[0]).not.toContain('Unresolved')
  expect(qa.get()[1]!.documented).toBeUndefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`New task and Reset retain QA history and exclude old answers and commit files (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held(on, 'stage', { ...reviewStage(), at: 'ship' as const, reached: STAGES, shipBase: 'old', startedAt: 1 })
    const qa = held<GrillItem[]>(on, 'grill', [{ question: 'Task one', answer: 'Old spec', documented: false, at: 2 }])
    held<EditItem[]>(on, 'edits', [{ file: '/repo/task-one.ts', lines: [], at: 2 }])
    held(on, 'git', { branch: 'work', commit: 'new', ahead: '↑1', dirty: 0 })
    held(on, 'routing', route())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review' })
    const ui = await mount($, surface)
    await ui.press({ key: 'ship:new' })
    expect(qa.get()).toEqual([{ question: 'Task one', answer: 'Old spec', documented: false, at: 2 }]); expect(planCounts(taskQa(qa.get(), stage.get())).answers).toBe(0)
    expect(await ui.find({ key: 'plan:q:0' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '0 answered · 0 open' })).toBeUndefined()
    await ui.press({ key: 'plan:advance' })
    expect(sent).toEqual([])
    await ui.press({ key: 'impl:launch' })
    expect(sent[0]).not.toContain('Old spec')
    await ui.press({ key: 'impl:review' })
    expect((await ui.find({ key: 'review:ship' }))?.text).not.toContain('task-one.ts')
    qa.set([{ question: 'Task two', answer: 'Another spec' }])
    await ui.press({ key: 'wtab:settings' })
    await ui.press({ key: 'wset:reset' }); await ui.press({ key: 'wset:reset:yes' })
    expect(qa.get()).toEqual([{ question: 'Task two', answer: 'Another spec' }]); expect(stage.get().at).toBe('plan')
    await ui.unmount()
  })

  test(`review blocks duplicate launches and preserves findings until a new run (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held(on, 'stage', reviewStage())
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review' })
    const findings = held(on, 'findings', [finding])
    const main = held(on, 'main', { model: 'opus', working: false })
    const nodes = held<any[]>(on, 'nodes', [])
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'ship:commit' }))?.props.variant).not.toBe('primary')
    await ui.press({ key: 'rev:launch' })
    main.set({ model: 'opus', working: true })
    expect(stage.get().reviewStartedAt).toBe(10000)
    expect(findings.get()).toEqual([]); expect(sent.length).toBe(1)
    findings.set([finding]); await ui.redraw()
    expect(await ui.find({ key: 'rev:launch' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Claude is working' })).toBeDefined()
    main.set({ model: 'opus', working: false })
    nodes.set([{ kind: 'task', state: 'running', startedAt: 10000 }]); await ui.redraw()
    expect(await ui.find({ key: 'rev:launch' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Reviewing · 1 reviewer' })).toBeDefined()
    expect(findings.get()).toEqual([finding]); expect(sent.length).toBe(1)
    nodes.set([]); await ui.redraw()
    await ui.press({ key: 'rev:launch' })
    expect(sent.length).toBe(2); expect(findings.get()).toEqual([])
    await ui.unmount()
  })

  test(`fixes start a new agent run and finished fixes advance without relaunch (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held(on, 'stage', reviewStage())
    const impl = held<Impl>(on, 'impl', { agents: [], launchedAt: 100 })
    held(on, 'routing', route())
    held(on, 'findings', [finding])
    held<any[]>(on, 'nodes', [{ id: 'old', model: 'old-model', kind: 'task', startedAt: 100, state: 'done', steps: 1, label: 'Old run' }])
    held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review', findSel: [findingKey(finding)] })
    const ui = await mount($, surface)
    await ui.press({ key: 'find:fix' })
    expect(impl.get().launchedAt).toBe(10000)
    expect(stage.get().reviewStartedAt).toBeUndefined()
    expect(await ui.find({ key: 'impl:run:old' })).toBeUndefined()
    expect(await ui.find({ key: 'impl:launch' })).toBeUndefined()
    expect(await ui.find({ key: 'impl:review' })).toBeDefined()
    expect(sent[0]).toContain('Fix these review findings (round 2)')
    await ui.unmount()
  })

  test(`grilling restores Off, Force and absent owner switches (${surface})`, async ($, on) => {
    setup(on)
    const toggles = held<Record<string, Mode>>(on, 'toggles', { 'plugin:supermatt': 'off', 'skill:supermatt:grilling': 'off' })
    const ui = await mount($, surface)
    for (const before of ['off', 'force', undefined] as const) {
      toggles.set({ 'plugin:supermatt': 'off', ...(before ? { 'skill:supermatt:grilling': before } : {}) })
      await ui.press({ key: 'area:work' }); await ui.press({ key: 'area:confirm' })
      expect(toggles.get()['skill:supermatt:grilling']).toBe('on')
      expect(skillMode(toggles.get(), 'supermatt:grilling')).toBe('on')
      await ui.press({ key: 'wtab:settings' }); await ui.press({ key: 'wset:grill:off' })
      expect(toggles.get()['skill:supermatt:grilling']).toBe('off')
      expect(skillMode(toggles.get(), 'supermatt:grilling')).toBe('off')
      await ui.press({ key: 'wset:grill:on' })
      expect(toggles.get()['skill:supermatt:grilling']).toBe('on')
      expect(skillMode(toggles.get(), 'supermatt:grilling')).toBe('on')
      await ui.press({ key: 'area:overview' }); await ui.press({ key: 'area:confirm' })
      expect(toggles.get()['skill:supermatt:grilling']).toBe(before)
      expect(toggles.get()['plugin:supermatt']).toBe('off')
    }
    await ui.unmount()
  })
}

test('run busy counts only agents from the current launch and includes Claude alone', () => {
  const old = { kind: 'task', state: 'running', startedAt: 1 } as any
  expect(runBusy(2, { model: 'opus' }, [old])).toBe(false)
  expect(runBusy(2, { model: 'opus', working: true }, [])).toBe(true)
  expect(runBusy(undefined, { model: 'opus', working: true }, [old])).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`typed profile drafts survive Done and Run without Enter (${surface})`, async ($, on) => {
    const sent = setup(on)
    held(on, 'stage', reviewStage())
    const state = held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'review' })
    const profiles = held<ReviewProfile[]>(on, 'reviewProfiles', normalProfiles(SEED_PROFILES))
    const ui = await mount($, surface)
    await ui.press({ key: 'rprof:edit' })
    await ui.input({ key: 'rev:focus:0', text: 'Focus typed without Enter', kind: 'change' })
    await ui.input({ key: 'rev:instructions', text: 'Profile note typed without Enter', kind: 'change' })
    expect(profiles.get()[1]!.instructions).not.toBe('Profile note typed without Enter')
    await ui.press({ key: 'rprof:edit' })
    expect(state.get().reviewDraft).toBeUndefined()
    expect(profiles.get()[1]!.instructions).toBe('Profile note typed without Enter')
    expect(profiles.get()[1]!.reviewers[0]!.focus).toBe('Focus typed without Enter')
    await ui.press({ key: 'rprof:edit' })
    await ui.input({ key: 'rev:focus:0', text: 'Focus saved by Run', kind: 'change' })
    await ui.input({ key: 'rev:instructions', text: 'Instructions saved by Run', kind: 'change' })
    await ui.input({ key: 'rev:note', text: 'Owner typed without Enter', kind: 'change' })
    await ui.press({ key: 'rev:launch' })
    for (const text of ['Focus saved by Run', 'Instructions saved by Run', "Owner's instructions for this run: Owner typed without Enter"]) expect(sent[0]).toContain(text)
    expect(profiles.get()[1]!.instructions).toBe('Instructions saved by Run')
    expect(state.get().reviewDraft).toBeUndefined()
    await ui.unmount()
  })

  test(`busy turns hold Plan and Review until every reviewer finishes (${surface})`, async ($, on) => {
    const sent = setup(on)
    const stage = held(on, 'stage', freshStage())
    const state = held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'plan', findSel: [findingKey(finding)] })
    const main = held(on, 'main', { model: 'opus', working: false })
    const nodes = held<any[]>(on, 'nodes', [])
    const findings = held(on, 'findings', [finding])
    const ui = await mount($, surface)
    main.set({ model: 'opus', working: true })
    await ui.press({ key: 'plan:advance' })
    expect(stage.get().at).toBe('plan'); expect(sent).toEqual([])
    await ui.redraw()
    expect(await ui.find({ key: 'plan:advance' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Advance after this turn' })).toBeDefined()
    stage.set({ ...reviewStage(), reviewStartedAt: 9000 })
    state.set({ ...state.get(), workTab: 'review', profileEdit: true })
    await ui.redraw()
    const hidden = ['rev:launch', 'rprof:deep', 'rprof:edit', 'rev:focus:0', 'find:fix', 'find:dismiss']
    for (const key of hidden) expect(await ui.find({ key })).toBeUndefined()
    main.set({ model: 'opus', working: false })
    nodes.set([{ kind: 'task', state: 'running', startedAt: 9000 }]); await ui.redraw()
    for (const key of hidden) expect(await ui.find({ key })).toBeUndefined()
    expect(stage.get().at).toBe('review'); expect(findings.get()).toEqual([finding]); expect(sent).toEqual([])
    nodes.set([]); await ui.redraw()
    expect((await ui.find({ key: 'rev:launch' }))?.text.trim()).toBe('Run again')
    expect((await ui.find({ key: 'rev:launch' }))?.props.variant).not.toBe('primary')
    expect((await ui.find({ key: 'ship:commit' }))?.props.variant).toBe(surface === 'desktop' ? 'primary' : undefined)
    main.set({ model: 'opus', working: true })
    await ui.press({ key: 'find:fix' })
    expect(stage.get().at).toBe('review'); expect(sent).toEqual([])
    await ui.unmount()
  })

  test(`current task alone supplies Plan, ADR and implementation while Default retains history (${surface})`, async ($, on) => {
    const sent = setup(on)
    held(on, 'stage', freshStage(5000))
    held(on, 'routing', route())
    const state = held<Ui>(on, 'ui', { tab: 'dashboard', pick: 'claude', area: 'work', workTab: 'plan' })
    const old = { question: 'Older task', answer: 'Previous spec', at: 4999 }
    const current = { question: 'Current task', answer: 'Current spec', at: 5000 }
    const qa = held<GrillItem[]>(on, 'grill', [old, current])
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'work:plan' }))?.text).not.toContain('Previous spec')
    expect((await ui.find({ key: 'work:plan' }))?.text).toContain('Current spec')
    await ui.press({ key: 'plan:advance' })
    expect(sent[0]).toContain('Current spec'); expect(sent[0]).not.toContain('Previous spec')
    expect(qa.get()[0]).toEqual(old); expect(qa.get()[1]!.documented).toBe(true)
    await ui.press({ key: 'impl:launch' })
    expect(sent[1]).toContain('Current spec'); expect(sent[1]).not.toContain('Previous spec')
    state.set({ ...state.get(), area: 'overview', tab: 'activity' }); await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Previous spec/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Current spec/ })).toBeDefined()
    await ui.unmount()
  })
}
