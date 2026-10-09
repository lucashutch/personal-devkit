import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, TurnUsage } from 'claude-code'

const PLUGIN = 'subagent-panel'
const ORIGIN = { plugin: 'engine', tier: 'core' } as const

const usage = (input: number, cacheRead: number, cacheWrite: number, output: number): TurnUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model: 'claude-haiku-4-5-20251001',
})

const listed = (id: string, status: AgentInfo['status']): AgentInfo => ({
  id,
  description: `task ${id}`,
  type: 'general-purpose',
  status,
})

// `.result` alone never starts the stream: read it to the end, as the query loop does.
async function step($: Engine, agentId: string, index: number) {
  const stream = $.turn.step({ turnId: `t-${agentId}`, index, model: 'claude-haiku-4-5', messageCount: 1, agentId })
  for await (const _chunk of stream);
  return stream.result
}

/** Answer what the plugin asks of the engine, keeping the agent list and each notify for the test. */
function world(on: On) {
  const clock = mock.clock(on, { now: 1000 })
  const state = { agents: [] as AgentInfo[], notes: [] as string[] }
  on('agent.list', async () => ({ value: state.agents }))
  on('ui.notify', async (_$, e) => {
    state.notes.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } as const }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } as const }))
  on('ui.panes', async () => ({ value: [] }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: 'a' }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  return { clock, state }
}

test('the list pane shows C as the last request and T as every request, all four token kinds counted', async ($, on) => {
  const { clock } = world(on)
  const steps = [usage(3, 0, 9000, 20), usage(2, 9000, 100, 40)]
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: steps[e.index]! }
  })

  for (const index of [0, 1]) {
    await step($, 'a', index)
    await clock.settle()
  }

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'subagent-panel',
    props: {
      title: 'Subagents',
      isFocused: false,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 14 },
      view: {},
    },
  })
  const stats = await ui.find({ type: 'Text', text: /C:/ })
  expect(stats?.text).toContain('C:9.1k T:18k')
})

test('one notify when the last agent stops, including one the agent list never names', async ($, on) => {
  const { clock, state } = world(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage(1, 0, 0, 1) }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  state.agents = [listed('a', 'running')]
  await $.agent.spawn({
    tool_use_id: 'toolu_a',
    prompt: 'go',
    description: 'task a',
    subagentType: 'general-purpose',
    provider: ORIGIN,
    parentModel: 'claude-opus-4-5',
    background: true,
    fork: false,
  })
  // A workflow agent: only its own events name it.
  await step($, 'b', 0)
  await clock.advance(3000)

  state.agents = [listed('a', 'completed')]
  await clock.advance(5000)
  expect(state.notes, 'b still runs').toEqual([])

  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't-b', agentId: 'b', reason: 'answer' })
  await clock.advance(5000)
  expect(state.notes).toEqual(['Subagent done: b'])
})
