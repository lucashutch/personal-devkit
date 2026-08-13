# V2 patch-only tools: findings

Measured with `@opencode-ai/cli@0.0.0-next-17288`, behaviour re-confirmed on
`next-17403`. Token counts are real provider usage, obtained by replaying a
captured request to OpenCode Zen with `max_tokens=1` and differencing, not
tiktoken estimates.

## What OpenCode does

The builtin patch tool is registered unconditionally, but only advertised to
`gpt-*` models. The gate is a builtin session context hook:

```js
if (l.model.id.includes("gpt-") && !l.model.id.includes("oss") && !l.model.id.includes("gpt-4")) {
  delete l.tools.edit
  delete l.tools.write
  return
}
delete l.tools.patch
```

Confirmed by capture: with an identical config and provider, `gpt-5.6-luna` is
offered `patch` and no `edit`/`write`, and `deepseek-v4-flash-free` the reverse.
Upstream's model-family system prompts follow the same split — the GPT prompt
mentions patch, the others never do.

## Why the plugin re-advertises instead of implementing a tool

The context hook's `tools` record is only the model-facing advertisement
(`Record<name, {description, input}>`); it carries no executor. The builtin tool
stays registered whatever the gate does, so adding the entry back routes to
OpenCode's own implementation, and execution, the `edit` permission, snapshot and
undo, and the metadata-driven TUI diff rendering all keep working. Verified end to
end: non-GPT models apply patches and the TUI renders `% Patch N files`.

A custom tool would have to reproduce the patch parser, the file operations, and
the `metadata.files[]`/`metadata.diff` shape that drives rendering. The plugin
API offers no alternative anyway: `tool.transform` exposes only `add`, with no
`remove` or `list`, so deleting from the context hook is the only way to hide a
builtin, and reading the builtin definition back is impossible.

External hooks run after the builtin ones, so patch is already gone when the
plugin runs and has to be re-added rather than preserved.

## Description: format by example

Cost of each candidate as total prompt tokens for one trivial turn, against a
948-token no-tools baseline (`gpt-5.6-luna` baseline 946, `grok-4.6` 1152):

| Description | Chars | DeepSeek | Luna | Grok 4.6 |
|---|---:|---:|---:|---:|
| one-liner, no format spec | 159 | 2,581 | 1,777 | 2,579 |
| **example (shipped)** | **153** | **2,601** | **1,804** | **2,608** |
| prose spec, terse | 422 | 2,676 | - | - |
| prose spec, full builtin text | 1,086 | 2,705 | 1,820 | - |

Showing the format costs a fraction of explaining it, and the shipped example is
fewer characters than the one-liner that omits the format entirely. Dropping the
`patchText` parameter description saved a further 17 tokens.

Tokenisers disagree about which text is cheap: the same 153 characters cost
DeepSeek 20 tokens above its floor and Luna 27. DeepSeek pays for prose, GPT pays
for `***` and `@@` symbol runs.

## Reliability

Two tasks. Small: update a file, create a file, and delete a file in one patch.
Large: three edits to a 202-line file whose target line appears 40 times, so a
hunk cannot be placed without real `@@` context.

| Model | Description | Runs | Runs with a rejected patch | Correct | Stray edits |
|---|---|---:|---:|---:|---:|
| deepseek-v4-flash-free | one-liner | 3 | 1 | 3 | 0 |
| deepseek-v4-flash-free | example | 12 | 1 | 12 | 0 |
| deepseek-v4-flash-free | full prose | 3 | 0 | 3 | 0 |
| gpt-5.6-luna | one-liner | 7 | 0 | 7 | 0 |
| gpt-5.6-luna | example | 3 | 0 | 3 | 0 |
| claude-sonnet-5 | example | 4 | 0 | 4 | 0 |

Findings:

- `@@` context was never the failure mode. Both models used the enclosing
  definition line as context and never touched the other 37 candidates.
- Every rejection was the envelope (`The first line of the patch must be
  '*** Begin Patch'`), and every one self-corrected on retry, so the end state
  was correct in all 32 runs. A retry costs a whole request, which is why the
  one-liner is a false economy: it saves 20 tokens and loses a ~2,600-token turn
  on roughly a third of DeepSeek's first attempts.
- The one-liner is sufficient for `gpt-*` models, which were trained on this
  format. Shipping one description for every model costs those models 13 tokens
  and removes a model-name test that would rot as providers rename models.
- `grok-4.6` applied one patch correctly, then produced malformed JSON tool
  arguments twice on unrelated tools before the account ran out of credit. Treat
  it as unproven: patch takes one large multi-line string, which is exactly what
  stresses argument escaping.
- `grok-4.5` could not be tested; its Zen endpoint was unavailable.

## Measurement notes

- Never trust tiktoken for non-OpenAI models here. Estimates were 0.5% low for
  `gpt-5.6-luna` and 44% low for `deepseek-v4-flash` (1,884 estimated against
  2,705 real). Every non-GPT figure above is real provider usage.
- Tools are the majority of a short turn: 1,653 of DeepSeek's 2,601 tokens (64%)
  and 858 of Luna's 1,804 (48%), for the same nine tools.
- `claude-sonnet-5` token usage cannot be measured through Zen, which reports
  `prompt_tokens: 2` regardless of payload. OpenCode records that value
  faithfully, so its own usage numbers are unusable for Sonnet too. An Anthropic
  key and `count_tokens` is the only exact route.
- `subagent` is now the most expensive advertised tool at about 200 tokens, 160
  of it schema. `slim-tools` only rewrites descriptions, so that cost is
  untouched and is the next worthwhile target.
