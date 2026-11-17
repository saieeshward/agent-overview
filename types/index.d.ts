export type VibeLog = {
  sessionId?: string
  events?: VibeEvent[]
  startedAt?: number
  lastFailAt?: number
  lastTest?: 'pass' | 'fail'
  pendingCommits?: number
  visualChecks?: number
  lastPushAt?: number
  acts: { tool: string; title: string; state: 'running' | 'done' | 'failed'; at: number; kind: 'bash' | 'test' | 'edit' | 'other'; tests?: 'pass' | 'fail' }[]
  combo: number; commits: number; pushes: number; best: number; phase: string
}
export type VibeEvent = { kind: 'provider-on' | 'provider-off' | 'tag' | 'priority' | 'handoff' | 'powerup' | 'decision'; at: number; provider?: Provider; tag?: RoutingTag; key?: string; mode?: Mode }
export type Provider = 'claude' | 'codex' | 'commandcode' | 'opencode' | 'antigravity' | 'ollama'
export type AlertKind = 'run' | 'review' | 'quota' | 'question'
// Session totals of edited lines and files: they only grow, unlike the trimmed edits list.
export type Written = { added: number; removed: number; files: string[] }
export type ChatSettings = {
  office: 'off' | 'slim' | 'glass' | 'heads' | 'dock' | 'peek' | 'line' | 'ticker'
  railPreset: boolean; hint: boolean; stripRuns: boolean; stripDone: boolean; stripQuota: boolean
  spinner: boolean; mentions: boolean; permission: boolean; sounds: boolean
  events: Record<AlertKind, { notify: boolean; sound: boolean }>
  vibeDivider: 'chase' | 'boat'
  // Which look your messages use: the current mode's, or one picked without changing the mode.
  theme: 'mode' | Area
}
// One owner prompt of this chat: a fingerprint of its text (and of the text that entered, when a hook rewrote it),
// and what the turn before it did, for the divider drawn above it.
export type Turn = { key: string; sent?: string; at: number; area: Area; stage?: StageId; ran?: Provider[]; work?: number; images?: number; row?: string }
export type Look = { area: Area; session?: string; turns: Turn[] }
export type ChatSurfaceState = {
  waiting?: string; questionSeen?: string; vibeSince?: number; editVersion: number
  test?: { at: number; version: number; passed: boolean; cwd?: string; files?: string }
  alerts: Partial<Record<AlertKind, number>>
}
export type Tab = 'dashboard' | 'agents' | 'models' | 'activity' | 'plugins' | 'settings'

export type Area = 'overview' | 'work' | 'vibe'
export type WorkTab = 'source' | 'plan' | 'implement' | 'review' | 'settings'
export type VibeTab = 'live' | 'crew' | 'powerups' | 'decisions' | 'settings'
export type VibeStyle = 'office' | 'arcade'
export type Motion = 'full' | 'calm' | 'still'
export type RoutingTag = 'main' | 'normal' | 'saver'
export type StageId = 'plan' | 'implement' | 'review' | 'ship'
// since is the HEAD when implementation began; adr is the saved Q&A path.
export type Stage = { at: StageId; reached: StageId[]; round: number; startedAt?: number; qaSince?: number; seen?: StageId[]; adr?: string; since?: string; shipBase?: string; shipAt?: number; reviewStartedAt?: number; reviewCount?: number }
export type Finding = { file: string; line?: number; severity: 'high' | 'medium' | 'low'; text: string; by: string[]; at: number; dismissed?: boolean }
export type Reviewer = { provider: Provider; model: string; effort?: string; focus: string }
export type ReviewProfile = { id: string; name: string; reviewers: Reviewer[]; instructions: string }
export type Impl = { agents: { provider: Provider; model: string; effort?: string; on: boolean }[]; launchedAt?: number }

export type AgentNode = {
  id: string
  agentId?: string
  // The sensitivity its spawn declared, and whether it was started to redo a side lane's failed task.
  sensitivity?: string
  escalated?: boolean
  pid?: number
  detached?: boolean
  dir?: string
  // Keep the untracked baseline too, so existing local files are not claimed by the run.
  snap?: { repo: string; base: string; untracked?: string[]; ignored?: string[] }
  parentId?: string
  parentNode?: string
  // The run it belongs to: a workflow run, or the chat turn that started it.
  run?: string
  input?: string
  output?: string
  outputFile?: string
  provider?: Provider
  label: string
  kind: string
  model: string
  effort?: string
  state: 'running' | 'done' | 'failed'
  steps: number
  lastTool?: string
  trail?: { tool: string; arg?: string; at: number }[]
  startedAt?: number
  endedAt?: number
  // The owner pressed stop: its next tool call is refused and it is told to wrap up.
  stopping?: boolean
  offRoute?: string
  ownEdits?: boolean
}
export type GrillItem = { question: string; answer: string; kind?: 'answer' | 'instruction'; at?: number; documented?: boolean }
// A choice the model made on its own and wants the owner to see, not approve.
export type DecisionItem = { decision: string; why: string; impact: 'low' | 'medium' | 'high'; at: number }
// One change to a file. A side provider's (Codex, OpenCode, Command Code) is found by git after its run:
// `base` is the snapshot commit before it and `path` the file in that repo, so it can be reverted.
export type EditItem = {
  file: string; lines: string[]; agent?: string; added?: number; removed?: number; before?: string[]; after?: string[]; at?: number; isNew?: boolean
  model?: string; provider?: Provider; review?: 'pending' | 'kept' | 'reverted'; base?: string; repo?: string; path?: string; afterHash?: string; gone?: boolean
}
export type Act = {
  key: string; tool: string; title: string; toolUseId?: string
  state: 'running' | 'done' | 'failed'; at: number; endedAt?: number
  file?: string; startLine?: number
  before?: string[]; old?: string[]; text?: string; after?: string[]
  output?: string[]
}
export type LiveEdit = { id: string; tool: string; file: string; text: string; agent?: string; seq: number }
export type SideLive = { id: string; files: { path: string; added: number; removed: number; isNew: boolean }[]; file?: string; startLine?: number; before?: string[]; old?: string[]; text?: string; after?: string[]; at: number }
export type GitInfo = { branch: string; commit: string; dirty: number; ahead: string; recent?: string[] } | { error: string }

export type ModelRow = { id: string; name?: string; info?: string; isCurrent?: boolean; isDefault?: boolean; efforts?: string[] }
export type Meter = { label: string; percent: number; detail?: string; limited?: boolean; resetAt?: number }
export type ProviderInfo = {
  status: 'loading' | 'ok' | 'missing' | 'error'
  plan?: string
  current?: string
  meters: Meter[]
  facts: string[]
  models: ModelRow[]
  alert?: string
  note?: string
  checkedAt?: number
  usageAt?: number
  usageSource?: 'live' | 'estimate' | 'desktop'
  agyQuota?: Meter[]
  error?: string
  // Installed but not answering now (Ollama's local server is down): it takes no work until it does.
  offline?: string
}
export type Providers = Record<Provider, ProviderInfo>
export type Used = { mcp: Record<string, number>; skills: Record<string, number>; agentTypes: Record<string, number> }
export type InstalledPlugin = { name: string; version?: string; enabled: boolean; where: 'claude' | 'antigravity'; skills?: string[] }
export type Installed = { plugins: InstalledPlugin[]; mcpServers: string[]; skills: number; tools?: string[] }
// Session switches: off hides a plugin, skill or tool from the model; force tells it to use it.
export type Mode = 'off' | 'on' | 'force'
export type Ui = {
  tab: Tab
  editing?: Provider
  pick: Provider
  agents?: 'graph' | 'list' | 'history'
  detail?: string
  watch?: string
  sel?: string
  folded?: Record<string, boolean>
  file?: string
  source?: { commit?: string; file?: string; kind?: 'staged' | 'unstaged' | 'untracked' }
  fileEdit?: number
  view?: 'prices'
  run?: string
  note?: string
  cap?: Provider
  saving?: boolean
  preset?: { name: string }
  confirm?: string
  qaEdit?: boolean
  area?: Area
  modeSession?: string
  pendingArea?: Area
  workTab?: WorkTab
  vibeTab?: VibeTab
  vibeStyle?: VibeStyle
  vibeFilter?: 'all' | DecisionItem['impact']
  vibeExpanded?: string[]
  vibeUndo?: { until: number; before: Routing; after: Routing }
  ponytailWas?: Mode | null
  grillingWas?: Mode | null
  reviewProfile?: string
  reviewNote?: string
  reviewDraft?: { id: string; focus?: Record<number, string>; instructions?: string }
  findSel?: string[]
  profileEdit?: boolean
  addModel?: string
  modelPickers?: Record<string, { model?: string; maker?: string; range?: string; makers?: string }>
}
export type MainInfo = { model: string; effort?: string; working?: boolean; since?: number; steps?: number; lastTool?: string; trail?: { tool: string; arg?: string; at: number }[]; ultracode?: boolean }
// Token counts per model, and what each provider reports or we estimate it cost.
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type TokenRow = Tokens & { provider: Provider; model: string; period: 'session' | 'today' | 'period'; reported?: number; credits?: boolean }
export type Price = { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export type Media = Record<string, { features: Record<string, number>; running?: string; base?: number; left?: number; total?: number; plan?: string; used?: number; at?: number }>
// `base`: the side providers' totals at this session's first reading, so the cost card shows this session alone.
export type Costs = { rows: TokenRow[]; base?: TokenRow[]; baseDay?: string; claude: Record<string, Tokens>; agy: Record<string, Tokens>; engineUsd?: number; checkedAt?: number }
export type TurnCost = { durationMs: number; usd?: number; tokens: number; at: number }
export type SpeedSample = { outputTokens: number; milliseconds: number }
export type ModelSpeeds = Record<string, SpeedSample[]>
export type Prices = { catalog: Record<string, Price & { source: string }>; overrides: Record<string, Price>; fetchedAt?: number; missing?: string[] }
// Finished agents kept across sessions; `since` is when this session began.
export type HistoryItem = { at: number; label: string; model: string; provider?: Provider; state: 'done' | 'failed'; ms: number; session?: string }
export type History = { since: number; items: HistoryItem[] }

// Daily spend caps in dollars, whether side providers' file changes wait for review one by one,
// and Command Code's billing-period total at the start of the day (it reports no daily figure).
export type Guard = {
  chat: ChatSettings
  mediaWidget: boolean
  mediaBalances: boolean
  creditPrice: Record<string, number>
  caps: Partial<Record<Provider, number>>
  ccBase?: { day: string; value: number }
  chatLook: boolean
  usageTail: boolean
  autoPause: boolean
  planSubagents: 'block' | 'handoff'
  routingGuard: 'warn' | 'enforce' | 'off'
  babysitterModel: string
  codexImages: Mode
  ctxWarn: number
  ticker: boolean
  qaLog: boolean
  follow: boolean
  review: boolean
  work: { ponytail: boolean; grill: boolean }
  vibe: { styles: VibeStyle[]; motion: Motion }
}
export type Preset = { name: string; routing: Routing; builtIn?: boolean }
// This session's record of which hooks ran (counts by event, with occasions such as 'turn.step:main'),
// and the ones the debug log says a plugin above bypassed, by that plugin's name.
// Task routing: every Agent spawn declares its task type and sensitivity; the owner's table picks the lane.
export type TaskType = 'lookup' | 'summarise' | 'build' | 'design' | 'review' | 'visual' | 'private-extract'
export type Sensitivity = 'client' | 'internal' | 'public'
export type Lane = 'claude' | 'ollama' | 'gemini'
export type TaskRoute = { lane: Lane; model: string; effort?: string }
// declare: what the routing guard does with a spawn whose declaration is missing or off the table.
// allow: projects whose (non-client) work may go to Antigravity; patterns: extra confidential path patterns.
export type Policy = { table: Record<TaskType, TaskRoute>; declare: 'warn' | 'block' | 'off'; allow: string[]; patterns: string[] }
export type RouteLogItem = {
  at: number; id: string; agentId?: string; tool: string; label?: string
  type?: string; sensitivity?: string; declared: 'ok' | 'missing' | 'off-table' | 'exempt'
  lane: Lane; model: string; effort?: string; tokens?: number; ms?: number
  outcome: 'running' | 'done' | 'failed' | 'denied' | 'warned' | 'escalated'; note?: string
}
// This session's project and the confidential paths its own rules name (CLAUDE.md, a .clan file).
export type Confidential = { cwd: string; found: string[]; sources: string[] }
// The owner-requested adversarial review: confirm shows the cost first; fixing waits for the main turn that fixes.
export type AdversarialRun = {
  status: 'idle' | 'confirm' | 'running' | 'fixing' | 'done' | 'failed'
  base: string; goal: string; model: string; round: number; rounds: number; estimate?: number
  diffChars: number; files: number; agentId?: string; fixTurn?: string; found: number; note?: string; at: number
  // One-shot claim set by startRound just before it spawns the reviewer: the spawn hook accepts only this exact description once.
  nonce?: string; desc?: string; starting?: boolean
}
// /clean-worktrees: the numbered list the owner picks from (numbers hold while the list is fresh).
export type WorktreeRow = { n: number; path: string; branch?: string; head: string; verdict: 'SAFE' | 'PUSH-FIRST' | 'WIP' | 'OPEN-PR'; why: string; dirty: number; ignored?: number; unpushed: number; last: number }
export type WorktreeList = { repo: string; at: number; rows: WorktreeRow[] }
// What an agent declared at spawn, kept apart from the capped node list (see hooks/register.tsx).
export type KeptSens = { agentId: string; sensitivity?: string; parent?: string; escalated?: boolean }
export type HookCheck = { session: string; ran: Record<string, number>; bypassed: Record<string, string> }

// What the owner set for delegated work; saved across sessions in $.store.
export type Routing = {
  optimize: 'quality' | 'balanced' | 'speed'
  adversary?: { provider: Provider; model: string; effort?: string; rounds: number } | null
  tags?: Partial<Record<Provider, RoutingTag>>
  useOrder?: boolean
  order: Provider[]
  on: Record<Provider, boolean>
  models: Record<Provider, string[]>
  // What Antigravity (Gemini) may take: visual checks, coding and text work, or both.
  agyVisual: boolean
  agyCoding: boolean
  agyCodingModel: string
  agyVisualModel: string
  // Live quota belongs to this chat, outside preset snapshots.
  agyQuota?: Meter[]
  // Allowed models from any provider, smartest first, with the owner's guidance on when to use them.
  picks: { provider: Provider; model: string; note?: string; effort?: string }[]
  // plan: Claude plans and reviews, others implement; auto: Claude decides; claude: no side providers.
  role: 'plan' | 'auto' | 'claude'
  // Kept for compatibility, derived from the Main provider's highest-ranked allowed model.
  worker: { provider: Provider; model: string } | null
  // Providers the mod turned off when they ran out of quota, and when to try them again.
  paused?: Partial<Record<Provider, { why: string; at: number; until: number }>>
}

declare module 'claude-code' {
  interface PluginState {
    'agent-overview': {
      nodes: AgentNode[]
      grill: GrillItem[]
      decisions: DecisionItem[]
      edits: EditItem[]
      written: Written
      acts: Record<string, Act>
      live: LiveEdit | null
      sideLive: SideLive | null
      lastLive: LiveEdit | null
      git: GitInfo
      providers: Providers
      used: Used
      installed: Installed
      ui: Ui
      main: MainInfo
      tick: number
      deliveredPrompt: { sessionId: string; routing: string; work: string } | null
      routing: Routing
      history: History
      costs: Costs
      media: Media
      turnCosts: TurnCost[]
      modelSpeeds: ModelSpeeds
      toggles: Record<string, Mode>
      pins: string[]
      prices: Prices
      guard: Guard
      presets: Preset[]
      stage: Stage | null
      findings: Finding[]
      reviewProfiles: ReviewProfile[]
      impl: Impl
      vibe: VibeLog
      chatSurface: ChatSurfaceState
      look: Look
      hookcheck: HookCheck
      policy: Policy
      routeLog: RouteLogItem[]
      confidential: Confidential
      adversarial: AdversarialRun
      worktrees: WorktreeList
      agentSens: KeptSens[]
    }
  }
}
