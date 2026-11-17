import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { ModelSpeeds, SpeedSample } from '../types'
import { at } from './paths'

const modelSpeeds = atom({ plugin: 'agent-overview', key: 'modelSpeeds' } as const, {} as ModelSpeeds)
export const speedKey = (model: string) => model.replace(/\[.*\]$/, '').split('/').pop()!.replace(/-\d{8}$/, '').toLowerCase()
const valid = (s: SpeedSample) => s && Number.isFinite(s.outputTokens) && s.outputTokens >= 200 && Number.isFinite(s.milliseconds) && s.milliseconds >= 2000

export function normalSpeeds(value: unknown): ModelSpeeds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, samples]) => Array.isArray(samples)).map(([key, samples]) => [key, (samples as SpeedSample[]).filter(valid).slice(-20)]))
}

export const withSpeedSample = (all: ModelSpeeds, model: string, sample: SpeedSample): ModelSpeeds =>
  !model || !valid(sample) ? all : { ...all, [speedKey(model)]: [...(all[speedKey(model)] ?? []), sample].slice(-20) }

export function speedOf(all: ModelSpeeds, model: string) {
  const samples = all[speedKey(model)] ?? []
  const milliseconds = samples.reduce((sum, s) => sum + s.milliseconds, 0)
  const rate = milliseconds ? samples.reduce((sum, s) => sum + s.outputTokens, 0) * 1000 / milliseconds : undefined
  return { text: rate === undefined ? '—' : `${Math.round(rate)} tok/s`, dim: samples.length < 3 }
}
export const routingSpeed = (all: ModelSpeeds, model: string) => {
  const { text } = speedOf(all, model)
  return text === '—' ? '' : `, ${text}`
}

export function parseCodexOutput(text: string): number | undefined {
  let output: number | undefined
  for (const line of text.split('\n')) {
    try {
      const event = JSON.parse(line)
      if (event?.type !== 'event_msg' || event.payload?.type !== 'token_count' || !event.payload.info?.total_token_usage) continue
      const value = event.payload.info.total_token_usage.output_tokens
      output = Number.isSafeInteger(value) && value >= 0 ? value : undefined
    } catch {}
  }
  return output
}

export async function codexOutput($: EngineInterface, text: string, startedAt: number, endedAt: number): Promise<number | undefined> {
  const session = /^session id:\s*([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\s*$/im.exec(text)?.[1]
  if (!session) return undefined
  try {
    const home = await $.env.get('CODEX_HOME') || await at($, '.codex')
    const dates = new Set([startedAt, endedAt].map(ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '/')))
    for (const date of dates) {
      const dir = `${home}/sessions/${date}`
      const files = await $.fs.list(dir).catch(() => [])
      const file = files.find(f => f.kind === 'file' && f.name.startsWith('rollout-') && f.name.endsWith(`-${session}.jsonl`))
      if (file) return parseCodexOutput(await $.fs.read(`${dir}/${file.name}`))
    }
  } catch {}
  return undefined
}

export async function loadSpeeds($: EngineInterface) {
  const saved = normalSpeeds(await $.store.get('modelSpeeds2').catch(() => undefined))
  return update($, modelSpeeds, () => saved)
}

// Read again before each write so another session's samples survive.
let writing = Promise.resolve()
export function recordSpeed($: EngineInterface, model: string, outputTokens: number, milliseconds: number) {
  const sample = { outputTokens, milliseconds }
  if (!model || !valid(sample)) return Promise.resolve()
  const pending = writing.then(async () => {
    const stored = await $.store.get('modelSpeeds2').catch(() => undefined)
    const all = stored == null ? await read($, modelSpeeds) : normalSpeeds(stored)
    const next = withSpeedSample(all, model, sample)
    await $.store.set('modelSpeeds2', next)
    await update($, modelSpeeds, () => next)
    $.ui.invalidate('prompt.section')
  })
  writing = pending.catch(() => {})
  return writing
}
