import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Detail, Panel, Row } from '../types'
import {
  answerText,
  clip,
  clipAnswer,
  stepLine,
  callMarkdown,
  detail,
  detailHead,
  finished,
  formatElapsed,
  header,
  isRunning,
  lines,
  ordered,
  mergeList,
  recent,
  recordStep,
  recordTool,
  recordTurn,
  statusLabel,
  statusLine,
  statusMark,
  suggestions,
  summary,
  upgrade,
} from './panel'

const PANE = 'subagent-panel'
const DETAIL = 'subagent-detail'
const COMMAND = 'subagents'
const TITLE = 'Subagents'
const POLL_MS = 1000
const RECENT = 8
// Small dock: 40 columns wide, 14 rows when inline.
const SIZE = { columns: 40, rows: 14 } as const
const DETAIL_SIZE = { columns: SIZE.columns * 2, rows: 20 } as const

const panel = atom({ plugin: 'subagent-panel', key: 'panel' } as const, {
  rows: [],
  now: 0,
  opened: false,
} as Panel)
const detailView = atom({ plugin: 'subagent-panel', key: 'detail' } as const, { recent: [] } as Detail)

const readPanel = async ($: EngineInterface): Promise<Panel> => {
  const p = await read($, panel)
  return { ...p, rows: upgrade(p.rows) }
}

// How many detail-pane swaps are under way: their closes keep the dock wide.
let swaps = 0

let current = Promise.resolve()
let waiting: Promise<void> | undefined
const ignore = () => {}

// One refresh at a time, so an older agent list never lands over a newer one.
// Calls while one waits share it, so a slow refresh never builds a backlog.
function refresh($: EngineInterface): Promise<void> {
  waiting ??= current.then(() => {
    waiting = undefined
    current = refreshNow($).catch(ignore)
    return current
  })
  return waiting
}

async function refreshNow($: EngineInterface) {
  const [listed, now] = await Promise.all([$.agent.list(), $.clock.now()])
  let done: Row[] = []
  let dropped: Row[] = []
  const { rows } = await update($, panel, p => {
    const rows = mergeList(p.rows, listed, now)
    done = finished(p.rows, rows)
    dropped = p.rows.filter(old => !rows.some(row => row.id === old.id))
    return { ...p, rows, now }
  })
  alert($, done, rows)
  const clear = (id: string) => update($, atom({ plugin: 'subagent-panel', key: 'answer', id } as const, ''), () => '')
  await Promise.all(dropped.map(row => clear(row.id)))
  const { selected } = await read($, detailView)
  const shown = rows.find(row => row.id === selected)
  if (shown && (isRunning(shown) || done.some(row => row.id === shown.id))) await loadRecent($, shown.id)
  await showStatus($, rows)
}

/** Toast each agent that stopped; notify once the last one stops, or when one fails. */
function alert($: EngineInterface, done: Row[], rows: Row[]) {
  if (done.length === 0) return
  for (const row of done) {
    $.ui.toast(`${statusMark(row)} ${row.n}: ${row.description} · ${statusLabel(row)} · ${formatElapsed((row.endedAt ?? 0) - row.startedAt)}`)
  }
  const failed = done.find(row => row.status === 'failed')
  if (failed) $.ui.notify(`Subagent ${failed.n} failed: ${failed.description}`).catch(ignore)
  else if (!rows.some(isRunning)) {
    $.ui.notify(done.length === 1 ? `Subagent done: ${done[0]!.description}` : `${done.length} subagents done`).catch(ignore)
  }
}

/** Show a summary under the prompt while agents run and the list pane is out of sight. */
async function showStatus($: EngineInterface, rows: Row[]) {
  const panes = await $.ui.panes()
  const isVisible = panes.some(pane => pane.id === PANE && pane.isShown && pane.isPlaced)
  $.ui.status(isVisible ? undefined : statusLine(rows))
}

async function loadRecent($: EngineInterface, id: string) {
  const found = await $.session.messages({ agentId: id })
  // A finished agent may have no saved transcript: keep what was loaded while it ran.
  if ('deny' in found) return
  const steps = recent(found, RECENT, await $.session.cwd())
  await update($, detailView, d => (d.selected === id ? { ...d, recent: steps } : d))
}

const toggle = ($: EngineInterface, id: string) =>
  update($, detailView, d => ({ ...d, expanded: d.expanded === id ? undefined : id }))

async function openList($: EngineInterface, isAsked: boolean) {
  const opened = await $.ui.open({ id: PANE, title: TITLE, ...SIZE })
  if (!opened.isPlaced && !isAsked) {
    $.ui.toast(`The subagents pane needs a wider terminal. Run /${COMMAND} to show it.`)
  }
  await showStatus($, (await readPanel($)).rows)
}

async function openDetail($: EngineInterface, row: Row) {
  await update($, detailView, () => ({ selected: row.id, recent: [] }))
  await loadRecent($, row.id)
  // Opening an open id only retitles its tab, so reopen it to bring it to the front.
  if ((await $.ui.panes()).some(pane => pane.id === DETAIL)) {
    swaps++
    await $.ui.close({ id: DETAIL }).finally(() => swaps--)
  }
  const opened = await $.ui.open({ id: DETAIL, title: `Subagent ${row.n}`, focus: true, closeOnEscape: true, ...DETAIL_SIZE })
  await showStatus($, (await readPanel($)).rows)
  return opened
}

/** Record an agent's finished run, and alert for it when the agent list never names it. */
async function finishTurn($: EngineInterface, id: string, answer: string, reason: string) {
  const now = await $.clock.now()
  let done: Row[] = []
  const { rows } = await update($, panel, p => {
    const rows = recordTurn(p.rows, id, now, reason)
    done = finished(p.rows, rows)
    return { ...p, rows, now }
  })
  const stored = atom({ plugin: 'subagent-panel', key: 'answer', id } as const, '')
  if (answer) await update($, stored, () => clipAnswer(answer))
  alert($, done, rows)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Open the subagents pane, or show one agent: /subagents <n>',
      argumentHint: '[n]',
    })
    // Tick only while an agent runs, so an idle session never redraws.
    $.clock.every(POLL_MS, async () => {
      const { rows } = await readPanel($)
      if (rows.some(isRunning)) await refresh($)
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    await refresh($)
    const pick = Number.parseInt(e.args, 10)
    if (Number.isInteger(pick)) {
      const { rows, now } = await readPanel($)
      const row = rows.find(item => item.n === pick)
      if (!row) return { text: `No subagent ${pick}. There are ${rows.length}.` }
      const opened = await openDetail($, row)
      if (opened.isPlaced) return { text: `Showing subagent ${pick}.` }
      const { recent: steps } = await read($, detailView)

      const answer = await read($, atom({ plugin: 'subagent-panel', key: 'answer', id: row.id } as const, ''))

      return { text: detail(row, now, steps, answer) }
    }
    await openList($, true)

    return { text: 'Subagents pane opened.' }
  })

  on('prompt.autocomplete', async ($, e, next) => {
    const base = await next(e)
    const typed = new RegExp(`^/${COMMAND}\\s+(\\d*)$`).exec(e.text.slice(0, e.cursor))
    if (!typed) return base
    const { rows } = await readPanel($)

    return { suggestions: [...base.suggestions, ...suggestions(rows, typed[1] ?? '')] }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined) {
      void refresh($)
      // Open once, on the first spawn. A pane the person closes stays closed.
      let isFirst = false
      await update($, panel, p => {
        isFirst = !p.opened
        return { ...p, opened: true }
      })
      if (isFirst) openList($, false).catch(ignore)
    }

    return started
  })

  on('ui.close', { id: [PANE, DETAIL] }, async ($, e, next) => {
    // Read before any await: a swap's close must not narrow the dock.
    const isSwap = swaps > 0
    const closed = await next(e)
    if (e.id === DETAIL && !isSwap) {
      // Stop reloading a transcript nobody sees.
      await update($, detailView, () => ({ recent: [] }))
      // The dock is as wide as its last open asked: reopen the list to narrow it again.
      const isListOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
      if (isListOpen) await $.ui.open({ id: PANE, title: TITLE, ...SIZE }).catch(ignore)
    }
    await showStatus($, (await readPanel($)).rows)

    return closed
  })

  // Agent events record without waiting, so the panel never slows a tool call or a step.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const tool = e.tool
      void $.clock
        .now()
        .then(now => update($, panel, p => ({ ...p, rows: recordTool(p.rows, id, tool, now), now })))
        .catch(ignore)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const usage = step.usage
    if (e.agentId !== undefined && usage) {
      const id = e.agentId
      void $.clock
        .now()
        .then(now => update($, panel, p => ({ ...p, rows: recordStep(p.rows, id, usage, now), now })))
        .catch(ignore)
    }

    return step
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) void finishTurn($, e.agentId, e.answer, e.reason).catch(ignore)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { rows, now } = await readPanel($)
    const width = Math.max(10, (e.props.bodyColumns ?? 40) - 2)

    if (rows.length === 0) return <Text dimColor>No subagents yet.</Text>

    const viewed = e.props.view.agentId
    const viewing = rows.find(row => row.id === viewed)

    return (
      <Box flexDirection="column">
        <Text bold>{header(rows)}</Text>
        <Text dimColor>
          {viewed === undefined ? 'viewing main' : `viewing ${viewing?.type ?? 'agent'}`}
        </Text>
        <Text dimColor>Click a row for details, or focus the pane and press its number</Text>
        {ordered(rows).map(row => {
          const color = statusColor(row)
          const open = () => void openDetail($, row).catch(ignore)
          const hotkey = row.n <= 9 ? String(row.n) : undefined
          const prefix = hotkey ? '' : `${row.n}: `

          if (!isRunning(row)) {
            const [title, stats] = summary(row, now, width)

            return (
              <Box flexDirection="column">
                <Button key={row.id} plain hotkey={hotkey} onPress={open}>
                  <Text color={color}>
                    {prefix}
                    {title}
                  </Text>
                </Button>
                <Text color={color} dimColor>
                  {stats}
                </Text>
              </Box>
            )
          }

          const [title, state, stats] = lines(row, now, width)
          const mark = row.id === viewed ? '▶' : '▎'

          return (
            <Box flexDirection="column">
              <Button key={row.id} plain hotkey={hotkey} onPress={open}>
                <Text color={color} bold>
                  {prefix}
                  {title}
                </Text>
              </Button>
              <Text color={color}>{mark} {state}</Text>
              <Text color={color} dimColor>
                {mark} {stats}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: DETAIL }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const { rows, now } = await readPanel($)
    const { selected, recent: steps, expanded } = await read($, detailView)
    const row = rows.find(item => item.id === selected)
    // Cut lines here: a Button lays its text out again and wraps it.
    const width = Math.max(10, (e.props.bodyColumns ?? 80) - 2)

    if (!row) return <Text dimColor>No subagent selected.</Text>

    const [title, state, stats, tools] = detailHead(row, now)
    const answer = await read($, atom({ plugin: 'subagent-panel', key: 'answer', id: row.id } as const, ''))

    return (
      <Box flexDirection="column">
        <Text color={statusColor(row)} bold>
          {title}
        </Text>
        <Text>{state}</Text>
        <Text dimColor>{stats}</Text>
        <Text>{tools}</Text>
        {steps.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              Recent <Text dimColor>· click a call to see it in full</Text>
            </Text>
            {steps.map(step => {
              if (!step.id) {
                return <Text dimColor>{clip(step.text, width)}</Text>
              }
              const [main, ran] = stepLine(step, width - 2)

              return (
                <Box flexDirection="column">
                  <Button key={step.id} plain onPress={() => void toggle($, step.id!).catch(ignore)}>
                    <Text color={step.isError ? 'red' : undefined}>
                      {step.id === expanded ? '▾' : '▸'} {main}
                      <Text dimColor>{ran}</Text>
                    </Text>
                  </Button>
                  {step.id === expanded && (
                    <Box paddingLeft={2}>
                      <Markdown text={callMarkdown(step)} />
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Answer</Text>
          <Markdown text={answerText(row, answer)} />
        </Box>
        <Button key="close" role="dismiss" onPress={() => void $.ui.close({ id: DETAIL }).catch(ignore)}>
          Close
        </Button>
      </Box>
    )
  })
}

function statusColor(row: Row): string | undefined {
  if (row.status === 'idle') return 'cyan'
  if (isRunning(row)) return 'yellow'
  if (row.status === 'failed') return 'red'
  if (row.status === 'killed') return 'magenta'
  return 'green'
}
