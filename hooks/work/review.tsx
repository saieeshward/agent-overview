import { atom, read, update } from 'claude-code'
import { saveStage } from '../modes'
import type { Act, AgentNode, EditItem, Finding, GitInfo, Impl, MainInfo, Providers, Reviewer, ReviewProfile, Stage, Ui } from '../../types'
import { blank, defaultRouting, normalGuard } from '../state'
import { Card, Chip, IMPACT, LEVELS, PROVIDERS, colorOf, fit, fitStart, modeControls, nameOf, plural, shortModel, submitPrompt } from '../ui'
import type { $, E } from '../ui'
import { DEFAULT_PROFILE, seeStage, advance, adrOf, commitPreview, commitPrompt, findingKey, fixPrompt, freshStage, implAgents, normalProfiles, prPrompt, pushPrompt, reviewPrompt, reviewerBlock, reviewerWarning, runBusy, workCaps } from './stage'
import { relativeFile, repoRoot } from './git'
import { newTask } from './settings'

const ui = atom({ plugin: 'agent-overview', key: 'ui' } as const, { tab: 'dashboard', pick: 'claude' } as Ui)
const stage = atom({ plugin: 'agent-overview', key: 'stage' } as const, null as Stage | null)
const findings = atom({ plugin: 'agent-overview', key: 'findings' } as const, [] as Finding[])
const reviewProfiles = atom({ plugin: 'agent-overview', key: 'reviewProfiles' } as const, [] as ReviewProfile[])
const providers = atom({ plugin: 'agent-overview', key: 'providers' } as const, {
  claude: blank(), codex: blank(), commandcode: blank(), opencode: blank(), antigravity: blank(),
} as Providers)
const routing = atom({ plugin: 'agent-overview', key: 'routing' } as const, defaultRouting())
const guard = atom({ plugin: 'agent-overview', key: 'guard' } as const, normalGuard(undefined))
const impl = atom({ plugin: 'agent-overview', key: 'impl' } as const, { agents: [] } as Impl)
const edits = atom({ plugin: 'agent-overview', key: 'edits' } as const, [] as EditItem[])
const git = atom({ plugin: 'agent-overview', key: 'git' } as const, { error: 'loading' } as GitInfo)
const main = atom({ plugin: 'agent-overview', key: 'main' } as const, { model: '' } as MainInfo)
const nodes = atom({ plugin: 'agent-overview', key: 'nodes' } as const, [] as AgentNode[])
const acts = atom({ plugin: 'agent-overview', key: 'acts' } as const, {} as Record<string, Act>)

export async function reviewTab($: $, E: E, w: number, rows: number) {
  E = await modeControls($, E, 'work')
  const s = await read($, stage), u = await read($, ui), all = await read($, providers), r = await read($, routing)
  if (s?.at === 'ship') {
    const g = await read($, git), m = await read($, main)
    const hash = 'commit' in g ? g.commit.split(/\s/)[0] : undefined
    const committed = hash && (!s.shipBase || hash !== s.shipBase && !s.shipBase.startsWith(hash)) && !m.working
    const delivery = Object.values(await read($, acts)).filter(a => a.at >= (s.shipAt ?? s.startedAt ?? 0) && a.state === 'done')
    const pushed = delivery.some(a => a.tool === 'Bash' && /\bgit\b[^|;&]*\bpush\b/.test(a.title) && !/\s(?:--dry-run|-n)(?:\s|$)/.test(a.title)) && !('ahead' in g && /↑[1-9]/.test(g.ahead))
    const pr = delivery.flatMap(a => a.output ?? []).join('\n').match(/https:\/\/[^\s<>]+\/pull\/\d+/)?.[0]
    return Card(E, 'work:review', 'SHIP', 'success', <E.Box flexDirection="column" gap={1}>
      <E.Text color={committed ? 'success' : 'warning'}>{committed ? `${pushed ? 'Pushed' : 'Committed'} · ${hash.slice(0, 7)}` : 'Commit pending'}</E.Text>
      {pr ? <E.Link href={pr} label="Pull request" /> : null}
      {committed ? <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
        <E.Button key="ship:push" plain onPress={() => submitPrompt($, pushPrompt())}>{Chip(E, 'Push', false)}</E.Button>
        <E.Button key="ship:pr" plain onPress={() => submitPrompt($, prPrompt())}>{Chip(E, 'Open PR', false)}</E.Button>
        <E.Button key="ship:new" plain onPress={() => newTask($)}>{Chip(E, 'New task ▸', true)}</E.Button>
      </E.Box> : <E.Button key="ship:retry" plain onPress={async () => {
        if ((await read($, main)).working) return
        await saveStage($, x => advance(x, 'review'))
      }}>{Chip(E, 'Back to Review', false)}</E.Button>}
    </E.Box>)
  }
  const held = await read($, reviewProfiles)
  const profiles = held.length ? held : normalProfiles(await $.store.get('reviewProfiles').catch(() => undefined))
  const savedProfile = profiles.find(p => p.id === (u.reviewProfile ?? DEFAULT_PROFILE)) ?? profiles[0]!
  const draft = u.reviewDraft?.id === savedProfile.id ? u.reviewDraft : undefined
  const profile = { ...savedProfile, instructions: draft?.instructions ?? savedProfile.instructions,
    reviewers: savedProfile.reviewers.map((a, i) => ({ ...a, focus: draft?.focus?.[i] ?? a.focus })) }
  const g = await read($, guard), over = await workCaps($)
  const warnings = profile.reviewers.map(a => reviewerBlock(r, a, g, over))
  const m = await read($, main), agents = await read($, nodes)
  const reviewing = s?.reviewStartedAt === undefined ? [] : agents.filter(n => n.kind !== 'workflow' && n.state === 'running' && (n.startedAt ?? -1) >= s.reviewStartedAt!)
  const busy = !!m.working || runBusy(s?.reviewStartedAt, m, agents)
  const live = s?.at === 'review', editing = live && !busy && u.profileEdit
  const list = await read($, findings), sel = u.findSel ?? []
  const selected = list.filter(f => sel.includes(findingKey(f)) && !f.dismissed)
  const rank = { high: 0, medium: 1, low: 2 }
  const ordered = [...list].sort((a, b) => Number(!!a.dismissed) - Number(!!b.dismissed) || rank[a.severity] - rank[b.severity] || b.at - a.at)
  const ed = await read($, edits), adr = adrOf(s, ed), root = await repoRoot($)
  const title = adr ? /^#\s+(.+)$/m.exec(await $.fs.read(adr).catch(() => ''))?.[1] : undefined
  const preview = commitPreview(ed.filter(e => (e.at ?? -1) >= (s?.startedAt ?? 0)).map(e => ({ ...e, path: relativeFile(e.file, root) })), adr, title)
  const high = list.filter(f => f.severity === 'high' && !f.dismissed).length
  const save = async (change: (p: ReviewProfile) => ReviewProfile) => {
    const draft = (await read($, ui)).reviewDraft
    const latest = normalProfiles(await $.store.get('reviewProfiles'))
    const next = latest.map(p => p.id === profile.id ? change(draft?.id === p.id ? { ...p,
      instructions: draft.instructions ?? p.instructions,
      reviewers: p.reviewers.map((a, i) => ({ ...a, focus: draft.focus?.[i] ?? a.focus })),
    } : p) : p)
    try { await $.store.set('reviewProfiles', next) }
    catch { $.ui.toast('could not save reviewer profiles · try again'); return }
    await update($, reviewProfiles, () => next)
    await update($, ui, x => ({ ...x, reviewDraft: undefined }))
    return next.find(p => p.id === profile.id)!
  }
  const editDraft = (patch: Partial<NonNullable<Ui['reviewDraft']>>) => update($, ui, x => ({ ...x,
    reviewDraft: { ...(x.reviewDraft?.id === profile.id ? x.reviewDraft : { id: profile.id }), ...patch },
  }))
  const reviewer = (i: number, patch: Partial<Reviewer>) => save(p => ({ ...p, reviewers: p.reviewers.map((x, n) => n === i ? { ...x, ...patch } : x) }))
  const submit = (text: string) => submitPrompt($, text)
  const isBusy = async () => {
    const m = await read($, main)
    return !!m.working || runBusy((await read($, stage))?.reviewStartedAt, m, await read($, nodes))
  }
  const launch = live && !busy ? <E.Button key="rev:launch" plain onPress={async () => {
    if (await isBusy() || (await read($, stage))?.at !== 'review') return
    const currentUi = await read($, ui)
    const currentProfile = currentUi.reviewDraft?.id === profile.id ? await save(p => p) : profile
    if (!currentProfile) return
    const routingNow = await read($, routing), guardNow = await read($, guard), caps = await workCaps($)
    const allowed = currentProfile.reviewers.filter(a => !reviewerBlock(routingNow, a, guardNow, caps))
    const omitted = currentProfile.reviewers.filter(a => !allowed.includes(a))
    if (!allowed.length) { $.ui.toast('no reviewers allowed by current routing'); return }
    const note = [currentUi.reviewNote, omitted.length ? `Omitted by current routing: ${omitted.map(a => `${a.model} (${reviewerBlock(routingNow, a, guardNow, caps)})`).join(', ')}. Do not launch these reviewers.` : ''].filter(Boolean).join('\n')
    const at = await $.clock.now()
    if (!await submit(reviewPrompt({ ...currentProfile, reviewers: allowed }, s?.since, note, adr))) return
    await saveStage($, x => x ? { ...x, reviewStartedAt: at, reviewCount: allowed.length } : x)
    await update($, findings, () => [])
    await update($, ui, x => ({ ...x, findSel: [] }))
  }}>{profile.reviewers.length ? Chip(E, s?.reviewStartedAt === undefined ? 'Run review ▸' : 'Run again', s?.reviewStartedAt === undefined) : <E.Text dimColor>Add reviewer</E.Text>}</E.Button> : null
  return Card(E, 'work:review', 'REVIEW', 'claude', <E.Box flexDirection="column" gap={1}>
    {!live ? <E.Text dimColor>read-only · the work is at {(s?.at ?? 'plan').toUpperCase()}</E.Text> : null}
    {!busy ? <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      {profiles.map(p => <E.Button key={`rprof:${p.id}`} plain onPress={async () => {
        if (await isBusy()) return
        if ((await read($, ui)).reviewDraft && !await save(p => p)) return
        await update($, ui, x => ({ ...x, reviewProfile: p.id }))
      }}>{Chip(E, p.name, p.id === profile.id)}</E.Button>)}
      {live ? <E.Button key="rprof:edit" plain onPress={async () => {
        if (await isBusy()) return
        if (editing && (await read($, ui)).reviewDraft && !await save(p => p)) return
        await update($, ui, x => ({ ...x, profileEdit: !x.profileEdit }))
      }}>{Chip(E, editing ? 'Done' : 'Edit profiles', false)}</E.Button> : null}
      {s?.reviewStartedAt !== undefined ? launch : null}
    </E.Box> : null}
    <E.Box flexDirection="column" gap={1}>
      {profile.reviewers.map((a, i) => {
        const models = all[a.provider].models
        const labelWidth = Math.max(12, Math.min(30, w - nameOf(a.provider).length - 14))
        const options = [...new Set([...models.map(m => m.id), ...r.picks.filter(p => p.provider === a.provider).map(p => p.model), a.model])].map(id => ({ value: id, label: fit(shortModel(id), labelWidth) }))
        const label = options.find(o => o.value === a.model)!.label
        const efforts = ['default', ...(models.find(m => m.id === a.model)?.efforts ?? LEVELS)]
        if (a.effort && !efforts.includes(a.effort)) efforts.push(a.effort)
        return editing ? <E.Box key={`rev:row:${i}`} flexDirection="column" gap={1}>
          <E.Box flexDirection={w < 80 ? 'column' : 'row'} gap={1}>
            <E.Box flexDirection="row" gap={1} alignItems="center">
            <E.Box minWidth={nameOf(a.provider).length + 4}><E.Select key={`rev:provider:${i}`} options={PROVIDERS.filter(p => p.id !== 'commandcode' && p.id !== 'opencode').map(p => ({ value: p.id, label: p.name }))} value={a.provider} onSelect={(v: Reviewer['provider']) => {
              const model = all[v].models[0]?.id ?? r.picks.find(p => p.provider === v)?.model ?? a.model
              return reviewer(i, { provider: v, model, effort: undefined })
            }} /></E.Box>
            <E.Box minWidth={label.length + 4}><E.Select key={`rev:model:${i}`} options={options} value={a.model} onSelect={(v: string) => reviewer(i, { model: v, effort: undefined })} /></E.Box>
            </E.Box>
            <E.Box flexDirection="row" gap={1} alignItems="center">
            <E.Box minWidth={Math.max(11, (a.effort ?? 'default').length + 4)}><E.Select key={`rev:effort:${i}`} options={[...new Set(efforts)].map(v => ({ value: v, label: v }))} value={a.effort ?? 'default'} onSelect={(v: string) => reviewer(i, { effort: v === 'default' ? undefined : v })} /></E.Box>
            <E.Button key={`rev:del:${i}`} plain onPress={() => save(p => ({ ...p, reviewers: p.reviewers.filter((_, n) => n !== i) }))}><E.Text color="error">✕</E.Text></E.Button>
            </E.Box>
          </E.Box>
          <E.Input key={`rev:focus:${i}`} value={a.focus} placeholder="review focus" submitLabel="↵" onInput={(v: string) => update($, ui, x => ({ ...x, reviewDraft: {
            ...(x.reviewDraft?.id === profile.id ? x.reviewDraft : { id: profile.id }),
            focus: { ...(x.reviewDraft?.id === profile.id ? x.reviewDraft.focus : {}), [i]: v },
          } }))} onSubmit={(v: string) => reviewer(i, { focus: v })} />
        </E.Box> : <E.Box key={`rev:row:${i}`} flexDirection="column">
          <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
            <E.Text color={colorOf(a.provider)}>● {nameOf(a.provider)}</E.Text>
            <E.Text color={colorOf(a.provider)} wrap="truncate-end">{shortModel(a.model)}</E.Text>
            <E.Text dimColor>{a.effort ?? 'default'}</E.Text>
          </E.Box>
          <E.Text dimColor>{a.focus}</E.Text>
        </E.Box>
      })}
      {editing ? <E.Box flexDirection="column" gap={1}>
        <E.Button key="rev:add" plain onPress={() => save(p => ({ ...p, reviewers: [...p.reviewers, { provider: 'claude', model: 'claude-opus-5-5', effort: 'high', focus: '' }] }))}><E.Text color="success">+ reviewer</E.Text></E.Button>
        <E.Text dimColor>Profile note</E.Text>
        <E.Input key="rev:instructions" value={profile.instructions} placeholder="profile instructions" submitLabel="↵" onInput={(v: string) => editDraft({ instructions: v })} onSubmit={(v: string) => save(p => ({ ...p, instructions: v }))} />
      </E.Box> : <E.Text dimColor>{profile.instructions}</E.Text>}
    </E.Box>
    {warnings.map((why, i) => why ? <E.Box key={`rev:warning:${i}`}><E.Text color="warning">{shortModel(profile.reviewers[i]!.model)} omitted: {why}</E.Text></E.Box> : null)}
    {profile.reviewers.map((a, i) => !warnings[i] && reviewerWarning(r, a, g) ? <E.Text key={`rev:model-warning:${i}`} color="warning">{reviewerWarning(r, a, g)}</E.Text> : null)}
    {live ? <E.Box flexDirection="column"><E.Text dimColor>This run</E.Text><E.Input key="rev:note" value={u.reviewNote ?? ''} placeholder="custom instructions for this run" submitLabel="↵" onInput={(v: string) => update($, ui, x => ({ ...x, reviewNote: v }))} onSubmit={(v: string) => update($, ui, x => ({ ...x, reviewNote: v }))} /></E.Box> : u.reviewNote ? <E.Text dimColor>{u.reviewNote}</E.Text> : null}
    {live && busy ? <E.Text dimColor>{reviewing.length ? `Reviewing · ${plural(reviewing.length, 'reviewer')}` : 'Claude is working'}</E.Text> : s?.reviewStartedAt === undefined ? launch : null}
    <E.Box flexDirection="column" gap={1}>
      {ordered.length ? ordered.map(f => {
        const key = findingKey(f), impact = IMPACT[f.severity]
        return <E.Box key={`finding:${key}`} flexDirection="column">
          <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
            {live && !f.dismissed ? <E.Button key={`find:${key}`} plain onPress={() => update($, ui, x => ({ ...x, findSel: (x.findSel ?? []).includes(key) ? x.findSel!.filter(k => k !== key) : [...(x.findSel ?? []), key] }))}><E.Text>{sel.includes(key) ? '✓' : '○'}</E.Text></E.Button> : null}
            <E.Text color={f.dismissed ? 'inactive' : impact.color}>{f.dismissed ? '✕' : impact.mark} {f.severity}</E.Text>
            <E.Text dimColor={!!f.dismissed}>{fitStart(f.file, Math.max(12, w - 30))}{f.line ? `:${f.line}` : ''}</E.Text>
          </E.Box>
          <E.Text dimColor={!!f.dismissed}>{f.text}</E.Text>
          <E.Text dimColor>by {f.by.map(by => by === 'Gemini' ? nameOf('antigravity') : by).join(', ')}</E.Text>
        </E.Box>
      }) : <E.Text dimColor>no findings</E.Text>}
    </E.Box>
    {live && !busy && selected.length ? <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
      <E.Button key="find:fix" plain onPress={async () => {
        if (await isBusy() || (await read($, stage))?.at !== 'review') return
        const current = (await read($, stage)) ?? freshStage(), round = current.round + 1
        const onAgents = implAgents(await read($, routing), await read($, impl), await workCaps($)).filter(a => a.on)
        const at = await $.clock.now()
        if (!await submit(fixPrompt(selected, round, onAgents))) return
        await saveStage($, x => seeStage(advance(x, 'implement', { round, reviewStartedAt: undefined, reviewCount: undefined }), 'implement'))
        await update($, impl, x => ({ ...x, launchedAt: at }))
        await update($, ui, x => ({ ...x, workTab: 'implement' as const, findSel: [] }))
        $.ui.invalidate('prompt.section')
      }}>{Chip(E, 'Fix selected → Implement', true)}</E.Button>
      <E.Button key="find:dismiss" plain onPress={async () => {
        if (await isBusy()) return
        await update($, findings, fs => fs.map(f => sel.includes(findingKey(f)) ? { ...f, dismissed: true } : f))
        await update($, ui, x => ({ ...x, findSel: [] }))
      }}><E.Text dimColor>Dismiss</E.Text></E.Button>
    </E.Box> : null}
    {live ? Card(E, 'review:ship', 'SHIP', 'success', <E.Box flexDirection="column" gap={1}>
      <E.Text dimColor>{preview}</E.Text>
      {high ? <E.Text color="warning">{plural(high, 'high finding')} open</E.Text> : null}
      <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
        <E.Button key="ship:commit" plain onPress={async () => {
          if (await isBusy()) return
          if ((await read($, findings)).some(f => f.severity === 'high' && !f.dismissed)) { $.ui.toast('Fix or dismiss high findings before committing'); return }
          const head = await $.process.run(['git', 'rev-parse', 'HEAD'], { timeoutMs: 5000 }).then(r => r.exitCode === 0 ? r.stdout.trim() : undefined, () => undefined)
          if (!head) { $.ui.toast('could not read HEAD'); return }
          if (!await submit(commitPrompt(s?.since, preview))) return
          const shipAt = await $.clock.now()
          await saveStage($, x => advance(x, 'ship', { shipBase: head, shipAt }))
          $.ui.invalidate('prompt.section')
        }}>{Chip(E, 'Commit', !high && !busy && s?.reviewStartedAt !== undefined)}</E.Button>
      </E.Box>
    </E.Box>) : null}
  </E.Box>)
}
