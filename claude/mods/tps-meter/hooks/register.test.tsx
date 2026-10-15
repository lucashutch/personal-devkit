import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepChunk, TurnUsage } from 'claude-code'

const usage = (output: number): TurnUsage => ({
  input_tokens: 10,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
})

const CHUNKS: TurnStepChunk[] = [
  { kind: 'thinking', index: 0, text: 'Let me think.' },
  { kind: 'text', index: 1, text: 'Hello there.' },
  { kind: 'tool', index: 2, id: 'toolu_1', name: 'Read' },
  { kind: 'input', index: 2, json: '{"file_path":"/a"}' },
] as TurnStepChunk[]

/** A model whose every request takes `durationMs` from being sent to its stream ending. */
function world(on: On, durationMs: number, output: TurnUsage | null) {
  const clock = mock.clock(on, { now: 1000 })
  const model = { output }
  // Draws the hint line as the terminal does: the engine's hint, then the tail.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{[e.props.hint, e.props.tail].filter(Boolean).join(' ')}</Text>
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('turn.step', async function* (_$, e) {
    // One advance per request: each costs the test kit real time while a hook is under way.
    yield* CHUNKS
    await clock.advance(durationMs)
    return { turnId: e.turnId, index: e.index, answer: 'Hello there.', toolUses: [], stopReason: 'tool_use', usage: model.output }
  })
  return model
}

async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId })
  const seen: TurnStepChunk[] = []
  for (let next = await stream.next(); ; next = await stream.next()) {
    if (next.done) return { seen, result: next.value }
    seen.push(next.value)
  }
}

/** The hint line under the prompt as drawn. */
async function hintLine($: Engine) {
  const ui = await $.ui.mount({
    plugin: 'tps-meter',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  return (await ui.find({ type: 'Text' }))?.text
}

const complete = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: 'Hello there.', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer', agentId })

test('chunks pass through unchanged and the hint line shows the turn rate once it completes', async ($, on) => {
  world(on, 2000, usage(150))

  const first = await step($)
  await step($)
  expect(await hintLine($), 'nothing before the turn completes').toBe('? for shortcuts')
  await complete($)

  expect(first.seen).toEqual(CHUNKS)
  expect(first.result.usage?.output_tokens).toBe(150)
  // 300 tokens over two 2s requests.
  expect(await hintLine($)).toBe('? for shortcuts 75.0 tok/s')
})

test('a subagent request inside the main turn leaves the main figure alone', async ($, on) => {
  const model = world(on, 2000, usage(150))

  await step($)
  // A subagent request without usage would blank the main figure if it counted.
  model.output = null
  const { seen } = await step($, 'agent-1')
  await complete($)

  expect(seen).toEqual(CHUNKS)
  expect(await hintLine($)).toBe('? for shortcuts 75.0 tok/s')
})
