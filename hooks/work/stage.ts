import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { AgentNode, MainInfo, Area, EditItem, Finding, GrillItem, Impl, Provider, ReviewProfile, Routing, Costs, Guard, Prices, Reviewer, Stage, StageId } from '../../types'
import { agyJobOn, agyModelNotice, HOW, livePicks, nameOf, normalGuard } from '../state'
import { externalOf } from '../graph'
import { spendBy } from '../cost'

export const STAGES: StageId[] = ['plan', 'implement', 'review', 'ship']
export const freshStage = (startedAt = 0): Stage => ({ at: 'plan', reached: ['plan'], round: 1, startedAt, seen: ['plan'] })
export function advance(s: Stage | null, to: StageId, patch: Partial<Stage> = {}): Stage {
  const held = s ?? freshStage()
  return { ...held, at: to, reached: STAGES.filter(x => held.reached.includes(x) || x === to), ...patch }
}

export const seeStage = (s: Stage, id: StageId): Stage => s.seen?.includes(id) ? s : { ...s, seen: [...(s.seen ?? []), id] }

export function writesFiles(command: string): boolean {
  const words = command.match(/\$\(|&&|\|\||>>|>&|[;|()\n>]|(?:"(?:\\.|[^"\\])*"|'[^']*'|\\.|[^\s;|()<>"'\\])+|</g) ?? []
  const plain = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2')
  let atCommand = true, wrapper = ''
  for (let i = 0; i < words.length; i++) {
    const raw = words[i]!, word = plain(raw)
    if ([...raw.matchAll(/"(?:\\.|[^"\\])*"/g)].some(([quoted]) => quoted.includes('$(') && writesFiles(quoted.slice(1, -1)))) return true
    if ((raw === '>' || raw === '>>') && plain(words[i + 1] ?? '') !== '/dev/null') return true
    if (/^(?:;|&&|\|\||\||\(|\$\(|\n)$/.test(raw)) { atCommand = true; wrapper = ''; continue }
    if (!atCommand) continue
    if (/^[A-Za-z_]\w*=/.test(word)) continue
    if (/^(?:env|sudo|xargs|exec|time|nohup)$/.test(word)) { wrapper = word; continue }
    if (word.startsWith('-')) {
      if ((wrapper === 'sudo' && /^(?:-u|-g|--user|--group)$/.test(word)) || (wrapper === 'xargs' && /^(?:-n|-P|-I|-a|--arg-file|--max-args|--max-procs|--replace)$/.test(word))) i++
      continue
    }
    atCommand = false
    const program = word.split('/').pop()!
    const tail = words.slice(i + 1)
    const end = tail.findIndex(x => /^(?:;|&&|\|\||\||\(|\)|\n)$/.test(x))
    const args = tail.slice(0, end < 0 ? undefined : end).map(plain)
    const cli = /^(?:codex|opencode)$/.test(program)
    const discovery = cli && /^(?:--help|-h|--version|-V)$/.test(args.at(-1) ?? '') && (args.length === 1 || args.length === 2 && /^(?:exec|e|run)$/.test(args[0]!))
    const side = discovery ? undefined : cli ? { provider: program } : externalOf([raw, ...tail.slice(0, end < 0 ? undefined : end)].join(' '))
    if (side && !/^(?:sh|bash|zsh)$/.test(program)) {
      let mode: string | undefined
      // Only argv flags count. A quoted task (or another flag's value) cannot grant write access.
      for (let j = 0; j < args.length; j++) {
        const arg = args[j]!
        if (arg === '--') break
        if (side.provider === 'codex' && /^(?:--dangerously-bypass-approvals-and-sandbox|--yolo|--full-auto)$/.test(arg)) return true
        if (side.provider === 'codex' && (arg === '-s' || arg === '--sandbox')) mode = args[++j]
        else if (/^(?:-m|--model|-c|--config|-C|--cd|-p|--profile|--variant|--effort|-o|--output-last-message|--output-schema|-i|--image|-f|--file|--format|--session|--title|--attach|--port|--add-dir|--enable|--disable)$/.test(arg)) j++
        else if (/^(?:-s|--sandbox|--agent)=/.test(arg)) return true
      }
      if (!(side.provider === 'codex' && mode === 'read-only')) return true
    }
    // shortcut: inline-code detection is a plan guard, not a sandbox; use isolation for untrusted commands.
    if (/^(?:python(?:3)?|node|ruby|perl|php|deno|bun)$/.test(program) && args.some(x => /^-(?:[A-Za-z]*[cei][A-Za-z]*)(?:$|=)|^(?:eval|--eval)(?:$|=)/.test(x))) return true
    if (/^(?:sh|bash|zsh)$/.test(program)) {
      const inner = args.findIndex(x => /^-[A-Za-z]*c[A-Za-z]*$/.test(x))
      if (inner >= 0 && writesFiles(args[inner + 1] ?? '')) return true
    }
    if (/^(?:rm|rmdir|mv|cp|mkdir|touch|ln|chmod|chown|tee|truncate|dd|install|patch|rsync|unzip)$/.test(program)) return true
    if (program === 'find' && args.includes('-delete')) return true
    if (program === 'tar' && args.some(x => /^-?[A-Za-z]*x[A-Za-z]*$/.test(x) || x === '--extract')) return true
    if (/^(?:sed|perl)$/.test(program) && args.some(x => /^-[A-Za-z]*i/.test(x))) return true
    if (program === 'git') {
      let j = 0
      while (args[j]?.startsWith('-')) j += /^(?:-C|-c|--git-dir|--work-tree)$/.test(args[j]!) ? 2 : 1
      if (/^(?:add|commit|checkout|switch|reset|restore|apply|am|merge|rebase|cherry-pick|revert|stash|push|pull|clean|rm|mv|tag|worktree)$/.test(args[j] ?? '')) return true
    }
    if (/^(?:npm|pnpm|yarn|bun)$/.test(program) && /^(?:install|i|add|remove|ci|update)$/.test(args[0] ?? '')) return true
    if (program === 'pip' && args[0] === 'install') return true
  }
  return false
}

export const PLAN_LOCK = 'Plan stage: no code changes. Advance to Implement to edit files.'
export function planLockDeny(s: Stage | null, call: { tool: string; command?: unknown }): string | undefined {
  if (s?.at === 'plan' && (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(call.tool) || (call.tool === 'Bash' && writesFiles(String(call.command ?? ''))))) return PLAN_LOCK
}
export const REVIEW_LOCK = 'review stage: no edits; use Fix selected to send fixes to Implement'
export function stageDeny(area: Area | undefined, s: Stage | null, call: { tool: string; command?: unknown }): string | undefined {
  if (area !== 'work') return
  if (s?.at === 'review') return planLockDeny({ ...s, at: 'plan' }, call) ? REVIEW_LOCK : undefined
  return planLockDeny(s ?? freshStage(), call)
}
export function workText(area: Area | undefined, s: Stage | null, work: { grill: boolean }, impl?: Pick<Impl, 'launchedAt'>): string {
  if (area === 'vibe') return [
    'Vibe mode',
    'Long-running autonomous session. Decide routine choices yourself. Ask only when blocked or before destructive, irreversible or outward-facing actions. Keep going through multi-step work with short progress notes.',
    'Log every meaningful choice with decision_log (mcp__agent-overview__decision_log): one short decision line plus why. It feeds the owner’s Decisions.',
    'Re-read the delegation routing each turn: the owner may switch providers mid-run. Follow Main / Normal / Saver and current model priorities. No stages, no grilling. QA logging is suppressed; do not call qa_log or grill_log. Ponytail follows the owner’s normal toggle.',
  ].join('\n')
  if (area !== 'work') return ''
  const at = s?.at ?? 'plan'
  const contract = at === 'plan' ? [
    'No code changes. Log your own choices with decision_log (mcp__agent-overview__decision_log).',
    'When the plan seems complete, suggest advancing to Implement. Never advance the stage yourself.',
    work.grill ? 'Use the supermatt:grilling skill. Log each answer with qa_log (mcp__agent-overview__qa_log); the panel keeps the Q&A, so do not write files in Plan.' : '',
  ].filter(Boolean).join(' ') : at === 'implement' ? (impl?.launchedAt === undefined
    ? 'Wait. The owner picks agents and presses Launch; do not start building.'
    : 'Implementation launched; finish it, say "ready for review".') : at === 'review' ? [
    'Read-only. No code edits or file-writing commands. Use Fix selected to send fixes to Implement.',
    'Run reviewers only when the owner launches them. Log every finding with review_log (mcp__agent-overview__review_log). Never fix findings in Review.',
  ].join(' ') : 'Commit / push / PR only when the owner presses the corresponding buttons. Confirm the branch, remote and commits before push; confirm the title, body and target before opening a PR. Wait for the owner’s yes first.'
  return `Work mode — stage: ${at.charAt(0).toUpperCase() + at.slice(1)}\n${contract}`
}

export const DEFAULT_PROFILE = 'deep'
export const SEED_PROFILES: ReviewProfile[] = [
  { id: 'quick', name: 'Quick', instructions: 'Report only high-confidence correctness bugs.', reviewers: [
    { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', focus: 'correctness only, high-confidence bugs' },
  ] },
  { id: 'deep', name: 'Deep', instructions: 'Check the diff against the plan and explain actionable findings with evidence.', reviewers: [
    { provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', focus: 'logic, edge cases, races' },
    { provider: 'claude', model: 'claude-opus-5-5', effort: 'high', focus: "design, simplicity, and whether the diff matches the Plan's Q&A" },
    { provider: 'antigravity', model: 'gemini-3.8-flash-high', focus: 'visual: screenshots and rendered UI' },
  ] },
  { id: 'ship', name: 'Ship gate', instructions: 'Look for release blockers and give concrete reproduction or validation steps.', reviewers: [
    { provider: 'claude', model: 'claude-opus-5-5', effort: 'max', focus: 'security, data loss, migrations' },
    { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'high', focus: 'performance, hot paths' },
    { provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', focus: 'missing tests, docs' },
  ] },
]
export function normalProfiles(saved: unknown): ReviewProfile[] {
  if (!Array.isArray(saved) || !saved.length || !saved.every(p => p && typeof p.id === 'string' && p.id.trim() && typeof p.name === 'string' && p.name.trim() && Array.isArray(p.reviewers)) || new Set(saved.map(p => p.id)).size !== saved.length) return SEED_PROFILES
  return saved.map(p => ({
    id: p.id, name: p.name, instructions: typeof p.instructions === 'string' ? p.instructions : '',
    reviewers: p.reviewers.filter((r: any) => r && ['claude', 'codex', 'commandcode', 'opencode', 'antigravity'].includes(r.provider) && typeof r.model === 'string' && r.model.trim()).map((r: any) => ({ provider: r.provider as Provider, model: r.model, effort: typeof r.effort === 'string' ? r.effort : undefined, focus: typeof r.focus === 'string' ? r.focus : '' })),
  }))
}
export const findingKey = (f: { file: string; line?: number }) => `${f.file}:${f.line ?? ''}`
const severityRank = { high: 0, medium: 1, low: 2 }
export function mergeFinding(list: Finding[], input: Record<string, unknown>, at: number): Finding[] {
  if (typeof input.file !== 'string' || !input.file.trim()) return list
  const file = input.file.trim(), line = typeof input.line === 'number' && Number.isInteger(input.line) && input.line > 0 ? input.line : undefined
  const severity: Finding['severity'] = input.severity === 'high' || input.severity === 'medium' ? input.severity : 'low'
  const by = typeof input.by === 'string' && input.by.trim() ? input.by.trim() : 'reviewer'
  const key = findingKey({ file, line })
  if (list.some(f => findingKey(f) === key)) return list.map(f => findingKey(f) === key ? { ...f, by: [...new Set([...f.by, by])], severity: severityRank[severity] < severityRank[f.severity] ? severity : f.severity } : f).slice(-200)
  return [...list, { file, line, severity, text: typeof input.text === 'string' ? input.text : '', by: [by], at }].slice(-200)
}
export const taskQa = (qa: GrillItem[], s: Stage | null) => qa.filter(q => (q.at ?? 0) >= (s?.qaSince ?? s?.startedAt ?? 0))
export function planCounts(qa: GrillItem[]) {
  const questions = qa.filter(q => q.kind !== 'instruction')
  const open = questions.filter(q => !q.answer.trim() || /\?$/.test(q.answer.trim()) || /^(?:tbd|unsure|not sure|don't know|later)\b/i.test(q.answer.trim())).length
  return { answers: questions.length - open, open }
}
export function adrOf(s: Stage | null, edits: EditItem[]): string | undefined {
  return s?.adr ?? [...edits].reverse().filter(e => (e.at ?? -1) > (s?.startedAt ?? -Infinity) && /(^|\/)(adr|adrs|decisions)\/[^/]+\.md$/i.test(e.file)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]?.file
}
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const costs = atom({ plugin: 'agent-overview', key: 'costs' } as const, { rows: [], claude: {}, agy: {} } as Costs)
const prices = atom({ plugin: 'agent-overview', key: 'prices' } as const, { catalog: {}, overrides: {} } as Prices)
export async function workCaps($: EngineInterface): Promise<Provider[]> {
  const g = await read($, guard), today = new Date(await $.clock.now()).toDateString()
  const spent = spendBy(await read($, costs), await read($, prices), g.ccBase, today)
  return (Object.keys(g.caps) as Provider[]).filter(p => (g.caps[p] ?? 0) > 0 && (spent[p] ?? 0) >= g.caps[p]!)
}
export function agentBlock(r: Routing, p: Provider, over: Provider[] = [], visual = false): string | undefined {
  if (!r.on[p]) return 'provider off'
  // A local model has no tools: it cannot implement, review files or check visuals.
  if (p === 'ollama') return 'local · small text jobs only'
  if (r.paused?.[p]) return 'provider paused'
  if (over.includes(p)) return 'over spend cap'
  if (r.role === 'claude' && p !== 'claude') return 'Claude only'
  if (p === 'antigravity' && !(visual ? r.agyVisual : r.agyCoding)) return visual ? 'visual checks disabled' : 'visual only · coding disabled'
  if (p === 'antigravity' && !agyJobOn(r, visual ? 'visual' : 'coding')) return `${visual ? 'visual checks' : 'coding'} out of quota`
}
const visualReviewer = (a: Reviewer) => /visual|screenshot|render|media/i.test(a.focus) && !/\b(?:code|coding|logic|correctness|races?|security|migrations?|performance|tests?)\b/i.test(a.focus)
export const reviewerWarning = (r: Routing, a: Reviewer, g: Guard) => a.provider === 'antigravity' ? agyModelNotice(r, g, visualReviewer(a) ? 'visual' : 'coding', a.model) : undefined
export function reviewerBlock(r: Routing, a: Reviewer, g: Guard, over: Provider[] = []): string | undefined {
  const visual = visualReviewer(a)
  return (a.provider === 'commandcode' || a.provider === 'opencode' ? 'no read-only mode' : undefined) ?? agentBlock(r, a.provider, over, visual) ??
    (a.provider === 'claude' && r.role === 'plan' && g.planSubagents === 'block' ? 'Plans only · Claude subagents blocked' : undefined)
}
export function runBusy(since: number | undefined, main: MainInfo, nodes: AgentNode[]): boolean {
  return since !== undefined && (!!main.working || nodes.some(n => n.kind !== 'workflow' && (n.startedAt ?? -1) >= since && n.state === 'running'))
}
export function implAgents(r: Routing, impl: Impl, over: Provider[] = []): Impl['agents'] {
  const allowed = r.picks.filter(p => !agentBlock(r, p.provider, over) && (p.provider !== 'claude' || r.role !== 'plan'))
  r = { ...r, picks: allowed }
  if (!impl.agents.length) {
    const rank = (p: Provider) => r.tags?.[p] === 'main' ? 0 : r.tags?.[p] === 'saver' ? 2 : 1
    const modelRank = (a: Impl['agents'][number]) => r.picks.findIndex(p => p.provider === a.provider && p.model === a.model)
    const order = (p: Provider) => r.useOrder === false ? 0 : r.order.indexOf(p) < 0 ? r.order.length : r.order.indexOf(p)
    return livePicks(r).map(p => ({ provider: p.provider, model: p.model, effort: p.effort, on: true }))
      .sort((a, b) => rank(a.provider) - rank(b.provider) || modelRank(a) - modelRank(b) || order(a.provider) - order(b.provider))
  }
  const same = (a: Impl['agents'][number], b: Routing['picks'][number]) => a.provider === b.provider && a.model === b.model
  return [
    ...impl.agents.flatMap(a => { const p = r.picks.find(p => same(a, p)); return p ? [{ ...a, effort: p.effort }] : [] }),
    ...r.picks.filter(p => !impl.agents.some(a => same(a, p))).map(p => ({ provider: p.provider, model: p.model, effort: p.effort, on: false })),
  ]
}
const agentList = (agents: { provider: Provider; model: string; effort?: string; focus?: string }[]) => agents.map((a, i) => `${i + 1}. ${a.model}${a.effort ? ` (${a.effort})` : ''} on ${nameOf(a.provider)} via ${a.provider === 'antigravity' && a.focus && visualReviewer(a as Reviewer) ? `gemini_visual_qa with model "${a.model}"` : HOW[a.provider](a.model, a.effort)}`).join('\n')
const priority = 'Use these models in priority order: the first does the work, the next only if it fails or runs out of quota.'
export function implementPrompt(agents: Impl['agents'], adr: string | undefined, qa: GrillItem[]): string {
  return [`Implement the plan ${adr ? `in ${adr}` : "from the Plan stage's Q&A"}.`, qa.map(q => `- ${q.question}: ${q.answer}`).join('\n'), priority, agentList(agents), "Give the implementer full context in one run, check what comes back, run the project's checks, and report. Do not commit."].filter(Boolean).join('\n\n')
}
export function reviewPrompt(profile: ReviewProfile, since: string | undefined, note: string | undefined, adr: string | undefined): string {
  const reviewers = profile.reviewers.filter(r => r.provider !== 'commandcode' && r.provider !== 'opencode' && r.provider !== 'ollama')
  const untracked = 'Also review new untracked files: list them with git status --porcelain and read each one (git diff --no-index /dev/null <file>). Give every reviewer these new files along with the tracked diff.'
  return [`Review the diff ${since ? `since commit ${since} (git diff ${since}), including uncommitted changes` : '(git diff HEAD, including uncommitted changes)'}. Run each reviewer in parallel where possible:`, untracked, reviewers.map((r, i) => `${agentList([r]).replace(/^1\./, `${i + 1}.`).replace('codex exec', 'codex exec -s read-only')} — focus: ${r.focus}`).join('\n'), 'Run every reviewer read-only: Codex CLI must use -s read-only (or --sandbox read-only); Antigravity must use gemini_visual_qa or a read-only bounded task; Claude must use a read-only subagent (Agent tool). OpenCode and Command Code have no enforced read-only mode: omit them. Never allow reviewers to edit files. Give each reviewer the diff, the plan' + (adr ? ` in ${adr}` : " from the Plan stage's Q&A") + ', and their focus.', profile.instructions, note ? `Owner's instructions for this run: ${note}` : '', "Log EVERY finding with the review_log tool (mcp__agent-overview__review_log): { file, line, severity, text, by: '<reviewer model>' }, one call per finding. Do not fix anything yet. End with a short summary."].filter(Boolean).join('\n\n')
}
export function fixPrompt(findings: Finding[], round: number, agents: Impl['agents']): string {
  return [`Fix these review findings (round ${round}), the smallest change each:`, findings.map((f, i) => `${i + 1}. [${f.severity}] ${findingKey(f)} — ${f.text} (by ${f.by.join(', ')})`).join('\n'), agents.length ? `${priority}\n${agentList(agents)}` : '', 'Run the project checks and report. Do not commit.'].filter(Boolean).join('\n\n')
}
export function commitPreview(edits: EditItem[], adr: string | undefined, title?: string): string {
  const subject = adr ? title || (adr.split('/').pop() ?? '').replace(/\.md$/i, '').replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' ') : 'message written from the diff'
  return `${(adr ? subject.charAt(0).toUpperCase() + subject.slice(1) : subject).slice(0, 72)}\n\n${[...new Set(edits.map(e => e.path ?? e.file))].slice(0, 8).map(f => `- ${f}`).join('\n')}`
}
export const commitPrompt = (since: string | undefined, preview: string) => `Run the project's checks, then commit the work ${since ? `since ${since}` : 'since HEAD'} on the current branch. Write the message from the real diff; use an ADR title below as a starting point if present. Stop and report if checks fail.\n\n${preview}`
export const pushPrompt = () => 'Push the current branch. FIRST show the owner the branch, remote and commits and wait for their yes before pushing.'
export const prPrompt = () => 'Open a pull request for the current branch. FIRST show the owner the title, body and target and wait for their yes before opening it.'
