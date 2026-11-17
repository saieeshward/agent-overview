import type { VibeData } from './engine'

const now = 1792497600000
const busy: VibeData = {
  now,
  hour: 14,
  main: { model: 'claude-opus-5-5', effort: 'high', working: true, lastTool: 'Agent', waiting: false },
  agents: [
    { id: 'codex-1', label: 'Build the pane', provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', state: 'running', startedAt: now - 20000, steps: 12, lastTool: 'Edit', tokens: 18000 },
    { id: 'opencode-1', label: 'Check the parser', provider: 'opencode', model: 'opencode-go/deepseek-v4-pro', effort: 'max', state: 'running', startedAt: now - 14000, steps: 8, lastTool: 'Bash', tokens: 9000 },
    { id: 'agy-1', label: 'Inspect the scene', provider: 'antigravity', model: 'gemini-4-argon-high', effort: 'high', state: 'running', startedAt: now - 3000, steps: 4, lastTool: 'Read', tokens: 5000 },
    { id: 'claude-1', label: 'Check the plan', provider: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', state: 'running', startedAt: now - 16000, steps: 6, lastTool: 'Read', tokens: 2400 },
    { id: 'cc-1', label: 'Write the docs', provider: 'commandcode', model: 'moonshotai/kimi-k3', state: 'running', startedAt: now - 25000, steps: 3, lastTool: 'Write' },
  ],
  edit: { file: 'hooks/view.tsx', added: 24, removed: 7, provider: 'codex' },
  acts: [{ tool: 'Bash', title: 'git diff --check', state: 'done', at: now - 2000, kind: 'bash' }],
  tests: 'pass',
  decisions: [{ decision: 'Keep the scene deterministic', why: 'Both surfaces share the same pixels.', impact: 'medium', at: now - 14000 }],
  usage: [
    { provider: 'claude', on: true, percent: 32, out: false, tag: 'normal' },
    { provider: 'codex', on: true, percent: 42, out: false, tag: 'main' },
    { provider: 'opencode', on: true, percent: 21, out: false, tag: 'normal' },
    { provider: 'antigravity', on: true, percent: 18, out: false, tag: 'normal' },
    { provider: 'commandcode', on: true, percent: 8, out: false, tag: 'normal' },
  ],
  cost: 2.35, ctx: 46, commits: 2, pushes: 1, combo: 14, idle: 0, tps: 85, lines: 128, findings: 0, best: 164,
}

export const FIXTURES: Record<'busy' | 'idle' | 'failing' | 'quota' | 'review' | 'waiting' | 'all-idle' | 'mixed-working-idle', VibeData> = {
  busy,
  'all-idle': { ...busy, main: { ...busy.main, working: false, waiting: false }, agents: [], edit: null, acts: [], decisions: [], tests: null, idle: 180, tps: 0 },
  'mixed-working-idle': { ...busy, main: { ...busy.main, working: false, waiting: false }, agents: busy.agents.map((a, i) => i < 2 ? a : { ...a, state: 'done', endedAt: now - 120000 }), usage: busy.usage.map(u => u.provider === 'commandcode' ? { ...u, tag: 'saver' } : u) },
  idle: { ...busy, hour: 23, main: { ...busy.main, working: false, waiting: true }, agents: [], edit: null, acts: [], decisions: [], tests: null, idle: 180, tps: 0 },
  waiting: { ...busy, hour: 8, main: { ...busy.main, working: false, waiting: true, lastTool: 'AskUserQuestion' }, agents: [], edit: null, acts: [], decisions: [], tests: null, idle: 40, tps: 0 },
  failing: { ...busy, hour: 10, agents: busy.agents.map((a, i) => i === 0 ? { ...a, state: 'failed', endedAt: now - 1000 } : a), acts: [
    { tool: 'Bash', title: 'npm run build', state: 'failed', at: now - 4000, kind: 'bash' },
    { tool: 'Bash', title: 'npm test', state: 'failed', at: now - 1000, kind: 'test', tests: 'fail' },
  ], tests: 'fail', combo: 0 },
  quota: { ...busy, ctx: 91, usage: busy.usage.map(u => u.provider === 'codex' ? { ...u, percent: 96, out: true, tag: 'normal' } : u.provider === 'claude' ? { ...u, tag: 'saver' } : u.provider === 'opencode' ? { ...u, tag: 'main' } : { ...u }) },
  review: { ...busy, hour: 18, findings: 7, tests: null, acts: [
    { tool: 'Bash', title: 'git commit -m "Polish Agent HQ"', state: 'done', at: now - 12000, kind: 'bash' },
    { tool: 'Bash', title: 'git push origin work-vibe', state: 'done', at: now - 3000, kind: 'bash' },
  ], decisions: [
    { decision: 'Keep the renderer pure', why: 'The preview runs outside the host.', impact: 'low', at: now - 24000 },
    { decision: 'Reuse the existing cards', why: 'Keep Default consistent.', impact: 'medium', at: now - 15000 },
    { decision: 'Preserve the arcade contract', why: 'The other scene is being built in parallel.', impact: 'high', at: now - 2000 },
  ] },
}
