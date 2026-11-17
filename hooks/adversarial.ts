import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { AdversarialRun, Finding, Prices, Routing } from '../types'
import { priceOf } from './cost'
import { mergeFinding } from './work/stage'

type $ = EngineInterface

// Adversarial review runs only when the owner asks: /review-adversarial, never on its own.
// A Claude subagent (Opus 5.5 at high effort by default) gets only the diff and the stated goal.
export const ADVERSARY = 'agent-overview:adversary'
export const ADVERSARY_MODEL = 'claude-opus-5-5'
export const DEFAULT_ROUNDS = 2
const MAX_DIFF = 180_000

const idle = (): AdversarialRun => ({ status: 'idle', base: '', goal: '', model: ADVERSARY_MODEL, round: 0, rounds: DEFAULT_ROUNDS, diffChars: 0, files: 0, found: 0, at: 0 })
const run = atom({ plugin: 'agent-overview', key: 'adversarial' } as const, idle())
const findings = atom({ plugin: 'agent-overview', key: 'findings' } as const, [] as Finding[])

export const ADVERSARY_PROMPT = [
  'You are an adversarial reviewer. You are given a diff and the goal it is meant to meet, and nothing else about the conversation that produced it.',
  'Try to break the change: wrong behaviour against the goal, bugs, unhandled edge cases, data loss, races, security holes, broken tests. No style nits, no praise.',
  'You may Read files of the repository to check context; change nothing.',
  'Answer with JSON only: an array of findings, each {"severity": "high"|"medium"|"low", "file": "<path>", "line": <number or null>, "issue": "<what is wrong>", "repro": "<how to see it fail>", "confidence": <0 to 1>}.',
  'Answer [] when you find nothing real.',
].join('\n')

// The owner's review setting is the default; a reviewer that is not a Claude model falls back to Opus 5.5.
export function reviewerOf(r: Routing): { model: string; rounds: number; note?: string } {
  const a = r.adversary
  const rounds = a?.rounds ?? DEFAULT_ROUNDS
  if (!a) return { model: ADVERSARY_MODEL, rounds }
  if (a.provider !== 'claude') return { model: ADVERSARY_MODEL, rounds, note: `${a.model} is not a Claude model, so Opus 5.5 reviews` }
  return { model: a.model, rounds }
}

export type Args = { action: 'prepare' | 'go' | 'cancel' | 'status'; base?: string; goal: string; rounds?: number }
export function parseArgs(text: string): Args {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.toLowerCase()
  if (first === 'go' || first === 'start' || first === 'yes') return { action: 'go', goal: '' }
  if (first === 'cancel' || first === 'stop') return { action: 'cancel', goal: '' }
  if (first === 'status') return { action: 'status', goal: '' }
  let rounds: number | undefined, base: string | undefined
  const rest: string[] = []
  for (const w of words) {
    const m = /^rounds=([1-5])$/.exec(w)
    if (m) rounds = Math.max(1, Math.min(5, Number(m[1])))
    else if (/^base=/.test(w)) base = w.slice(5)
    else rest.push(w)
  }
  // A first word that is plainly a ref is the base (main, origin/main, HEAD~2, a sha); base=<ref> names any other.
  if (!base && rest[0] && /^(?:[0-9a-f]{7,40}|HEAD(?:[~^]\d*)*|origin\/[\w./-]+|main|master|develop)$/.test(rest[0])) base = rest.shift()
  return { action: 'prepare', base, goal: rest.join(' '), rounds }
}

// Rough cost: each round reads the diff a few times (its own context and tool reads) and thinks hard.
const FAMILY: Record<string, { input: number; output: number }> = { opus: { input: 5, output: 25 }, sonnet: { input: 3, output: 15 }, haiku: { input: 1, output: 5 }, fable: { input: 5, output: 25 } }
export function estimate(model: string, diffChars: number, rounds: number, prices?: Prices) {
  const p = (prices && priceOf(prices, model)) ?? FAMILY[Object.keys(FAMILY).find(f => model.includes(f)) ?? 'opus']!
  const input = (diffChars / 3.5 + 3000) * 2, output = 6000
  return rounds * (input * p.input + output * p.output) / 1e6
}

export type Diff = { text: string; files: number; base: string } | { error: string }
async function git($: $, cwd: string, ...argv: string[]) {
  const r = await $.process.run(['git', ...argv], { cwd, timeoutMs: 15000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : undefined
}
export async function gatherDiff($: $, base?: string): Promise<Diff> {
  const cwd = await $.session.cwd().catch(() => '')
  if (!cwd || (await git($, cwd, 'rev-parse', '--show-toplevel')) === undefined) return { error: 'this folder is not a git repository' }
  const ref = base || 'HEAD'
  if ((await git($, cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)) === undefined) return { error: `${ref} is not a commit here` }
  let text = (await git($, cwd, 'diff', '--no-color', '--no-ext-diff', ref)) ?? ''
  const names = new Set(((await git($, cwd, 'diff', '--name-only', ref)) ?? '').split('\n').filter(Boolean))
  // New files the working tree has not added yet are part of the change too.
  const untracked = ((await git($, cwd, 'ls-files', '--others', '--exclude-standard')) ?? '').split('\n').filter(Boolean).slice(0, 30)
  for (const f of untracked) {
    if (text.length > MAX_DIFF) break
    const body = await $.fs.read(`${cwd}/${f}`).catch(() => undefined)
    if (body === undefined || body.includes('\0')) continue
    names.add(f)
    text += `\ndiff --git a/${f} b/${f}\nnew file (untracked)\n--- /dev/null\n+++ b/${f}\n${body.split('\n').slice(0, 800).map(l => `+${l}`).join('\n')}\n`
  }
  if (!text.trim()) return { error: `nothing changed against ${ref}` }
  if (text.length > MAX_DIFF) text = `${text.slice(0, MAX_DIFF)}\n[diff cut at ${MAX_DIFF} characters]`
  return { text, files: names.size, base: ref }
}

export const spawnPrompt = (goal: string, diff: { text: string; base: string }, round: number, rounds: number) =>
  `Goal of the change: ${goal || '(not stated: judge the change on its own terms)'}\nDiff against ${diff.base}, round ${round} of ${rounds}:\n\n${diff.text}`

export type AdversaryFinding = { severity: 'high' | 'medium' | 'low'; file: string; line?: number; issue: string; repro: string; confidence: number }
export function parseFindings(answer: string): AdversaryFinding[] | undefined {
  const body = /```(?:json)?\s*\n([\s\S]*?)```/.exec(answer)?.[1] ?? /\[[\s\S]*\]/.exec(answer)?.[0]
  let list: unknown
  try { list = JSON.parse(body ?? answer) } catch { return undefined }
  if (!Array.isArray(list)) return undefined
  const word: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3 }
  return list.filter(x => x && typeof x === 'object' && typeof (x as any).file === 'string' && typeof (x as any).issue === 'string').map(x => {
    const f = x as Record<string, unknown>
    const c = typeof f.confidence === 'number' ? f.confidence : word[String(f.confidence).toLowerCase()] ?? 0.5
    return {
      severity: f.severity === 'high' || f.severity === 'medium' ? f.severity : 'low',
      file: String(f.file), line: typeof f.line === 'number' && f.line > 0 ? Math.round(f.line) : undefined,
      issue: String(f.issue).slice(0, 600), repro: String(f.repro ?? '').slice(0, 400), confidence: Math.max(0, Math.min(1, c > 1 ? c / 100 : c)),
    } as AdversaryFinding
  })
}
// What the fixer must act on: a defect that matters, stated with some confidence.
export const isReal = (f: AdversaryFinding) => f.severity !== 'low' && f.confidence >= 0.5

const money = (n: number) => n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`

// ---------- the run ----------

export async function prepare($: $, args: Args, r: Routing, prices: Prices): Promise<string> {
  const cur = await read($, run)
  if (cur.status === 'running' || cur.status === 'fixing') return `An adversarial review is already in round ${cur.round} of ${cur.rounds}. /review-adversarial cancel stops it.`
  const diff = await gatherDiff($, args.base)
  if ('error' in diff) return `No adversarial review: ${diff.error}.`
  const who = reviewerOf(r)
  const rounds = args.rounds ?? who.rounds
  const usd = estimate(who.model, diff.text.length, rounds, prices)
  await update($, run, (): AdversarialRun => ({ ...idle(), status: 'confirm', base: diff.base, goal: args.goal, model: who.model, rounds, estimate: usd, diffChars: diff.text.length, files: diff.files, at: 0 }))
  return `Adversarial review ready: ${diff.files} file${diff.files === 1 ? '' : 's'} changed against ${diff.base}${args.goal ? `, goal "${args.goal}"` : ', no goal stated'}. ` +
    `${who.model} at high effort, up to ${rounds} round${rounds === 1 ? '' : 's'}, estimated ≈${money(usd)}.${who.note ? ` (${who.note}.)` : ''} ` +
    'It sees only the diff and the goal. Start it with /review-adversarial go (or Run in the agent panel); /review-adversarial cancel drops it.'
}

export async function startRound($: $): Promise<string> {
  const cur = await read($, run)
  if (cur.status !== 'confirm' && cur.status !== 'fixing') return cur.status === 'running' ? 'The review is already running.' : 'Nothing to start: run /review-adversarial [base] [goal] first to see the cost.'
  const diff = await gatherDiff($, cur.base)
  const round = cur.round + 1
  if ('error' in diff) {
    await update($, run, (x): AdversarialRun => ({ ...x, status: 'done', note: diff.error }))
    return `Adversarial review stopped: ${diff.error}.`
  }
  const spawned = await $.agent.spawn({
    subagentType: ADVERSARY, model: cur.model, description: `Adversarial review round ${round}`,
    prompt: spawnPrompt(cur.goal, diff, round, cur.rounds),
  } as Parameters<$['agent']['spawn']>[0])
  if (spawned.deny) {
    await update($, run, (x): AdversarialRun => ({ ...x, status: 'failed', note: spawned.deny }))
    return `Adversarial review could not start: ${spawned.deny}`
  }
  const at = await $.clock.now()
  await update($, run, (x): AdversarialRun => ({ ...x, status: 'running', round, agentId: spawned.agentId ?? x.agentId, fixTurn: undefined, at: x.at || at }))
  return `Adversarial review round ${round} of ${cur.rounds} started on ${cur.model}. Findings land in the Review tab.`
}

export async function cancel($: $) {
  const cur = await read($, run)
  if (cur.status === 'idle' || cur.status === 'done') return 'No adversarial review is pending.'
  await update($, run, (x): AdversarialRun => ({ ...x, status: 'done', note: 'cancelled by the owner' }))
  return 'Adversarial review cancelled.'
}

export async function statusText($: $) {
  const c = await read($, run)
  return c.status === 'idle' ? 'No adversarial review has run in this session.'
    : `Adversarial review: ${c.status}, round ${c.round} of ${c.rounds}, ${c.found} finding${c.found === 1 ? '' : 's'} so far${c.note ? ` (${c.note})` : ''}.`
}

// The reviewer answered: its findings go to the Review tab; real ones go to the main chat to fix, then the next round.
export async function reviewerDone($: $, agentId: string, answer: string, ok: boolean): Promise<boolean> {
  const cur = await read($, run)
  if (cur.status !== 'running') return false
  // A spawn that did not hand back its id (a reload, a host that answers late) is known by its description.
  const mine = cur.agentId ? cur.agentId === agentId : (await $.agent.list().catch(() => [])).some(a => a.id === agentId && a.description === `Adversarial review round ${cur.round}`)
  if (!mine) return false
  const list = ok ? parseFindings(answer) : undefined
  if (!list) {
    await update($, run, (x): AdversarialRun => ({ ...x, status: 'failed', note: ok ? 'the reviewer did not answer with the findings JSON' : 'the reviewer stopped early' }))
    $.ui.toast(`✗ Adversarial review round ${cur.round}: no findings JSON`)
    return true
  }
  const at = await $.clock.now()
  const by = `${cur.model.replace(/^claude-/, '')} adversary r${cur.round}`
  await update($, findings, all => list.reduce((acc, f) => mergeFinding(acc, { file: f.file, line: f.line, severity: f.severity, text: `${f.issue}${f.repro ? ` · repro: ${f.repro}` : ''} · confidence ${Math.round(f.confidence * 100)}%`, by }, at), all))
  const real = list.filter(isReal)
  const more = real.length > 0 && cur.round < cur.rounds
  await update($, run, (x): AdversarialRun => ({ ...x, status: more ? 'fixing' : 'done', agentId: undefined, found: x.found + list.length, note: real.length ? `${real.length} to fix after round ${cur.round}` : `round ${cur.round} found nothing real` }))
  $.ui.toast(`◆ Adversarial review round ${cur.round}: ${list.length} finding${list.length === 1 ? '' : 's'}, ${real.length} real`)
  if (more) {
    const lines = real.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.issue}${f.repro ? ` (repro: ${f.repro})` : ''}`)
    await $.prompt.submit({ text: `Adversarial review round ${cur.round} of ${cur.rounds} (requested by Sai) found these defects. Fix the real ones, then end your turn; round ${cur.round + 1} starts after it.\n${lines.join('\n')}` }).catch(() => undefined)
  }
  return true
}

// The reviewer's id as the spawn hook sees it, for a spawn whose answer does not carry it back.
export async function noteReviewer($: $, agentId?: string) {
  const cur = await read($, run)
  if (agentId && (cur.status === 'confirm' || cur.status === 'fixing' || cur.status === 'running')) await update($, run, (x): AdversarialRun => ({ ...x, agentId }))
}

// The main turn after a fix request is the fix: when it ends, the next round starts.
export async function mainTurnStarted($: $, turnId: string) {
  const cur = await read($, run)
  if (cur.status === 'fixing' && !cur.fixTurn) await update($, run, (x): AdversarialRun => ({ ...x, fixTurn: turnId }))
}
export async function mainTurnEnded($: $, turnId: string) {
  const cur = await read($, run)
  if (cur.status === 'fixing' && cur.fixTurn === turnId) $.clock.after(10, () => void startRound($))
}
