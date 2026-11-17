import { expect, test } from 'claude-code/testing'
import type { AgentNode } from '../types'
import { defaultRouting, normalGuard } from '../hooks/state'
import { C, officeStates, officeSvg } from '../hooks/office-rail'

const AGENTS = ['heads', 'dock', 'peek', 'line', 'ticker'] as const

test('office defaults to Slim and migrates missing or invalid old guard values', () => {
  for (const saved of [undefined, null, {}, { chat: { sounds: true } }, { chat: { office: 'bad' } }, { chat: { office: false } }]) {
    expect(normalGuard(saved).chat.office).toBe('slim')
  }
  for (const office of ['off', 'slim', 'glass', ...AGENTS] as const) expect(normalGuard({ chat: { office } }).chat.office).toBe(office)
})

test('agents-only rails keep fixed pixel art, discrete SMIL, grey idle palettes and no off providers', () => {
  for (const style of AGENTS) for (const width of [420, 700, 1000, 4000]) {
    const source = officeSvg(style, ['working', 'idle', 'off', 'off', 'off'], width)
    const root = source.slice(0, source.indexOf('>'))
    expect(source.length).toBeLessThanOrEqual(131072)
    expect(root).toContain(`height="${({ heads: 20, dock: 24, peek: 16, line: 24, ticker: 20 })[style]}"`)
    expect(root).toContain('shape-rendering="crispEdges"')
    expect(source).toContain('transform="scale(2)"')
    expect(source).toContain('data-provider="claude" data-state="working"')
    expect(source).toContain(`fill="${C.claude}"`)
    expect(source).toContain('calcMode="discrete"')
    for (const provider of ['antigravity', 'opencode', 'commandcode']) expect(source).not.toContain(`data-provider="${provider}"`)
    if (style === 'ticker') {
      expect(source).not.toContain('data-provider="codex"')
    } else {
      expect(source).toContain('data-provider="codex" data-state="idle"')
      expect(source).toContain('fill="rgb(93,93,97)"') // Approved GREY(#10a37f).
      expect(source).not.toContain(`fill="${C.codex}"`)
    }
    if (style === 'line' || style === 'ticker') {
      expect(root).not.toContain('viewBox')
      expect(source).toContain('<svg width="50%"')
      expect(source).toContain('%"')
    } else expect(root).toContain(`preserveAspectRatio="${style === 'dock' ? 'xMidYMin' : 'xMinYMin'} slice"`)
  }
})

test('agents-only animation belongs only to present agents, including grey strolling idle agents', () => {
  for (const style of AGENTS) {
    for (const state of ['working', 'idle', 'off'] as const) {
      const source = officeSvg(style, [state, state, state, state, state])
      expect(source.length).toBeLessThanOrEqual(131072)
      const count = (source.match(/data-provider=/g) ?? []).length
      expect(count).toBe(state === 'off' ? 0 : style === 'ticker' && state === 'idle' ? 1 : 5)
      expect(source.includes('<animate')).toBe(state === 'working' || style === 'line' && state === 'idle')
      if (state === 'idle') {
        expect(source).toContain('rgb(')
        expect(source).not.toContain(`fill="${C.claude}"`)
      }
    }
    for (let i = 0; i < 5; i++) {
      const states: ReturnType<typeof officeStates> = ['off', 'off', 'off', 'off', 'off']
      states[i] = 'working'
      const source = officeSvg(style, states)
      expect((source.match(/data-provider=/g) ?? []).length).toBe(1)
      expect(source).toContain('calcMode="discrete"')
    }
  }
  expect(officeSvg('ticker', ['off', 'idle', 'idle', 'idle', 'idle'])).not.toContain('data-provider=')
})

test('office uses main working and visible driven runs; disabled and paused providers are absent', () => {
  const r = defaultRouting()
  const run: AgentNode = { id: 'side', label: 'Build', kind: 'Codex', provider: 'codex', model: 'gpt', state: 'running', steps: 1, parentId: 'driver-agent' }
  const driver: AgentNode = { id: 'driver', label: 'Drive', agentId: 'driver-agent', kind: 'task', provider: 'claude', model: 'sonnet', state: 'running', steps: 1 }
  const workflow: AgentNode = { ...run, id: 'workflow', kind: 'workflow', provider: 'opencode' }
  expect(officeStates(r, { model: 'opus' }, [driver, run, workflow])).toEqual(['idle', 'working', 'idle', 'idle', 'idle'])
  r.on.codex = false
  r.paused = { antigravity: { why: 'quota', at: 1, until: 100 } }
  expect(officeStates(r, { model: 'opus', working: true }, [driver, run])).toEqual(['working', 'off', 'off', 'idle', 'idle'])
  r.on.claude = false
  expect(officeStates(r, { model: 'opus', working: true }, [driver, run])[0]).toBe('off')
  expect(officeStates(defaultRouting(), { model: 'opus' }, [{ ...run, state: 'done' }])[1]).toBe('idle')
})

test('both rail drawings fit the source cap, keep the lounge at the right end and animate only present mascots', () => {
  for (const style of ['slim', 'glass'] as const) {
    for (const state of ['idle', 'working', 'off'] as const) {
      const source = officeSvg(style, [state, state, state, state, state])
      expect(source.length).toBeLessThanOrEqual(131072)
      expect(source).toContain(`viewBox="0 0 192 ${style === 'glass' ? 30 : 20}"`)
      expect(source).toContain('shape-rendering="crispEdges"')
      expect(source).toContain('translate(150 0)')
      expect(source.includes('<animate')).toBe(state !== 'off')
      expect(source.includes('calcMode="discrete"')).toBe(state !== 'off')
      expect((source.match(/<animateTransform/g) ?? []).length).toBe(state === 'off' ? 0 : 5)
      expect(source.includes('keyTimes="0;0.5;1"')).toBe(state === 'working')
      expect(source.includes('#10a37f30')).toBe(style === 'glass' && state === 'working')
    }
  }
})
