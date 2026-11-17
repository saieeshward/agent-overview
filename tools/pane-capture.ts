// Copied into an isolated plugin snapshot by pane-preview.ts and run by the real test kit.
import { expect, mock, test } from 'claude-code/testing'
import { fixture, LOG, NOW, PREVIEWS } from './pane-fixtures'
import { CONFIG } from './preview-config'

for (const p of PREVIEWS.filter(p => !CONFIG.scenario || p.scenario === CONFIG.scenario || CONFIG.scenario === 'nits' && p.scenario.startsWith('nits-') || CONFIG.scenario === 'agy-split' && p.scenario.startsWith('agy-split-') || CONFIG.scenario === 'model-picker' && p.scenario.startsWith('model-picker-') || CONFIG.scenario === 'persistent-agents' && /-(all-idle|mixed-working-idle)$/.test(p.scenario) || p.area === CONFIG.scenario || CONFIG.scenario === 'babysitter' && p.scenario.startsWith('babysitter-') || CONFIG.scenario === 'mode-previews' && p.current || CONFIG.scenario === 'routing-guard' && p.scenario.startsWith('routing-guard-'))) {
  test(`preview ${p.area}/${p.tab}/${p.scenario}`, { timeoutMs: 60000 }, async ($, on) => {
    const state = fixture(p)
    mock.clock(on, { now: state.now ?? NOW }); mock.store(on); mock.env(on, { HOME: '/preview' })
    on('fs.read', { path: '/preview/.claude/.ponytail-active' }, () => ({ value: 'full' }))
    on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
    on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
    on('session.id', () => ({ value: 'preview' }))
    on('process.run', (_$, e) => {
      const a = e.argv, empty = !!p.empty
      const stdout = a.includes('--show-toplevel') ? '/repo' : a.includes('log') ? empty ? '' : LOG : a.includes('show') ? a.includes('--numstat') ? '24\t7\thooks/view.tsx\0' : 'diff --git a/hooks/view.tsx b/hooks/view.tsx\n@@ -1 +1 @@\n-old layout\n+readable layout\n' : a.includes('status') ? empty ? '' : '1 .M N... 100644 100644 100644 aaaa bbbb hooks/view.tsx\0? tools/pane-preview.ts\0' : a.includes('--numstat') ? empty ? '' : '24\t7\thooks/view.tsx\0' : ''
      return { value: { stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const toasts: string[] = []
    on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
    for (const surface of ['desktop', 'terminal'] as const) for (const width of CONFIG[surface]) {
      Object.assign(state, fixture(p))
      const columns = surface === 'desktop' ? Math.floor((width - 24) / 8) : width
      const ui = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'Pane', requestId: 'agent-overview', props: {
        title: 'Agent panel', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: surface === 'desktop' ? 43 : 60 }, view: {},
      } })
      if (p.scenario === 'new-task') {
        const qa = [...state.grill]
        await ui.press({ key: 'ship:new' })
        expect(await ui.find({ key: 'plan:q:0' })).toBeUndefined()
        expect(state.grill).toEqual(qa)
      }
      if (p.scenario === 'typed-instructions') {
        await ui.input({ key: 'rev:focus:0', text: 'Check cancellation and races', kind: 'change' })
        await ui.input({ key: 'rev:instructions', text: 'Give reproduction steps', kind: 'change' })
        await ui.input({ key: 'rev:note', text: 'Check every new file before committing', kind: 'change' })
      }
      if (p.target) { await ui.press({ key: `area:${p.target}` }); expect(await ui.find({ key: 'area:confirmation' })).toBeDefined() }
      if (p.scenario.includes('blocked') || p.subagent) {
        await ui.press({ key: `area:${p.area === 'work' ? 'vibe' : 'work'}` })
        expect(await ui.find({ key: 'area:confirmation' })).toBeDefined()
        expect((await ui.find({ key: 'area:confirm' }))?.text).toContain('switch after this turn')
        await ui.press({ key: 'area:confirm' })
        expect(toasts.length).toBeGreaterThan(0)
        expect(state.ui.area).toBe(p.area)
      }
      if (p.confirm) {
        await ui.press({ key: 'area:confirm' })
        expect(await ui.find({ key: `work:${p.stage === 'review' ? 'review' : 'plan'}` })).toBeDefined()
      }
      let tree = await ui.drawn()
      if (p.chat) {
        const ending = await $.ui.mount({ plugin: 'agent-overview', surface, component: 'TurnDuration', props: { word: 'Worked', durationMs: 62000 }, viewport: { columns, rows: 4 } })
        expect(await ending.find({ type: 'Text', text: /Worked for 1m 2s/ })).toBeDefined()
        tree = { type: 'Box', props: { flexDirection: 'column' }, children: [tree, await ending.drawn()] } as any
        await ending.unmount()
      }
      const area = state.ui.pendingArea ?? state.ui.area ?? 'overview'
      console.log('PANE_TREE:' + JSON.stringify({ surface, width, ...p, area, tab: area === 'work' ? state.ui.workTab ?? 'plan' : area === 'vibe' ? state.ui.vibeTab ?? 'live' : state.ui.tab, tree }))
      await ui.unmount()
    }
  })
}
