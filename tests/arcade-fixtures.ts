// Frozen copy of the scaffold fixtures: the arcade's pixel-level scenario tests are pinned to these. hooks/vibe/fixtures.ts holds the richer live-preview set.
import type { VibeData } from '../hooks/vibe/engine'

const now = 1792497600000
const busy: VibeData = {
  now,
  hour: 14,
  main: { model: 'claude-opus-5-5', effort: 'high', working: true, lastTool: 'Agent', waiting: false },
  agents: [
    { id: 'codex-1', label: 'Build the pane', provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', state: 'running', startedAt: now - 20000, steps: 12, lastTool: 'Edit', tokens: 18000 },
    { id: 'opencode-1', label: 'Check the parser', provider: 'opencode', model: 'opencode-go/deepseek-v4-pro', effort: 'max', state: 'running', startedAt: now - 14000, steps: 8, lastTool: 'Bash', tokens: 9000 },
    { id: 'agy-1', label: 'Inspect the scene', provider: 'antigravity', model: 'gemini-4-argon-high', effort: 'high', state: 'running', startedAt: now - 8000, steps: 4, lastTool: 'Read', tokens: 5000 },
  ],
  edit: { file: 'hooks/view.tsx', added: 24, removed: 7, provider: 'codex' },
  acts: [{ tool: 'Bash', title: 'git diff --check', state: 'done', at: now - 2000, kind: 'bash' }],
  tests: 'pass',
  decisions: [],
  usage: [
    { provider: 'claude', on: true, percent: 32, out: false, tag: 'normal' },
    { provider: 'codex', on: true, percent: 42, out: false, tag: 'main' },
    { provider: 'opencode', on: true, percent: 21, out: false, tag: 'normal' },
    { provider: 'antigravity', on: true, percent: 18, out: false, tag: 'normal' },
    { provider: 'commandcode', on: true, percent: 8, out: false, tag: 'normal' },
  ],
  cost: 2.35, ctx: 46, commits: 2, pushes: 1, combo: 14, idle: 0, tps: 85, lines: 128, findings: 0, best: 164,
}

export const FIXTURES: Record<'busy' | 'idle' | 'failing' | 'quota' | 'review', VibeData> = {
  busy,
  idle: { ...busy, hour: 23, main: { ...busy.main, working: false, waiting: true }, agents: [], edit: null, acts: [], tests: null, idle: 180, tps: 0 },
  failing: { ...busy, acts: [{ tool: 'Bash', title: 'npm test', state: 'failed', at: now - 1000, kind: 'test', tests: 'fail' }], tests: 'fail', combo: 0 },
  quota: { ...busy, usage: busy.usage.map(u => u.provider === 'codex' ? { ...u, percent: 96, out: true, tag: 'normal' } : u.provider === 'claude' ? { ...u, tag: 'saver' } : u.provider === 'opencode' ? { ...u, tag: 'main' } : { ...u }) },
  review: { ...busy, findings: 7, decisions: [
    { decision: 'Keep the renderer pure', why: 'The preview runs outside the host.', impact: 'high', at: now - 10000 },
    { decision: 'Reuse the existing cards', why: 'Keep the Overview consistent.', impact: 'medium', at: now - 5000 },
    { decision: 'Use eight preview frames', why: 'A small loop proves animation.', impact: 'low', at: now - 2000 },
  ] },
}
