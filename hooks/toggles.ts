import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { emitVibe } from './vibe/events'
import type { Mode } from '../types'

// Keys: 'plugin:ponytail', 'skill:ponytail:ponytail-audit', 'server:antigravity', 'tool:mcp__antigravity__gemini_visual_qa'.
export const DEFAULT_PINS = ['plugin:ponytail', 'tool:mcp__antigravity__gemini_visual_qa']

// Text a plugin injects through its own hooks, so OFF can drop it.
export const MARKS: Record<string, RegExp> = { ponytail: /PONYTAIL (MODE|DEFAULT)/ }

// A skill's mode: its own switch, else its plugin's, else on. "ponytail-audit" and "ponytail:ponytail-audit" both work.
export const skillMode = (t: Record<string, Mode>, name: string, pluginOf: (bare: string) => string | undefined = () => undefined): Mode => {
  const n = name.replace(/^\//, '')
  const full = n.includes(':') ? n : pluginOf(n) ? `${pluginOf(n)}:${n}` : n
  const plugin = full.includes(':') ? full.split(':')[0] : undefined
  return t[`skill:${full}`] ?? (plugin ? t[`plugin:${plugin}`] : undefined) ?? 'on'
}

// A tool's mode: its own switch, else its server's, else on.
export const toolMode = (t: Record<string, Mode>, name: string): Mode => {
  const server = /^mcp__(.+?)__(.+)$/.exec(name)?.[1]
  return t[`tool:${name}`] ?? (server ? t[`server:${server}`] : undefined) ?? 'on'
}

// The skill listing without the entries that are off (and their continuation lines).
export const filterListing = (text: string, isOff: (name: string) => boolean) => {
  let keep = true
  return text
    .split('\n')
    .filter(l => {
      const m = /^- (.+?)(?:: |$)/.exec(l)
      if (m) keep = !isOff(m[1]!)
      return keep
    })
    .join('\n')
}

// Server instructions end at the next level-two heading; keep any preamble.
export const dropServerBlocks = (text: string, isOff: (server: string) => boolean) => {
  return text.split(/(?=^## )/m).filter(block => {
    const server = /^## ([^\r\n]*)/.exec(block)?.[1]
    return server === undefined || !isOff(server.trim())
  }).join('')
}

export const forcedText = (t: Record<string, Mode>) => {
  const forced = Object.entries(t).filter(([, m]) => m === 'force').map(([k]) => k)
  if (!forced.length) return ''
  const line = (k: string) =>
    k.startsWith('skill:')
      ? `- Skill \`${k.slice(6)}\`: call the Skill tool with skill "${k.slice(6)}" before any task it covers.`
      : k.startsWith('tool:')
        ? `- Tool \`${k.slice(5)}\`: use it for every task it covers (load it with ToolSearch "select:${k.slice(5)}" if needed).`
        : k.startsWith('server:')
          ? `- Tools of the \`${k.slice(7)}\` MCP server (mcp__${k.slice(7)}__*): use them for every task they cover (load them with ToolSearch "+${k.slice(7)}" if needed).`
          : `- Plugin \`${k.slice(7)}\`: use its skills and tools whenever they apply.`
  return `Owner-forced features for this session, set in the agent panel. Use them explicitly and say in one line when you did:\n${forced.map(line).join('\n')}`
}

export const offText = (t: Record<string, Mode>) => {
  const off = Object.entries(t).filter(([, m]) => m === 'off').map(([k]) => {
    const name = k.replace(/^(plugin|skill|tool|server):/, '')
    const prefix = k.startsWith('plugin:') ? `skill:${name}:` : k.startsWith('server:') ? `tool:mcp__${name}__` : undefined
    const exceptions = prefix ? Object.entries(t).filter(([child, mode]) => child.startsWith(prefix) && mode !== 'off').map(([child]) => child.replace(/^(skill|tool):/, '')) : []
    return name + (exceptions.length ? ` (except ${exceptions.join(', ')}, explicitly enabled)` : '')
  })
  return off.length ? `Turned off by the owner for this session, do not use and ignore any earlier instructions they injected: ${off.join(', ')}.` : ''
}

const toggles = atom({ plugin: 'agent-overview', key: 'toggles' } as const, {} as Record<string, Mode>)
export async function setToggle($: EngineInterface, key: string, mode: Mode) {
  await update($, toggles, t => {
    const next = { ...t, [key]: mode }, plugin = /^skill:([^:]+):/.exec(key)?.[1]
    if (plugin && mode === (t[`plugin:${plugin}`] ?? 'on')) delete next[key]
    return next
  })
  $.ui.invalidate('prompt.attachment')
  $.ui.invalidate('tool.describe')
  $.ui.invalidate('prompt.section')
  await emitVibe($, { kind: 'powerup', key, mode })
}
export const cyclePowerup = (mode: Mode): Mode => mode === 'on' ? 'force' : mode === 'force' ? 'off' : 'on'
export const toggleMode = (t: Record<string, Mode>, key: string): Mode => key.startsWith('tool:') ? toolMode(t, key.slice(5)) : key.startsWith('skill:') ? skillMode(t, key.slice(6)) : t[key] ?? 'on'
