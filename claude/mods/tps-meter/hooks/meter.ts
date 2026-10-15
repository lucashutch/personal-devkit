import type { Step } from '../types'

/**
 * A turn's output tokens per second: every request's tokens over every request's duration,
 * summed before dividing so a long request weighs more. Undefined when a request has no usage.
 */
export function turnRate(steps: readonly Step[]): number | undefined {
  if (steps.length === 0 || steps.some(step => step.outputTokens === undefined)) return undefined
  const tokens = steps.reduce((sum, step) => sum + (step.outputTokens ?? 0), 0)
  const ms = steps.reduce((sum, step) => sum + step.durationMs, 0)
  if (tokens <= 0 || ms <= 0) return undefined
  return tokens / (ms / 1000)
}

/** The figure drawn on the hint line; empty when the turn has no rate. */
export function figureText(steps: readonly Step[]): string {
  const tps = turnRate(steps)
  return tps === undefined ? '' : `${tps.toFixed(1)} tok/s`
}
