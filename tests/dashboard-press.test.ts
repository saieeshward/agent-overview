import { expect, mock, test } from 'claude-code/testing'

import { blank, defaultRouting } from '../hooks/state'
import type { Providers } from '../types'

const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, isCollapsed: false, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`dashboard tiles and usage rows open what they show; uninstalled providers are named (${surface})`, { timeoutMs: 60000 }, async ($, on) => {
    mock.clock(on, { now: 1000 }); mock.store(on)
    const providers = Object.fromEntries(['claude', 'codex', 'opencode', 'commandcode', 'antigravity'].map(p => [p, { ...blank(), status: 'ok' }])) as Providers
    providers.claude = { ...providers.claude, meters: [{ label: '5-hour', percent: 14 }] }
    providers.codex = { ...blank(), status: 'missing', error: 'not installed on this Mac' }
    const routing = { ...defaultRouting(), on: { claude: true, codex: true, opencode: true, commandcode: true, antigravity: true } }
    const state: Record<string, any> = { providers, routing }
    on('state.get', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } as any : r })
    on('state.set', { plugin: 'agent-overview' }, async (_$, e, next) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await ($.tool.call as any)({ tool: 'Edit', tool_use_id: 'e1', file_path: '/x/f.ts', old_string: 'a', new_string: 'b\nc' })

    const ui = await $.ui.mount({ plugin: 'agent-overview', surface, ...PANE, props })
    // A provider that is not installed is named, and one press opens its page with the reason.
    expect(await ui.find({ key: 'usage:missing' })).toBeDefined()
    await ui.press({ key: 'usage:open:codex' })
    expect(state.ui).toMatchObject({ tab: 'models', editing: 'codex' })
    expect(await ui.find({ type: 'Text', text: /Codex is not installed on this Mac/ })).toBeDefined()
    expect(await ui.find({ key: 'recheck:codex' })).toBeDefined()

    // Back on the dashboard, a provider's usage row opens that provider.
    await ui.press({ key: 'tab:dashboard' })
    await ui.press({ key: surface === 'desktop' ? 'usage:open:claude' : 'usage:open:claude:5h' })
    expect(state.ui).toMatchObject({ tab: 'models', editing: 'claude' })

    // The tiles lead to what they count.
    await ui.press({ key: 'tab:dashboard' })
    await ui.press({ key: 'tile:lines:open' })
    expect(state.ui.tab).toBe('activity')
    await ui.press({ key: 'tab:dashboard' })
    await ui.press({ key: 'tile:files:open' })
    expect(state.ui.tab).toBe('activity')
    await ui.unmount()
  })
}
