import type { Row, Step } from '../types'

type Listed = {
  id: string
  description: string
  type: string
  status: string
}

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model?: string
}

type Message = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { tool_use_id: string; tool: string; input: Record<string, unknown>; text?: string; isError?: true }[]
}

// Long enough that a cut rarely lands inside a code block; one drawing holds 100000.
const MAX_ANSWER = 20_000
const MAX_OUTPUT = 8000
const MAX_NOTE = 2000
const MAX_INPUT = 4000
// Finished rows kept; the oldest go first.
const MAX_FINISHED = 40

const ENDED = new Set(['completed', 'failed', 'killed'])

/** Not ended: working, waiting, or a teammate idle between turns. */
export const isRunning = (row: Row) => !ENDED.has(row.status)

/** Running and not idle: what the working counts count. */
export const isWorking = (row: Row) => isRunning(row) && row.status !== 'idle'

const nextNumber = (rows: Row[]) => rows.reduce((max, row) => Math.max(max, row.n), 0) + 1

const blank = (id: string, n: number, now: number): Row => ({
  id,
  n,
  description: id,
  type: 'agent',
  status: 'running',
  isListed: false,
  tools: 0,
  toolCounts: {},
  tokens: 0,
  contextTokens: 0,
  turns: 0,
  startedAt: now,
})

/** Fill what rows saved by an older version of this mod lack: session state outlives a reload. */
export function upgrade(rows: Row[]): Row[] {
  if (rows.every(row => Number.isFinite(row.n) && row.toolCounts)) return rows
  let n = rows.reduce((max, row) => (Number.isFinite(row.n) ? Math.max(max, row.n) : max), 0)
  return [...rows]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(row => ({
      ...row,
      n: Number.isFinite(row.n) ? row.n : ++n,
      toolCounts: row.toolCounts ?? {},
      isListed: row.isListed ?? true,
    }))
}

const touch = (stored: Row[], id: string, now: number, change: (row: Row) => Row) => {
  const rows = upgrade(stored)
  const found = rows.some(row => row.id === id)
  const base = found ? rows : [...rows, blank(id, nextNumber(rows), now)]
  return base.map(row => (row.id === id ? change(row) : row))
}

/** Merge the engine's agent list into the rows, keeping the counters this mod kept. */
export function mergeList(stored: Row[], listed: Listed[], now: number): Row[] {
  const rows = upgrade(stored)
  const byId = new Map(rows.map(row => [row.id, row]))
  let n = nextNumber(rows)
  const merged = listed.map(({ id, description, type, status }) => {
    const old = byId.get(id) ?? blank(id, n++, now)
    const next: Row = { ...old, description, type, status, isListed: true }
    if (!isRunning(next) && old.endedAt === undefined) next.endedAt = now
    if (isRunning(next)) next.endedAt = undefined
    return next
  })
  // Keep rows the list no longer names (for example a workflow agent we saw by tool call).
  // A listed agent the engine dropped has ended.
  const kept = rows
    .filter(row => !listed.some(item => item.id === row.id))
    .map(row => (row.isListed && isRunning(row) ? { ...row, status: 'completed', endedAt: now } : row))
  return prune([...merged, ...kept])
}

/** Drop the oldest finished rows past `MAX_FINISHED`, so a long session's state stays small. */
export function prune(rows: Row[]): Row[] {
  const done = rows.filter(row => !isRunning(row)).sort((a, b) => a.n - b.n)
  const dropped = new Set(done.slice(0, Math.max(0, done.length - MAX_FINISHED)).map(row => row.id))
  return dropped.size ? rows.filter(row => !dropped.has(row.id)) : rows
}

/** The answer as stored: long enough that a cut rarely lands inside a code block. */
export const clipAnswer = (answer: string) => clip(answer, MAX_ANSWER)

/** Rows that were running before a merge and are not after it. */
export const finished = (before: Row[], after: Row[]): Row[] =>
  after.filter(row => !isRunning(row) && before.some(old => old.id === row.id && isRunning(old)))

export const recordTool = (rows: Row[], id: string, tool: string, now: number) =>
  touch(rows, id, now, row => ({
    ...row,
    tools: row.tools + 1,
    lastTool: tool,
    toolCounts: { ...row.toolCounts, [tool]: (row.toolCounts[tool] ?? 0) + 1 },
  }))

/** Count one API request: `turn.step` reports each request's own usage. */
export function recordStep(rows: Row[], id: string, usage: Usage, now: number): Row[] {
  const size =
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens
  return touch(rows, id, now, row => ({
    ...row,
    tokens: row.tokens + size,
    contextTokens: size,
    model: usage.model ?? row.model,
  }))
}

const END_STATUS: Record<string, string> = { answer: 'completed', aborted: 'killed', refusal: 'failed', error: 'failed' }

/** Count a finished run. A row the list never names takes its end from the run's `reason`. */
export const recordTurn = (rows: Row[], id: string, now: number, reason?: string) =>
  touch(rows, id, now, row => ({
    ...row,
    ...(!row.isListed && reason ? { status: END_STATUS[reason] ?? 'completed', endedAt: now } : {}),
    turns: row.turns + 1,
  }))

export function statusLabel(row: Row): string {
  switch (row.status) {
    case 'running':
    case 'pending':
      return 'working'
    case 'completed':
      return 'done'
    case 'killed':
      return 'interrupted'
    default:
      return row.status
  }
}

export function statusMark(row: Row): string {
  switch (row.status) {
    case 'completed':
      return '✓'
    case 'failed':
      return '✗'
    case 'killed':
      return '■'
    default:
      return '▎'
  }
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** A model id as people say it: `claude-opus-5-5` is `Opus 5.5`, `claude-haiku-4-5-20251001` is `Haiku 4.5`. */
export function shortModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const id = model.replace(/^.*claude-/, '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  const parts = id.split('-')
  const name = parts.find(part => /^[a-z]+$/i.test(part))
  if (!name) return id
  const version = parts.filter(part => /^\d+$/.test(part)).join('.')
  return `${name[0]!.toUpperCase()}${name.slice(1)}${version ? ` ${version}` : ''}`
}

/** Cut text to `width` cells so each row stays on one line. */
export function clip(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`
}

const elapsed = (row: Row, now: number) => formatElapsed((row.endedAt ?? now) - row.startedAt)

const usageText = (row: Row) =>
  row.tokens > 0 ? `C:${formatTokens(row.contextTokens)} T:${formatTokens(row.tokens)}` : undefined

/** Tools by use, most used first: `Read×5 Bash×2`. */
export const toolSummary = (row: Row): string =>
  Object.entries(row.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => (count === 1 ? tool : `${tool}×${count}`))
    .join(' ')

/** A running agent's three lines. The title leaves room for the `n: ` prefix. */
export function lines(row: Row, now: number, width: number): [string, string, string] {
  const second = [row.type, statusLabel(row), elapsed(row, now)].join(' · ')
  const third = [shortModel(row.model), usageText(row), row.tools > 0 ? toolSummary(row) : undefined]
    .filter(Boolean)
    .join(' · ')
  return [
    clip(row.description, width - String(row.n).length - 2),
    clip(second, width),
    clip(third || '-', width),
  ]
}

/** A finished agent's two lines: its mark and description after the `n: ` prefix, then its time, model and tokens, indented. */
export function summary(row: Row, now: number, width: number): [string, string] {
  const stats = [elapsed(row, now), shortModel(row.model), usageText(row)].filter(Boolean).join(' · ')
  return [
    `${statusMark(row)} ${clip(row.description, width - String(row.n).length - 4)}`,
    clip(` ${stats}`, width),
  ]
}

/** Spawn order, oldest first. */
export const ordered = (rows: Row[]): Row[] => [...rows].sort((a, b) => a.n - b.n)

export const header = (rows: Row[]): string => {
  const working = rows.filter(isWorking).length
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)
  return `${rows.length} total · ${working} working · T:${formatTokens(total)}`
}

/** The status line while the pane is out of sight; nothing once every agent stopped. */
export function statusLine(rows: Row[]): string | undefined {
  const working = rows.filter(isWorking)
  if (working.length === 0) return undefined
  const total = working.reduce((sum, row) => sum + row.tokens, 0)
  return `subagents: ${working.length} working · T:${formatTokens(total)}`
}

const HINT_FIELDS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']

/** What a tool call ran, on one line: a Bash command, a path, a pattern. Paths under `cwd` are relative. */
export function toolHint(input: unknown, cwd = ''): string {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
  const key = HINT_FIELDS.find(name => isText(fields[name]))
  const value = key ? fields[key] : Object.values(fields).find(isText)
  if (!isText(value)) return ''
  const where = key === 'pattern' && isText(fields.path) ? ` in ${fields.path}` : ''
  const hint = `${value}${where}`.replace(/\s+/g, ' ').trim()
  return cwd ? hint.split(`${cwd}/`).join('') : hint
}

/** The last tool calls and texts of an agent's transcript, oldest first. */
export function recent(messages: readonly Message[], limit: number, cwd = ''): Step[] {
  const out = messages
    .filter(message => message.role === 'assistant')
    .flatMap((message): Step[] => {
      const note = message.text.trim()
      const purpose = (input: Record<string, unknown>) =>
        typeof input.description === 'string' && input.description.trim() ? { purpose: input.description.trim() } : {}
      return [
        ...(note ? [{ text: note.split('\n')[0]! }] : []),
        ...message.toolUses.map(use => ({
          id: use.tool_use_id,
          tool: use.tool,
          text: toolHint(use.input, cwd),
          ...purpose(use.input),
          ...(note ? { note: clip(note, MAX_NOTE) } : {}),
          input: clipInput(use.input),
          ...(use.text === undefined ? {} : { output: clip(use.text, MAX_OUTPUT) }),
          ...(use.isError ? { isError: true } : {}),
        })),
      ]
    })
  return out.slice(-limit)
}

/** Tool input as stored: long text fields cut, so a Write does not keep a whole file. */
export function clipInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value === 'string') return [key, clip(value, MAX_INPUT)]
      const text = JSON.stringify(value) ?? ''
      return [key, text.length > MAX_INPUT ? clip(text, MAX_INPUT) : value]
    }),
  )
}

/** A code block whose fence no backtick run inside `text` can close. */
export function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(run => run[0].length))
  const bar = '`'.repeat(longest + 1)
  return `${bar}${lang}\n${text}\n${bar}`
}

/** A tool call in full, as markdown: what it was given, then what it answered. */
export function callMarkdown(step: Step): string {
  const input = step.input ?? {}
  const shown =
    step.tool === 'Bash' && typeof input.command === 'string'
      ? fence(input.command, 'bash')
      : fence(JSON.stringify(input, null, 2), 'json')
  const output =
    step.output === undefined ? '_Still running._' : step.output.trim() ? fence(step.output) : '_No output._'
  const why = [
    step.purpose ? `**Purpose:** ${step.purpose}` : undefined,
    step.note ? `**The agent wrote first**\n\n${step.note.replace(/^/gm, '> ')}` : undefined,
  ].filter(Boolean)
  return `${why.map(part => `${part}\n\n`).join('')}**Input**\n\n${shown}\n\n**${step.isError ? 'Error' : 'Output'}**\n\n${output}`
}

/** A collapsed call's one line, cut to `width`: the tool and its purpose, then what it ran, dim. */
export function stepLine(step: Step, width: number): [string, string] {
  const main = clip(step.purpose ? `${step.tool} ${step.purpose}` : `${step.tool}`, width)
  const room = width - main.length - 1
  return [main, step.text && room >= 2 ? ` ${clip(step.text, room)}` : '']
}

export const stepText = (step: Step): string =>
  step.tool ? `→ ${step.tool}${step.text ? ` ${step.text}` : ''}` : step.text

/** The detail view's head: title, state, usage, and tools. */
export function detailHead(row: Row, now: number): [string, string, string, string] {
  return [
    `${row.n}: ${row.description}`,
    [row.type, statusLabel(row), elapsed(row, now), shortModel(row.model)].filter(Boolean).join(' · '),
    [usageText(row), `${row.turns} turn${row.turns === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
    `Tools (${row.tools}): ${toolSummary(row) || 'none'}`,
  ]
}

export const answerText = (row: Row, answer: string): string =>
  answer || (isRunning(row) ? 'Still running.' : 'No answer recorded.')

/** What `/subagents <n>` prints when the detail pane cannot be drawn. */
export function detail(row: Row, now: number, lastSteps: Step[] = [], answer = ''): string {
  return [
    ...detailHead(row, now),
    ...(lastSteps.length ? ['Recent:', ...lastSteps.map(stepText)] : []),
    `Answer:\n${answerText(row, answer)}`,
  ].join('\n')
}

/** Completions for `/subagents <n>`: the agents whose number starts with what was typed. */
export const suggestions = (rows: Row[], typed: string) =>
  ordered(rows)
    .filter(row => String(row.n).startsWith(typed))
    .map(row => ({
      text: String(row.n),
      label: `${row.n}: ${row.description}`,
      description: `${row.type} · ${statusLabel(row)}`,
    }))
