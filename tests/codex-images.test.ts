import { expect, mock, test } from 'claude-code/testing'

import type { Guard } from '../types'
import { HOW, defaultRouting, normalGuard, routingText, withFlags, withPicks } from '../hooks/state'

test('Codex images defaults to on, preserves saved modes and rejects unknown values', async () => {
  expect(normalGuard(undefined).codexImages).toBe('on')
  for (const codexImages of ['off', 'on', 'force'] as const) expect(normalGuard({ codexImages }).codexImages).toBe(codexImages)
  for (const codexImages of [null, true, 1, '', 'invalid']) expect(normalGuard({ codexImages }).codexImages).toBe('on')
})

test('image routing uses the first live Codex model and stays silent when Codex cannot run', async () => {
  const r = withPicks(defaultRouting(), [
    { provider: 'opencode', model: 'other' },
    { provider: 'codex', model: 'first', effort: 'high' },
    { provider: 'codex', model: 'second' },
  ])
  const onText = `Codex can generate images with its built-in image tool: run ${HOW.codex('first', 'high')} with a prompt like "Use your image generation tool to make <the image>; save it as <name>.png in <folder>". Use it when an image is asked for and no better-suited tool is named.`
  for (const role of ['auto', 'plan'] as const) {
    expect(routingText({ ...r, role })).toContain(onText)
    expect(routingText({ ...r, role }, {}, [], { codexImages: 'on' })).toContain(onText)
    const forced = routingText({ ...r, role }, {}, [], { codexImages: 'force' })
    expect(forced).toContain(onText)
    expect(forced).toContain("The owner set image generation to Codex: for every image you are asked to create, use Codex's built-in image tool as above (not other image tools), save the file where the owner wants it, and say where it is.")
    const off = routingText({ ...r, role }, {}, [], { codexImages: 'off' })
    expect(off).toContain("Do not use Codex's image generation (turned off by the owner); Codex runs get `--disable image_generation`.")
    expect(off.includes('Codex can generate images')).toBe(false)
  }
  const fallback = { ...defaultRouting(), models: { ...defaultRouting().models, codex: ['fallback'] } }
  expect(routingText(fallback)).toContain(`built-in image tool: run ${HOW.codex('fallback')}`)
  for (const codexImages of ['off', 'on', 'force'] as const) {
    for (const disabled of [{ ...r, on: { ...r.on, codex: false } }, { ...r, role: 'claude' as const }]) {
      const text = routingText(disabled, {}, [], { codexImages })
      expect(/image generation|generate images|image_generation/.test(text)).toBe(false)
    }
  }
})

test('withFlags disables Codex images once, respecting existing disables and quoted prompts', async () => {
  const pick = { disable: ['image_generation', 'image_generation'] }
  for (const program of ['codex exec', 'codex e', 'codex --cd "x y" exec']) {
    const changed = `${program} --disable image_generation < /dev/null "task"`
    expect(withFlags(`${program} "task"`, 'codex', pick)).toBe(changed)
    expect(withFlags(changed, 'codex', pick)).toBe(changed)
    for (const flag of ['--disable image_generation', '--disable=image_generation', '--disable "image_generation"']) {
      const existing = `${program} < /dev/null ${flag} "task"`
      expect(withFlags(existing, 'codex', pick)).toBe(existing)
    }
  }
  expect(withFlags('codex exec "mention --disable image_generation"', 'codex', pick)).toBe('codex exec --disable image_generation < /dev/null "mention --disable image_generation"')
  expect(withFlags('codex exec --disable other "task"', 'codex', pick)).toBe('codex exec --disable image_generation < /dev/null --disable other "task"')
  expect(withFlags('codex exec "task"', 'codex', { model: 'first', effort: 'high', ...pick })).toBe('codex exec -m first -c model_reasoning_effort=high --disable image_generation < /dev/null "task"')
  expect(withFlags('opencode run "task"', 'opencode', pick)).toBe('opencode run "task"')
  expect(withFlags('echo "codex exec task"', 'codex', pick)).toBe('echo "codex exec task"')
})

test('Codex image generation is controlled only in Settings in Default', async ($, on) => {
  mock.clock(on)
  let saved = normalGuard(undefined)
  on('store.set', { key: 'guard' }, (_$, e, next) => { saved = e.value as Guard; return next(e) })
  mock.store(on)
  const invalidated: string[] = []
  on('ui.invalidate', (_$, e) => { invalidated.push(e.event); return { value: undefined } })
  const ui = await $.ui.mount({ plugin: 'agent-overview', surface: 'terminal', component: 'Pane', requestId: 'agent-overview', props: {
    title: 'Overview', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {},
  } })
  expect(await ui.find({ key: 'cimg:dashboard:force' })).toBeUndefined()
  await ui.press({ key: 'tab:plugins' })
  expect(await ui.find({ key: 'cimg:plugins:force' })).toBeUndefined()
  await ui.press({ key: 'tab:settings' })
  for (const mode of ['force', 'off', 'on'] as const) {
    await ui.press({ key: `cimg:settings:${mode}` })
    expect(saved.codexImages).toBe(mode)
    expect((await ui.find({ key: `cimg:settings:${mode}` }))?.children[0]).toMatchObject({ props: { inverse: true } })
  }
  expect(invalidated.filter(e => e === 'prompt.section').length).toBe(3)
  await ui.unmount()
})

test('Bash applies the saved image mode to Codex runs and leaves other providers alone', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let g = normalGuard(undefined)
  on('state.get', { plugin: 'agent-overview', key: 'guard' }, () => ({ value: { value: g, version: 1 } }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
  let seen = ''
  on('tool.call', (_$, e) => { seen = String((e as any).command); return { result: 'ok' } })
  for (const codexImages of ['off', 'on', 'force'] as const) {
    g = normalGuard({ codexImages })
    for (const command of ['codex exec "task"', 'codex e --disable image_generation "task"', 'opencode run "task"']) {
      await ($.tool as any).call({ tool: 'Bash', tool_use_id: `${codexImages}:${command}`, command })
      expect(seen).toBe(codexImages === 'off' && command === 'codex exec "task"' ? 'codex exec --disable image_generation < /dev/null "task"' : command.startsWith('codex ') ? command.replace(/(codex (?:exec|e))/, '$1 < /dev/null') : command)
    }
  }
})
