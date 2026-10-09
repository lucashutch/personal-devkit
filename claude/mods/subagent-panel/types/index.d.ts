export type Row = {
  id: string
  /** Spawn order, fixed for the session: what `/subagents <n>` and the hotkeys name. */
  n: number
  description: string
  type: string
  status: string
  /** Whether `$.agent.list()` has named it; a row it never names ends on its `turn.complete`. */
  isListed: boolean
  tools: number
  toolCounts: Record<string, number>
  lastTool?: string
  /** Every token the agent's requests used: input, cache read, cache write and output. */
  tokens: number
  /** The size of the agent's last request. */
  contextTokens: number
  turns: number
  model?: string
  startedAt: number
  endedAt?: number
}

/** One entry of the detail view's Recent list: a tool call and what it ran, or a line the agent wrote. */
export type Step = {
  /** The call's `tool_use_id`; absent on a line of text. */
  id?: string
  tool?: string
  text: string
  /** Why the call was made, as the model wrote it in the call's `description` (Bash, Agent and a few more). */
  purpose?: string
  /** What the agent wrote just before the call, in the same message. */
  note?: string
  input?: Record<string, unknown>
  output?: string
  isError?: boolean
}

/** What every agent event writes: kept small, since each write copies it whole. */
export type Panel = {
  rows: Row[]
  now: number
  opened: boolean
}

/** The detail pane's agent and its transcript, written only while the pane is open. */
export type Detail = {
  selected?: string
  recent: Step[]
  /** The `tool_use_id` of the call shown in full. */
  expanded?: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-panel': {
      panel: Panel
      detail: Detail
      /** Each agent's last answer, by agent id. */
      answer: StateFamily<string>
    }
  }
}
