/** One main-loop model request of a turn. */
export type Step = {
  /** `usage.output_tokens`; absent when the API sent no usage (an error, an interrupt). */
  outputTokens?: number
  /** From the request being sent to its stream ending, in milliseconds. */
  durationMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'tps-meter': {
      /** The figure drawn at the end of the prompt hint line; empty for none. */
      figure: string
    }
  }
}
