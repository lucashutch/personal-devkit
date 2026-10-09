import { expect, test } from 'claude-code/testing'

import {
  detail,
  finished,
  lines,
  mergeList,
  ordered,
  callMarkdown,
  clipInput,
  header,
  prune,
  recent,
  shortModel,
  stepLine,
  recordStep,
  recordTool,
  recordTurn,
  suggestions,
  summary,
  upgrade,
} from './panel'

const listed = (id: string, status = 'running') => ({
  id,
  description: `task ${id}`,
  type: 'general-purpose',
  status,
})

const usage = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model: 'claude-haiku-4-5-20251001',
})

test('T sums every token of every request and C is the last request, both kept across a refresh', () => {
  let rows = mergeList([], [listed('a')], 1000)
  rows = recordStep(rows, 'a', usage(3, 0, 9000, 20), 1500)
  rows = recordStep(rows, 'a', usage(2, 9000, 100, 40), 2000)
  rows = mergeList(rows, [listed('a', 'completed')], 3000)

  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ tokens: 18165, contextTokens: 9142, endedAt: 3000 })
  expect(lines(rows[0]!, 3000, 40)[2]).toContain('C:9.1k T:18k')
})

test('agent numbers follow spawn order and do not move when an agent finishes', () => {
  let rows = mergeList([], [listed('a'), listed('b')], 0)
  rows = mergeList(rows, [listed('a', 'completed'), listed('b'), listed('c')], 10)

  expect(rows.map(row => [row.id, row.n])).toEqual([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ])
  expect(ordered(rows).map(row => row.n)).toEqual([1, 2, 3])
})

test('a tool call from an agent the list has not named yet still gets a numbered row', () => {
  const rows = recordTool(mergeList([], [listed('a')], 0), 'wf-1', 'Read', 10)
  expect(rows[1]).toMatchObject({ id: 'wf-1', n: 2, tools: 1, status: 'running' })
  expect(mergeList(rows, [], 20)).toHaveLength(2)
})

test('agents the list stops naming do not stay running forever', () => {
  let rows = recordTool(mergeList([], [listed('a')], 0), 'wf-1', 'Read', 1)
  rows = recordTurn(rows, 'wf-1', 5, 'error')
  rows = mergeList(rows, [], 9)

  expect(rows.map(row => [row.id, row.status, row.endedAt])).toEqual([
    ['a', 'completed', 9],
    ['wf-1', 'failed', 5],
  ])
})

test('an agent counts as finished once, on the refresh that sees it stop', () => {
  const first = mergeList([], [listed('a'), listed('b')], 0)
  const second = mergeList(first, [listed('a', 'failed'), listed('b')], 10)
  const third = mergeList(second, [listed('a', 'failed'), listed('b')], 20)

  expect(finished(first, second).map(row => row.id)).toEqual(['a'])
  expect(finished(second, third)).toEqual([])
})

test('a finished agent shows its description, then its time, model, context and total indented below', () => {
  let rows = mergeList([], [listed('a')], 0)
  rows = recordStep(rows, 'a', usage(1, 0, 0, 1499), 1)
  rows = mergeList(rows, [listed('a', 'completed')], 12_000)

  expect(summary(rows[0]!, 99_000, 38)).toEqual(['✓ task a', ' 12s · Haiku 4.5 · C:1.5k T:1.5k'])
  expect(summary({ ...rows[0]!, description: 'x'.repeat(80) }, 0, 30)[0].length).toBeLessThanOrEqual(27)
})

test('the detail lists tools by use and keeps the answer', () => {
  let rows = mergeList([], [listed('a')], 0)
  for (const tool of ['Read', 'Bash', 'Read', 'Read', 'Edit']) rows = recordTool(rows, 'a', tool, 1)
  rows = recordTurn(rows, 'a', 3, 'answer')
  rows = mergeList(rows, [listed('a', 'completed')], 4000)

  const text = detail(rows[0]!, 9000, [{ tool: 'Read', text: 'README.md' }], '1 2 3')
  expect(text).toContain('Tools (5): Read×3 Bash Edit')
  expect(text).toContain('Recent:\n→ Read README.md')
  expect(text).toContain('Answer:\n1 2 3')
  expect(text).toContain('done')
})

const use = (tool: string, input: Record<string, unknown>, text?: string) => ({
  tool_use_id: `id-${tool}`,
  tool,
  input,
  ...(text === undefined ? {} : { text }),
})

test('recent keeps the last texts and tool calls in order, each call with what it ran', () => {
  const steps = recent(
    [
      { role: 'user', text: 'count', toolUses: [] },
      { role: 'assistant', text: 'Reading.\nmore', toolUses: [use('Read', { file_path: '/repo/src/a.ts' }, 'x')] },
      {
        role: 'assistant',
        text: '',
        toolUses: [
          use('Bash', { command: 'git status\n  --short', description: 'Show status' }),
          use('Grep', { pattern: 'TODO', path: '/repo/src' }),
          use('TaskStop', {}),
        ],
      },
    ],
    5,
    '/repo',
  )
  expect(steps.map(step => [step.tool, step.text])).toEqual([
    [undefined, 'Reading.'],
    ['Read', 'src/a.ts'],
    ['Bash', 'git status --short'],
    ['Grep', 'TODO in src'],
    ['TaskStop', ''],
  ])
  expect(steps[1]).toMatchObject({ id: 'id-Read', input: { file_path: '/repo/src/a.ts' }, output: 'x' })
  expect(steps[1]).toMatchObject({ note: 'Reading.\nmore' })
  expect(steps[2]).toMatchObject({ purpose: 'Show status' })
  expect(steps[2]!.note).toBeUndefined()
})

test('a call in full shows a Bash command as shell, other input as JSON, and output a fence cannot break', () => {
  const [bash, read] = recent(
    [
      {
        role: 'assistant',
        text: '',
        toolUses: [use('Bash', { command: 'cat README.md' }, '```js\nx\n```'), use('Read', { file_path: 'a' })],
      },
    ],
    5,
  )

  expect(callMarkdown(bash!)).toBe('**Input**\n\n```bash\ncat README.md\n```\n\n**Output**\n\n````\n```js\nx\n```\n````')
  expect(callMarkdown(read!)).toContain('```json\n{\n  "file_path": "a"\n}\n```')
  expect(callMarkdown(read!)).toContain('_Still running._')
})

test('completions offer the agents whose number starts with what was typed', () => {
  const rows = mergeList([], Array.from({ length: 12 }, (_, i) => listed(`a${i}`)), 0)
  expect(suggestions(rows, '1').map(s => s.text)).toEqual(['1', '10', '11', '12'])
  expect(suggestions(rows, '')).toHaveLength(12)
})

test('rows saved before agents had numbers get them in spawn order', () => {
  const old = mergeList([], [listed('a'), listed('b')], 0).map(({ n, toolCounts, ...row }, i) => ({
    ...row,
    startedAt: 10 - i,
  }))
  const rows = upgrade(old as never)

  expect(rows.map(row => [row.id, row.n])).toEqual([
    ['b', 1],
    ['a', 2],
  ])
  expect(rows[0]!.toolCounts).toEqual({})
})

test('a collapsed call is one line: tool and purpose, then what it ran, cut to the width', () => {
  const step = { id: '1', tool: 'Bash', purpose: 'Show status', text: 'git status --short --branch' }
  expect(stepLine(step, 50)).toEqual(['Bash Show status', ' git status --short --branch'])
  expect(stepLine(step, 24).join('')).toBe('Bash Show status git st…')
  expect(stepLine(step, 10)).toEqual(['Bash Show…', ''])
  expect(callMarkdown({ ...step, note: 'Check it.\nThen fix.' })).toMatch(/^\*\*Purpose:\*\* Show status\n\n\*\*The agent wrote first\*\*\n\n> Check it\.\n> Then fix\.\n\n\*\*Input/)
})

test('model ids read as people say them', () => {
  expect(
    ['claude-opus-5-5', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4-5[1m]', 'us.anthropic.claude-fable-5-1-v1:0'].map(shortModel),
  ).toEqual(['Opus 5.5', 'Haiku 4.5', 'Sonnet 3.5', 'Sonnet 4.5', 'Fable 5.1'])
})

test('a teammate idle between turns is neither finished nor working', () => {
  const first = mergeList([], [listed('a'), listed('b')], 0)
  const idle = mergeList(first, [listed('a', 'idle'), listed('b')], 10)

  expect(finished(first, idle)).toEqual([])
  expect(idle[0]!.endedAt).toBeUndefined()
  expect(header(idle)).toContain('1 working')
})

test('only the oldest finished rows are dropped once there are too many', () => {
  const many = Array.from({ length: 45 }, (_, i) => listed(`a${i}`, 'completed'))
  const rows = prune(mergeList([], [...many, listed('live')], 0))

  expect(rows).toHaveLength(41)
  expect(rows.some(row => row.id === 'live')).toBe(true)
  expect(rows.map(row => row.n).filter(n => n < 6)).toEqual([])
})

test('stored tool input keeps short fields and cuts long ones', () => {
  const input = clipInput({ file_path: 'a.ts', content: 'x'.repeat(10_000), edits: [{ old: 'y'.repeat(10_000) }] })

  expect(input.file_path).toBe('a.ts')
  expect((input.content as string).length).toBe(4000)
  expect(typeof input.edits).toBe('string')
})
