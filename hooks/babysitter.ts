import type { AgentNode, EditItem, HistoryItem } from '../types'
import { providerOf } from './state'

export const BABYSITTER_MODEL = 'claude-sonnet-5-5'

// Require delegation and a return instruction; reject any work assigned to the driver itself.
export function babysitting(prompt: string): boolean {
  const text = prompt.replace(/\s+/g, ' ').trim()
  const side = /\bcodex\s+exec\b|\bopencode\s+run\b|\b(?:cmd|cmdc|commandcode|command-code)(?:\s+[^;\n]*?)?\s+(?:-p|--print)\b|\bcommand-code\/dist\/index\.mjs\b[^;\n]*\s-p\b|\bCommand Code(?: CLI)?\b[^;]*\s-p\b|\bgemini_(?:bounded_task|visual_qa|media_task)\b|\bollama_run\b|\bollama\s+run\b/i.test(text)
  const handoff = /\b(?:run|ask|hand\s+(?:off\s+)?to|delegate\s+to)\s+(?:the\s+)?(?:Codex|OpenCode|Command Code|Antigravity|Ollama)\b/i.test(text)
  const report = /\b(?:report|return|relay|summari[sz]e|wait|check what comes back)\b/i.test(text)
  const ownWork = /\b(?:also|then|yourself|directly|personally|you must|you should|you will)\b[^.!?;]{0,90}\b(?:implement|code|coding|edit|write|fix|refactor|patch|build|test)\b|\b(?:implement|code|edit|write|fix|refactor|patch|build|test)\b[^.!?;]{0,60}\b(?:yourself|personally|directly)\b/i.test(text)
  const ownTask = /(?:^|[.!?;])\s*(?:(?:also|then|please)\s+)*(?:implement|code|edit|write|fix|refactor|patch|build|test)\b/i.test(text)
  const informational = /^(?:explain|document|describe|compare|summari[sz]e)\b/i.test(text)
  const negated = /\b(?:do not|don't|never)\s+(?:run|ask|use|delegate|hand)\b/i.test(text)
  return (side || handoff) && report && !ownWork && !ownTask && !informational && !negated
}

const tier = (model: string) => /(?:^|[-/])haiku(?:[-/]|$)/i.test(model) ? 0 : /(?:^|[-/])sonnet(?:[-/]|$)/i.test(model) ? 1 : /(?:^|[-/])opus(?:[-/]|$)/i.test(model) ? 2 : undefined
export function babysitterModel(prompt: string, explicit: string | undefined, selected = BABYSITTER_MODEL): string | undefined {
  if (!babysitting(prompt)) return undefined
  if (explicit === selected || explicit && tier(explicit) !== undefined && tier(selected) !== undefined && tier(explicit)! <= tier(selected)!) return explicit
  return selected
}

export function babysitterDrivers(list: AgentNode[], edits: EditItem[] = []): Map<string, AgentNode> {
  const drivers = list.filter(n => n.agentId && (n.provider ?? providerOf(n.model)) === 'claude' && !n.ownEdits
    && !n.trail?.some(t => /^(?:Edit|Write|MultiEdit|NotebookEdit)$/.test(t.tool))
    && !edits.some(e => e.agent === n.agentId))
  const byChild = new Map<string, AgentNode>()
  for (const child of list) {
    if (!child.provider || child.provider === 'claude' || child.kind === 'workflow') continue
    const driver = drivers.find(n => child.parentNode === n.id || child.parentId === n.agentId || child.parentId === n.id)
    if (driver) byChild.set(child.id, driver)
  }
  return byChild
}

export function displayAgents(list: AgentNode[], edits: EditItem[] = []): AgentNode[] {
  const drivers = babysitterDrivers(list, edits)
  const hidden = new Set([...drivers.values()].map(n => n.id))
  const byId = new Map(list.map(n => [n.id, n]))
  return list.filter(n => !hidden.has(n.id)).map(n => {
    const driver = drivers.get(n.id)
    let parentNode = n.parentNode ?? driver?.parentNode
    const seen = new Set<string>()
    while (parentNode && hidden.has(parentNode) && !seen.has(parentNode)) {
      seen.add(parentNode)
      parentNode = byId.get(parentNode)?.parentNode
    }
    return { ...n, ...(driver ? { label: driver.label || n.label, run: driver.run ?? n.run } : {}), parentNode }
  })
}

// Also project history written by older versions while its source nodes are still available.
export function displayHistory(items: HistoryItem[], list: AgentNode[], edits: EditItem[] = []): HistoryItem[] {
  const shown = displayAgents(list, edits)
  return items.flatMap(item => {
    const source = list.find(n => n.kind !== 'workflow' && (n.startedAt ?? n.endedAt) === item.at && (n.label || n.kind) === item.label && n.model === item.model)
    const node = source && shown.find(n => n.id === source.id)
    return source ? node ? [{ ...item, label: node.label || node.kind }] : [] : [item]
  })
}
