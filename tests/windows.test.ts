import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { locate } from '../hooks/providers'
import { at, isAbsolute, tempDir } from '../hooks/paths'

// A Windows host: USERPROFILE and TEMP with backslashes, no HOME, PATH split by ';'.
const win = (files: string[]) => ({
  env: { get: async (name: string) => ({ USERPROFILE: 'C:\\Users\\test', TEMP: 'C:\\Users\\test\\AppData\\Local\\Temp', PATH: 'C:\\Windows;C:\\Windows\\System32' } as Record<string, string>)[name] },
  clock: { now: async () => 1 },
  fs: {
    stat: async (path: string) => { if (!files.includes(path)) throw new Error(`ENOENT: no such file or directory, stat '${path}'`); return { kind: 'file', size: 1, mtimeMs: 0, isLink: false } },
    list: async () => [],
  },
} as unknown as EngineInterface)

test('Windows: home comes from USERPROFILE, drive paths are absolute, temp comes from TEMP', async () => {
  const api = win([])
  for (const p of ['C:/x', 'C:\\x', '/usr/bin', 'd:/y']) expect(isAbsolute(p)).toBe(true)
  for (const p of ['.local/bin', 'AppData/Roaming/npm']) expect(isAbsolute(p)).toBe(false)
  expect(await at(api, '.gemini/bin')).toBe('C:/Users/test/.gemini/bin')
  expect(await at(api, 'C:/Program Files/nodejs')).toBe('C:/Program Files/nodejs')
  expect(await tempDir(api)).toBe('C:/Users/test/AppData/Local/Temp')
})

test('Windows: the agy CLI is found as agy.exe in ~/.gemini/bin', async () => {
  expect(await locate(win(['C:/Users/test/.gemini/bin/agy.exe']), 'agy')).toBe('C:/Users/test/.gemini/bin/agy.exe')
})
