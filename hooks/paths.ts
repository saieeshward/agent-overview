import type { EngineInterface } from 'claude-code'

let home = ''
async function homeDir($: EngineInterface) {
  return (home ||= (await $.env.get('HOME')) ?? '')
}
export async function at($: EngineInterface, path: string) {
  return path.startsWith('/') ? path : `${await homeDir($)}/${path}`
}
