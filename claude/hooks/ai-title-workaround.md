# Session titles under a pinned agent (`ai-title`)

`herdr-session-title.sh` generates Claude Code session titles itself. This is
**not** a stopgap for a Claude Code bug — it is the standing price of pinning a
default agent, and it should stay as long as `settings.agent` is set.

Verified on Claude Code **2.1.224** with Opus 5 (2026-08-07).

## Root cause

Pinning an agent suppresses the built-in title generator. The trigger in the
interactive REPL is guarded by (deminified from the 2.1.224 bundle):

```js
if (!titleDisabled && !sessionTitle && !aiTitle && !agentTitle && !attemptedRef.current)
```

A truthy **`agentTitle`** short-circuits it, so no `ai-title` is ever written.
This applies to `settings.agent` and to `--agent` alike — they are the same code
path, so a shell alias is not a way around it. Display precedence is

```js
agentName || customTitle || aiTitle || summary || firstPrompt || sessionId.slice(0,8)
```

so a pinned agent would also shadow a generated title in the tab regardless.

Confirmed by controlled runs on 2.1.224 (one prompt each, fresh config dir):

| Config | native `ai-title`? |
| --- | --- |
| no pin, no agent files | yes |
| pin set, agent file absent (pin inert) | yes |
| agent files present, no pin | yes |
| **pin set + agent file present** | **no** |

Upstream this is [claude-code#83876](https://github.com/anthropics/claude-code/issues/83876)
(open, no fix as of 2.1.226). [#81766](https://github.com/anthropics/claude-code/issues/81766)
is the same symptom seen from the VS Code extension. Nothing in the CHANGELOG
for 2.1.215-2.1.226 touches session titles.

### Superseded explanation

Earlier revisions of this file blamed a regression introduced in 2.1.220 and
stated the cause was "not a setting in this repo". Both were wrong. That guess
came from reading only `sessionPersistenceDisabled` and missing the `agentTitle`
term, plus a coincidence: `"agent": "General"` landed in `00a20a2` (2026-07-25)
and the last native title in local history is 2026-07-28, close enough to the
2.1.220 upgrade to look causal.

## Why the pin is worth keeping

Real tokens sent on the first request (`cache_creation_input_tokens`), Opus 5,
same prompt, fresh config:

| Config | Real tokens | System prompt | Tools | Skills |
| --- | --- | --- | --- | --- |
| plain, no pin | 17,224 | ~10.4k (derived) | 7.7k | 1.8k |
| **pin, with `Skill`** | **8,572** | 3.4k | 4.1k | 1.8k |
| pin, without `Skill` | 5,988 | 3.4k | 5.3k | none |
| `--system-prompt-file` only | 14,032 | - | 7.7k | 1.8k |
| `--system-prompt-file` + 7 `--tools` | 14,306 | - | 4.4k | 1.8k |

The pinned agent replaces Claude Code's default system prompt with General.md's
compact one, which is where most of the ~8.7k saving comes from. The flag-based
alternatives do not come close, so trading the pin away to recover native titles
would cost far more than this hook does.

Note that the `tools:` list in General.md must include **`Skill`** or skills are
not loaded at all (that is the 1.8k row disappearing above, and it is why `Skill`
was added on 2026-08-07).

Caveats on the table: one sample per config; a config dir without this repo's
`disableBundledSkills`, so the skills figure is bundled skills; and the
`System prompt` row is absent from `/context` in every config except the pinned
agent, unexplained. Haiku 4.5 gives wildly different numbers and must not be used
to reason about this.

## What the hook does

1. On `SessionStart`, `UserPromptSubmit` and `Stop`, label the Herdr tab using
   Claude's own precedence: `customTitle`, then an explicit `claude -n` name
   (`nameSource == "user"`), then `aiTitle`, then the first typed prompt, then
   the directory name.
2. If none of the first three exist, spawn a detached `claude -p --model haiku`
   to summarise the first prompt, append the result as an `ai-title` entry, and
   rename the tab. Once per session, started only from `UserPromptSubmit`; no
   hook ever blocks on it.

`SessionStart` covers a session switch: `/clear` and `/resume` both fire it, and
the directory fallback stops a cleared session from keeping the previous title.
`Stop` catches what neither can see in time, mainly a `/rename` mid-session and
a generated title that landed while another pane owned the tab. Claude has no
hook for the rename itself, so between a `/rename` and the end of the turn the
tab keeps the old label.

Entry shapes, both read by the CLI:

```json
{"type":"custom-title","customTitle":"…","sessionId":"…"}   // /rename
{"type":"ai-title","aiTitle":"…","sessionId":"…"}           // generated
```

The writer imitated is `saveAiGeneratedTitle`, so the hook appends exactly the
record the CLI would have written. `/resume` renders `customTitle ?? aiTitle`,
which is why generated titles show up there too.

Notes:

- A user `/rename` always wins — the generating child re-checks for a
  `customTitle` before renaming the tab.
- Appends lead with a newline only when the transcript was left mid-line, so a
  partially written last entry cannot be corrupted.
- Titles this hook writes are Title Case and at most 5 words; Claude's native
  ones are sentence case. That is how to tell them apart in a transcript.

## When to revisit

Only if the pin goes away, or if upstream stops letting `agentTitle` suppress
generation (watch #83876). To check the latter, temporarily unset
`settings.agent`, start a session, send one prompt, and look for a
**sentence-case** `ai-title`:

```sh
grep -o '"aiTitle":"[^"]*"' ~/.claude/projects/*/<session-id>.jsonl
```

If the pin is ever dropped, delete `herdr-session-title.sh` and its
`UserPromptSubmit` / `SessionStart` entries in `claude/settings.json`, then
re-run `scripts/link-config.py`. Herdr tab labels would then come from the
supported hook output instead:
`{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","sessionTitle":"…"}}`,
which is synchronous and writes a `customTitle`.

## Rejected approach

Writing `name` / `nameSource` into `~/.claude/sessions/<pid>.json`. It does
survive the live session's rewrites, but the record is keyed by **pid**, so the
title is lost on `/resume`, and the schema is undocumented.
