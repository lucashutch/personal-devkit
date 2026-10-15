import { expect, test } from 'claude-code/testing'

import { figureText } from './meter'

test('a turn divides all its output tokens by all its request time', () => {
  // 300 tokens over 2s and 100 over 3s: 400 tokens in 5s, not the mean of 150 and 33.
  expect(figureText([{ outputTokens: 300, durationMs: 2000 }, { outputTokens: 100, durationMs: 3000 }])).toBe('80.0 tok/s')
})

test('a turn with a request that has no usage shows no figure', () => {
  expect(figureText([{ outputTokens: 300, durationMs: 2000 }, { durationMs: 500 }])).toBe('')
})

test('a turn with no requests, tokens or time shows no figure', () => {
  expect(figureText([])).toBe('')
  expect(figureText([{ outputTokens: 0, durationMs: 2000 }])).toBe('')
  expect(figureText([{ outputTokens: 10, durationMs: 0 }])).toBe('')
})
