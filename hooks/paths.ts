import type { EngineInterface } from 'claude-code'

let home = ''
// Windows has USERPROFILE (C:\Users\x) where macOS has HOME; paths here use forward slashes, which Windows accepts.
async function homeDir($: EngineInterface) {
  return (home ||= ((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/\\/g, '/'))
}
export const isAbsolute = (path: string) => /^([A-Za-z]:)?[\\/]/.test(path)
export async function at($: EngineInterface, path: string) {
  return isAbsolute(path) ? path : `${await homeDir($)}/${path}`
}
// The system temp folder: TEMP on Windows, else /tmp.
export async function tempDir($: EngineInterface) {
  return ((await Promise.resolve().then(() => $.env.get('TEMP')).catch(() => undefined)) || '/tmp').replace(/\\/g, '/')
}
