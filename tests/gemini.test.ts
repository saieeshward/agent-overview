import { expect, mock, test } from 'claude-code/testing'
import type { Policy, RouteLogItem } from '../types'
import { geminiArgv, geminiPrompt, isGeminiTemp, parseGemini } from '../hooks/gemini'
import { defaultPolicy } from '../hooks/policy'
import { defaultRouting, routingText } from '../hooks/state'

const P = '/Users/sai/site'
const TMP = '/tmp/ao-gemini.Ab12Cd34'
const OK = (response: string) => `Note: something first\n${JSON.stringify({ conversation_id: 'c', status: 'SUCCESS', response, duration_seconds: 4.5, usage: { input_tokens: 11000, output_tokens: 40 } })}`

test('the CLI call: plan mode, sandbox, time limit and JSON output, from the temp folder only', () => {
  expect(geminiArgv('/bin/agy', 'gemini-3.8-flash-medium', 'hi')).toEqual(['/bin/agy', '--model', 'gemini-3.8-flash-medium', '--sandbox', '--mode', 'plan', '--print-timeout', '240s', '--output-format', 'json', '-p', 'hi'])
  const prompt = geminiPrompt('List the logos.', TMP, ['1-shot.png'], true)
  expect(prompt).toContain(`Open the image ${TMP}/1-shot.png with your file viewing tool (do not run any shell command)`)
  expect(prompt).toContain('Reply with JSON only')
  expect(prompt).toContain('Do not write files, plans or artifacts.')
  expect(isGeminiTemp(TMP)).toBe(true)
  expect(isGeminiTemp('/private/tmp/ao-gemini.Zz99Yy88')).toBe(true)
  for (const bad of ['/tmp', '/', '/tmp/ao-gemini.', '/Users/sai/ao-gemini.Ab12Cd34', '/tmp/ao-gemini.Ab12Cd34/../x', '/tmp/other.Ab12Cd34']) expect(isGeminiTemp(bad)).toBe(false)
})

test('the answer is read after any notice line; failures keep the reason', () => {
  expect(parseGemini(OK('Guinness'))).toEqual({ text: 'Guinness', status: 'SUCCESS', inputTokens: 11000, outputTokens: 40, ms: 4500, denied: undefined, error: undefined })
  expect(parseGemini('', 'Error: -p took "--model" as its prompt')).toMatchObject({ status: 'ERROR', error: 'Error: -p took "--model" as its prompt' })
  expect(parseGemini(JSON.stringify({ status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'Bash' }] }))).toMatchObject({ text: '', denied: ['Bash'] })
})

test('the routing text points visual checks at gemini_run and keeps client material off it', () => {
  const text = routingText(defaultRouting())
  expect(text).toContain('call gemini_run (mcp__agent-overview__gemini_run) directly, no subagent; never with client material')
  expect(routingText({ ...defaultRouting(), role: 'claude' })).not.toContain('gemini_run')
})

function held(on: any, state: Record<string, any>) {
  on('state.get', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); return e.key in state ? { value: { ...r.value, value: state[e.key] } } : r })
  on('state.set', { plugin: 'agent-overview' }, async (_$: any, e: any, next: any) => { const r = await next(e); if (r.value?.isSet) state[e.key] = e.value; return r })
}

test('gemini_run runs agy in a fresh temp folder with copied images, deletes it, and keeps tokens; every refusal is said', async ($, on) => {
  mock.clock(on); mock.store(on)
  mock.env(on, { HOME: '/home/t', PATH: '/usr/bin:/bin' })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'gem' }))
  on('session.cwd', () => ({ value: P }))
  on('fs.stat', (_$: any, e: any) => { if (e.path.endsWith('/.local/bin/agy')) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }; throw new Error('ENOENT') })
  const runs: { argv: string[]; cwd?: string }[] = []
  let answer = OK('- "Restaurant" on the window')
  on('process.run', (_$: any, e: any) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd })
    const [bin] = e.argv
    const out = bin === '/usr/bin/mktemp' ? `${TMP}\n` : String(bin).endsWith('/agy') && e.argv.includes('--sandbox') ? answer : ''
    return { value: { stdout: out, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const state: Record<string, any> = { routing: defaultRouting(), policy: { ...defaultPolicy(), allow: [P] } as Policy, routeLog: [] as RouteLogItem[], confidential: { cwd: P, found: [], sources: [] } }
  held(on, state)
  const call = (input: Record<string, unknown>) => ($.tool as any).call({ tool: 'mcp__agent-overview__gemini_run', tool_use_id: `g${runs.length}:${Object.keys(input).join()}`, sensitivity: 'public', ...input })

  const ran = await call({ prompt: 'List the text in this image.', images: ['/Users/sai/site/shots/front door.jpg'], description: 'sign check' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toBe('- "Restaurant" on the window')
  const agy = runs.find(x => x.argv.includes('--sandbox'))!
  expect(agy.cwd).toBe(TMP)
  expect(agy.argv.slice(1, 10)).toEqual(['--model', 'gemini-3.8-flash-medium', '--sandbox', '--mode', 'plan', '--print-timeout', '240s', '--output-format', 'json'])
  expect(agy.argv.at(-1)).toContain(`${TMP}/1-front_door.jpg`)
  expect(runs.find(x => x.argv[0] === '/bin/cp')!.argv).toEqual(['/bin/cp', '--', '/Users/sai/site/shots/front door.jpg', `${TMP}/1-front_door.jpg`])
  expect(runs.find(x => x.argv[0] === '/bin/rm')!.argv).toEqual(['/bin/rm', '-rf', '--', TMP])
  expect(state.routeLog.at(-1)).toMatchObject({ tool: 'gemini_run', lane: 'gemini', model: 'gemini-3.8-flash-medium', sensitivity: 'public', outcome: 'done', tokens: 11040, ms: 4500, type: 'visual' })

  const before = runs.length
  expect((await call({ prompt: 'x', sensitivity: 'client' })).deny).toContain('client material')
  expect((await call({ prompt: 'x', images: ['/Users/sai/site/client_briefs/board.png'] })).deny).toContain('client_briefs/')
  state.policy = defaultPolicy()
  expect((await call({ prompt: 'x' })).deny).toContain('allowlist')
  state.policy = { ...defaultPolicy(), allow: [P] }
  state.routing = { ...defaultRouting(), agyVisual: false }
  expect((await call({ prompt: 'x', images: ['/a.png'] })).deny).toContain('visual checks off')
  state.routing = { ...defaultRouting(), on: { ...defaultRouting().on, antigravity: false } }
  expect((await call({ prompt: 'x' })).deny).toContain('turned off')
  state.routing = { ...defaultRouting(), role: 'claude' }
  expect((await call({ prompt: 'x' })).deny).toContain('Claude only')
  expect(runs.length).toBe(before)

  // A failed run is a refusal with the CLI's reason, and the temp folder still goes.
  state.routing = defaultRouting()
  answer = JSON.stringify({ status: 'ERROR', error: 'RESOURCE_EXHAUSTED: quota' })
  const failed = await call({ prompt: 'Summarise this public page.' })
  expect(failed.deny).toContain('RESOURCE_EXHAUSTED')
  expect(runs.filter(x => x.argv[0] === '/bin/rm').length).toBe(2)
})
