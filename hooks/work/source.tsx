import { atom, read, update } from 'claude-code'
import type { EditItem, GitInfo, Ui } from '../../types'
import { Card, Rule, colorOf, filled, fit, fitStart, padL, padR, plural, shortModel } from '../ui'
import type { $, E } from '../ui'
import { commitFiles, fileDiff, hunks, laneSvg, layout, LANE_COLORS, loadSource, refLabel, refSvg } from './git'
import type { Change, Commit, Ref } from './git'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const git = atom({ plugin: 'agent-overview', key: 'git' } as const, { error: 'loading' } as GitInfo)
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])

const statusColor = (code: string) => code === 'D' || code === 'U' ? 'error' : code === 'A' || code === '?' ? 'success' : code === 'R' || code === 'C' ? 'suggestion' : 'warning'
function refs(E: E, list: Ref[], color: string, max = 24) {
  return list.map((r, i) => E.desk ? <E.Svg key={`ref:${i}`} source={refSvg(r, color, max)} width={Math.ceil(Math.min(refLabel(r).length, max) * 7.2 + 12)} height={20} alt={`${r.kind}: ${refLabel(r)}`} /> : <E.Text key={`ref:${i}`} {...(r.kind === 'remote' ? { dimColor: true } : filled(E, r.kind === 'head' ? 'claude' : r.kind === 'tag' ? 'warning' : color))}> {refLabel(r)} </E.Text>)
}

function graphText(E: E, graph: string, head = false) {
  const marks: Record<string, string> = { '*': head ? '◉' : '●', '|': '│', '/': '╱', '\\': '╲', _: '─' }
  const runs: { text: string; color: string; bold: boolean }[] = []
  for (let i = 0; i < graph.length; i++) {
    const char = graph[i]!, text = marks[char] ?? char, color = LANE_COLORS[Math.floor(i / 2) % 8]!, bold = head && char === '*'
    const last = runs[runs.length - 1]
    if (last && last.color === color && last.bold === bold) last.text += text
    else runs.push({ text, color, bold })
  }
  return runs.map((r, i) => <E.Text key={`lane:${i}`} color={r.color} weight={r.bold ? 'bold' : undefined}>{r.text}</E.Text>)
}

function writer(E: E, list: EditItem[], root: string, path: string) {
  const x = [...list].reverse().find(x => x.file === `${root}/${path}` || (x.repo === root && x.path === path))
  return x ? <E.Text><E.Text color={colorOf(x.provider ?? 'claude')}>{padR(shortModel(x.model ?? 'claude'), 16)}</E.Text>{x.agent ? <E.Text dimColor> · subagent</E.Text> : null}</E.Text> : null
}

function fileRow(E: E, c: Change, key: string, open: () => unknown, w: number, most: number, who: any) {
  const cells = Math.max(3, Math.min(10, w - 60)), pathW = Math.max(12, w - cells - (w >= 60 ? 34 : 16)), total = (c.added ?? 0) + (c.removed ?? 0)
  const size = total ? Math.max(1, Math.round(total / most * cells)) : 0
  const plus = total ? Math.round(size * (c.added ?? 0) / total) : 0
  return <E.Box key={`row:${key}`} flexDirection="row" alignItems="center" columnGap={1}>
    <E.Button key={key} plain onPress={open}>
      <E.Text color={statusColor(c.code)} weight={c.code === 'U' ? 'bold' : undefined}>{c.code} </E.Text>
      <E.Text>{padR(fitStart(c.path, pathW), pathW)}</E.Text>
    </E.Button>
    {c.kind === 'untracked' ? <E.Text dimColor>{padR('new', cells + 13)}</E.Text> : <E.Text>
      <E.Text color="success">{'━'.repeat(plus)}</E.Text><E.Text color="error">{'╍'.repeat(size - plus)}</E.Text>{' '.repeat(cells - size)}
      <E.Text color="success">{padL(`+${c.added ?? 0}`, 6)}</E.Text><E.Text color="error">{padL(`−${c.removed ?? 0}`, 6)}</E.Text>
    </E.Text>}
    {w >= 60 ? <E.Box flexShrink={1}><E.Text wrap="truncate-end">{who}</E.Text></E.Box> : null}
  </E.Box>
}

export async function sourceTab($: $, E: E, w: number, rows: number) {
  const [u, g, list] = await Promise.all([read($, ui), read($, git), read($, edits)])
  const sig = JSON.stringify([g, list.length]), data = await loadSource($, sig)
  if (!data) return <E.Box key="work:source" flexDirection="column" gap={1}><E.Text dimColor>not a git repository</E.Text></E.Box>
  const { root, lines, changes } = data, sel = u.source
  const commits = lines.flatMap(x => x.commit ? [x.commit] : [])
  const graph = layout(commits)
  const open = (source: Ui['source']) => update($, ui, u => ({ ...u, source }))
  const back = () => open(sel?.file && sel.commit ? { commit: sel.commit } : undefined)
  const backButton = <E.Button key="src:back" plain onPress={back}>‹ back</E.Button>
  const who = (path: string) => writer(E, list, root, path)
  const most = (xs: { added?: number; removed?: number }[]) => Math.max(1, ...xs.map(x => (x.added ?? 0) + (x.removed ?? 0)))
  let body: any
  if (sel?.file) {
    const path = sel.file, change = changes.find(c => c.path === path && c.kind === sel.kind)
    const diff = await fileDiff($, root, { path, orig: change?.orig, kind: sel.kind, commit: sel.commit }, sig)
    const clipped = hunks(diff ?? '')
    const stats = sel.commit ? (await commitFiles($, root, sel.commit, sig)).find(c => c.path === path) : change
    const firstHunk = diff?.search(/^@@ /m) ?? -1, content = firstHunk < 0 ? '' : diff!.slice(firstHunk)
    const added = stats?.added ?? (content.match(/^\+/gm) ?? []).length, removed = stats?.removed ?? (content.match(/^-/gm) ?? []).length
    body = <E.Box flexDirection="column" gap={1}>
      <E.Box flexDirection="row" flexWrap="wrap" gap={2} alignItems="center">
        {backButton}<E.Text color="claude" weight="bold">· {fitStart(path, Math.max(10, w - 40))}</E.Text>
        <E.Text dimColor>{sel.commit ? `in ${sel.commit.slice(0, 7)}` : sel.kind ?? 'unstaged'}</E.Text>
        {diff !== undefined ? <E.Text><E.Text color="success">+{added}</E.Text><E.Text color="error"> −{removed}</E.Text></E.Text> : null}
        {!sel.commit ? who(path) : null}
      </E.Box>
      {diff === undefined ? <E.Text color="error">could not read the diff</E.Text>
        : clipped.text ? <E.Code key="src:diff" source={clipped.text} format="diff" path={path} wrap="truncate-end" />
          : <E.Text dimColor>no text changes to show (binary or mode change)</E.Text>}
      {clipped.more ? <E.Text dimColor>… {clipped.more} more lines not shown</E.Text> : null}
    </E.Box>
  } else if (sel?.commit) {
    const c: Commit | undefined = commits.find(c => c.hash === sel.commit), files = await commitFiles($, root, sel.commit, sig)
    body = <E.Box flexDirection="column" gap={1}>
      <E.Box flexDirection="row" flexWrap="wrap" gap={2} alignItems="center">
        {backButton}<E.Text color="warning">● {sel.commit.slice(0, 7)}</E.Text>
        {refs(E, c?.refs ?? [], LANE_COLORS[0]!)}<E.Text weight="bold">{c?.subject ?? 'Commit'}</E.Text>
        {c ? <E.Text dimColor>{c.author} · {c.when}</E.Text> : null}
        {c && c.parents.length > 1 ? <E.Text dimColor>parents: {c.parents.map(p => p.slice(0, 7)).join(' ')}</E.Text> : null}
      </E.Box>
      {Card(E, 'src:files', 'FILES', 'suggestion', <E.Box flexDirection="column">
        {files.length ? files.map(c => fileRow(E, { ...c, kind: 'staged', code: ' ' }, `src:cfile:${c.path}`, () => open({ commit: sel.commit, file: c.path }), w - 4, most(files), null))
          : <E.Text dimColor>no file changes (merge with no first-parent diff)</E.Text>}
      </E.Box>)}
    </E.Box>
  } else {
    body = <E.Box flexDirection="column" gap={1}>
      {Card(E, 'src:changes', 'CHANGES', 'success', <E.Box flexDirection="column">
        {changes.length ? (['staged', 'unstaged', 'untracked'] as const).map(kind => {
          const group = changes.filter(c => c.kind === kind)
          return group.length ? <E.Box key={`src:group:${kind}`} flexDirection="column">
            {Rule(E, `${kind.toUpperCase()} ${group.length}`, w - 4)}
            {group.slice(0, 40).map(c => fileRow(E, c, `src:file:${kind}:${c.path}`, () => open({ file: c.path, kind }), w - 4, most(changes), who(c.path)))}
            {group.length > 40 ? <E.Text dimColor>+{group.length - 40} more</E.Text> : null}
          </E.Box> : null
        }) : <E.Text color="success">✓ working tree clean</E.Text>}
      </E.Box>, { aside: <E.Text dimColor>{'error' in g ? `${changes.length} changes` : `⎇ ${g.branch}  ${g.ahead} · ${changes.length} changes`}</E.Text> })}
      {Card(E, 'src:history', 'HISTORY', 'suggestion', <E.Box flexDirection="column" gap={E.desk ? 1 : 0}>
        {!commits.length ? <E.Text dimColor>no commits yet</E.Text> : E.desk ? <E.Box flexDirection="column">
          {commits.map((c, i) => <E.Box key={`src:history:${c.hash}`} flexDirection="row" alignItems="center" gap={1}>
            <E.Svg source={laneSvg(graph, i, c.refs.some(r => r.kind === 'head'))} width={Math.max(36, graph.lanes * 16 + 20)} height={30} alt={`Commit lanes for ${c.hash.slice(0, 7)}`} />
            {w >= 70 ? <E.Button key={`src:commit:${c.hash}`} plain dimColor onPress={() => open({ commit: c.hash })}>{c.hash.slice(0, 7)}</E.Button> : null}
            {refs(E, w < 70 ? c.refs.slice(0, 1) : c.refs, LANE_COLORS[graph.dots[i]!.color % 8]!, w < 70 ? 6 : 24)}
            {w < 70 && c.refs.length > 1 ? <E.Text dimColor>+{c.refs.length - 1}</E.Text> : null}
            <E.Box flexGrow={1} flexShrink={1} minWidth={w < 70 ? 22 : undefined}>{w < 70
              ? <E.Button key={`src:commit:${c.hash}`} plain onPress={() => open({ commit: c.hash })}>{fit(c.subject, Math.max(22, w - 28))}</E.Button>
              : <E.Text wrap="truncate-end">{c.subject}</E.Text>}</E.Box>
            {w >= 80 ? <E.Text dimColor wrap="truncate-end">{c.when} · {c.author}</E.Text> : null}
          </E.Box>)}
        </E.Box> : lines.map((line, i) => {
          const c = line.commit, graph = graphText(E, line.graph, c?.refs.some(r => r.kind === 'head'))
          if (!c) return <E.Text key={`src:connector:${i}`} wrap="truncate-end">{graph}</E.Text>
          const col = Math.floor(line.graph.indexOf('*') / 2), color = LANE_COLORS[Math.max(0, col) % 8]!
          return <E.Button key={`src:commit:${c.hash}`} plain onPress={() => open({ commit: c.hash })}>
            <E.Text wrap="truncate-end">{graph}{w >= 70 ? <E.Text color="warning"> {c.hash.slice(0, 7)} </E.Text> : ' '}{refs(E, w < 70 ? c.refs.slice(0, 1) : c.refs, color, w < 70 ? 10 : 24)}{w < 70 && c.refs.length > 1 ? <E.Text dimColor> +{c.refs.length - 1}</E.Text> : null}<E.Text> {c.subject}</E.Text>{w >= 70 ? <E.Text dimColor> · {c.when} · {c.author}</E.Text> : null}</E.Text>
          </E.Button>
        })}
      </E.Box>, { aside: <E.Text dimColor>{plural(commits.length, 'commit')} · all branches</E.Text> })}
    </E.Box>
  }
  return <E.Box key="work:source" flexDirection="column" gap={1}>{body}</E.Box>
}
