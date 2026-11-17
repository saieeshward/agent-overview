import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { EditItem } from '../types'

const result = (stdout = '', exitCode = 0) => ({ value: { stdout, exitCode, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const editState = (on: On, initial: EditItem[] = []) => {
  let items = initial
  let version = 0
  on('state.get', { plugin: 'agent-overview', key: 'edits' }, () => ({ value: { value: items, version } }))
  on('state.set', { plugin: 'agent-overview', key: 'edits' }, (_$, e) => {
    items = e.value
    return { value: { isSet: true, version: ++version } }
  })
  return () => items
}
const PANE = { component: 'Pane', requestId: 'agent-overview' } as const
const props = { title: 'Overview', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} }

test('failed or timed-out snapshots never fall back to HEAD or queue changes', async ($, on) => {
  mock.clock(on)
  const getEdits = editState(on)
  const calls: string[][] = []
  let timeout = false
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (e.argv.includes('--show-toplevel')) return result('/repo\n')
    if (e.argv.includes('stash')) {
      if (timeout) throw new Error('timeout')
      return result('', 1)
    }
    return result()
  })
  on('tool.call', () => ({ result: 'ok' }))
  for (const id of ['failed', 'timeout']) {
    await ($.tool as any).call({ tool: 'Bash', tool_use_id: id, command: 'opencode run "fix"' })
    timeout = true
  }
  expect(calls.filter(x => x.includes('stash')).length).toBe(2)
  expect(calls.some(x => x.includes('HEAD') || x.includes('diff'))).toBe(false)
  expect(getEdits()).toEqual([])
})

test('background shells leave tracking and review to the process poll', async ($, on) => {
  mock.clock(on)
  const calls: string[][] = []
  const toasts: string[] = []
  on('process.run', (_$, e) => { calls.push([...e.argv]); return result() })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('tool.call', () => ({ result: 'ok' }))
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'background', command: 'opencode run "fix"', run_in_background: true })
  expect(calls.some(x => x.includes('stash') || x.includes('diff') || x.includes('--show-toplevel'))).toBe(false)
  expect(toasts).toEqual([])
})

test('reviews use the run directory, NUL paths, base existence and Git fingerprints', async ($, on) => {
  mock.clock(on)
  const getEdits = editState(on)
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: { caps: {}, review: true }, version: 1 } }))
  let listed = false
  let rootCwd: string | undefined
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    const a = e.argv
    calls.push([...a])
    if (a.includes('--show-toplevel')) { rootCwd = e.init?.cwd; return result('/repo\n') }
    if (a.includes('stash')) return result() // Clean tracked tree.
    if (a.includes('HEAD')) return result('base\n')
    if (a.includes('ls-files')) {
      // Before the run: ignored paths come as their own (folder-level) listing.
      if (a.includes('--ignored')) { expect(a.includes('--directory')).toBe(true); return result('ignored.txt\0') }
      if (!listed) { listed = true; return result('old.txt\0') }
      return result('ignored.txt\0old.txt\0résumé space.txt\0résumé space.txt\0back.txt\0')
    }
    if (a.includes('diff')) return result('tracked space.txt\0tracked space.txt\0')
    if (a.includes('cat-file')) return result('', a[a.length - 1]!.endsWith(':résumé space.txt') ? 1 : 0)
    if (a.includes('show')) return result('before\n')
    if (a.includes('hash-object')) return result('git-hash\n')
    return result()
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: 'after\n' }))
  on('tool.call', () => ({ result: 'ok' }))
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'paths', command: 'cd ../work && opencode run "fix"' })
  expect(rootCwd).toBe('../work')
  const items = getEdits()
  expect(items.map(x => [x.path, x.isNew, x.afterHash])).toEqual([
    ['tracked space.txt', false, 'git-hash'], ['résumé space.txt', true, 'git-hash'], ['back.txt', false, 'git-hash'],
  ])
  expect(calls.filter(x => x.includes('ls-files') || x.includes('--name-only')).every(x => x.includes('-z'))).toBe(true)
})

test('revert stays pending on unverifiable, changed or failed restores, then uses git restore', async ($, on) => {
  mock.clock(on)
  let hash = result('later\n')
  let restore = result('', 1)
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    return e.argv.includes('hash-object') ? hash : restore
  })
  const item: EditItem = { file: '/repo/file.txt', path: 'file.txt', repo: '/repo', base: 'base', afterHash: 'end', at: 1, review: 'pending', lines: [] }
  const getEdits = editState(on, [item])
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  const undo = 'rev:undo:/repo/file.txt:1'
  await ui.press({ key: undo })
  expect((getEdits())[0]!.review).toBe('pending')
  expect(calls.length).toBe(1)
  hash = result('', 1)
  await ui.press({ key: undo })
  expect((getEdits())[0]!.review).toBe('pending')
  expect(calls.length).toBe(2)
  hash = result('end\n')
  await ui.press({ key: undo })
  expect((getEdits())[0]!.review).toBe('pending')
  restore = result()
  await ui.press({ key: undo })
  expect((getEdits())[0]!.review).toBe('reverted')
  expect(calls[calls.length - 1]).toEqual(['git', '-C', '/repo', 'restore', '--source=base', '--worktree', '--', 'file.txt'])
  await ui.unmount()
})

test('new-file deletion checks its exit code and preserves the pending item on failure', async ($, on) => {
  mock.clock(on)
  const calls: string[][] = []
  let code = 1
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    return e.argv.includes('hash-object') ? result('end\n') : result('', code)
  })
  const getEdits = editState(on, [{ file: '/repo/new.txt', path: 'new.txt', repo: '/repo', base: 'base', afterHash: 'end', at: 1, isNew: true, review: 'pending', lines: [] }])
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'rev:undo:/repo/new.txt:1' })
  expect((getEdits())[0]!.review).toBe('pending')
  code = 0
  await ui.press({ key: 'rev:undo:/repo/new.txt:1' })
  expect((getEdits())[0]!.review).toBe('reverted')
  expect(calls[calls.length - 1]).toEqual(['/bin/rm', '-f', '--', '/repo/new.txt'])
  await ui.unmount()
})

test('a run queues forty unique files and names the overflow in its toast', async ($, on) => {
  mock.clock(on)
  const getEdits = editState(on)
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: { caps: {}, review: true }, version: 1 } }))
  const toasts: string[] = []
  const paths = Array.from({ length: 43 }, (_, i) => `file ${i}.txt`)
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('process.run', (_$, e) => {
    const a = e.argv
    if (a.includes('--show-toplevel')) return result('/repo\n')
    if (a.includes('stash')) return result('123456789abcdef\n')
    if (a.includes('diff')) return result([...paths, paths[0]].join('\0') + '\0')
    if (a.includes('hash-object')) return result('end\n')
    if (a.includes('show')) return result('before\n')
    return result()
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: 'after\n' }))
  on('tool.call', () => ({ result: 'ok' }))
  await ($.tool as any).call({ tool: 'Bash', tool_use_id: 'overflow', command: 'opencode run "fix"' })
  expect(getEdits().length).toBe(40)
  expect(toasts.some(t => t.includes('· 3 more not listed, see git diff 12345678'))).toBe(true)
})


test('a file the run deleted comes back from the snapshot, only while nothing has replaced it', async ($, on) => {
  mock.clock(on)
  const calls: string[][] = []
  let present = true
  on('fs.exists', () => ({ value: present }))
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    return result()
  })
  const getEdits = editState(on, [{ file: '/repo/gone.txt', path: 'gone.txt', repo: '/repo', base: 'base', gone: true, at: 1, review: 'pending', lines: [] }])
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', ...PANE, props })
  await ui.press({ key: 'rev:undo:/repo/gone.txt:1' })
  expect((getEdits())[0]!.review).toBe('pending')
  expect(calls.length).toBe(0)
  present = false
  await ui.press({ key: 'rev:undo:/repo/gone.txt:1' })
  expect((getEdits())[0]!.review).toBe('reverted')
  expect(calls[calls.length - 1]).toEqual(['git', '-C', '/repo', 'restore', '--source=base', '--worktree', '--', 'gone.txt'])
  await ui.unmount()
})
