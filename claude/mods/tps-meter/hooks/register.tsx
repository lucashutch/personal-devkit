import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Step } from '../types'
import { figureText } from './meter'

const figure = atom({ plugin: 'tps-meter', key: 'figure' } as const, '')

const ignore = () => {}

// The main loop's requests so far, by turn id, until the turn completes.
const turns = new Map<string, Promise<Step | undefined>[]>()

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    // A turn that never completed (a crash, a reload) must not keep its steps.
    if (e.agentId === undefined) turns.clear()
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // Subagents run their own steps in parallel; only the main loop's figures are shown.
    if (e.agentId !== undefined) return yield* next(e)

    // Not awaited: a streaming hook's own time counts against its budget.
    const started = $.clock.now().catch(() => undefined)
    let outputTokens: number | undefined
    try {
      const step = yield* next(e)
      outputTokens = step.usage?.output_tokens
      return step
    } finally {
      // A request that failed is recorded too, without usage, so its turn shows no figure.
      const recorded = Promise.all([started, $.clock.now()])
        .then(([startedAt, endedAt]) => (startedAt === undefined ? undefined : { outputTokens, durationMs: endedAt - startedAt }))
        .catch(() => undefined)
      turns.set(e.turnId, [...(turns.get(e.turnId) ?? []), recorded])
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const recorded = turns.get(e.turnId) ?? []
      turns.delete(e.turnId)
      const steps = (await Promise.all(recorded)).filter(step => step !== undefined)
      await update($, figure, () => figureText(steps)).catch(ignore)
    }
    return done
  })

  // The figure rides at the end of the hint line under the prompt, so it takes no row of its own.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, figure)
    if (!text) return next(e)
    const tail = e.props.tail ? `${e.props.tail} · ${text}` : text
    return next({ ...e, props: { ...e.props, tail } })
  })
}
