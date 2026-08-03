# Session title workaround (`ai-title`)

`herdr-session-title.sh` generates Claude Code session titles itself. This is a
workaround for Claude having stopped generating them, and it is meant to be
reverted once the built-in generator works again.

Observed on Claude Code **2.1.220** (installed 2026-07-27).

## Symptom

Sessions show their first typed prompt everywhere a title should appear: the
Herdr tab, `/resume`, and the session pickers.

Claude still *reads* AI-generated titles — it just stopped writing them. In this
machine's history, 70 of 149 transcripts carry an `ai-title` entry, and the last
one was written **2026-07-28**, immediately after the 2.1.220 upgrade.

## What the CLI does internally

Titles are transcript entries, not session-file fields:

```json
{"type":"custom-title","customTitle":"…","sessionId":"…"}   // /rename
{"type":"ai-title","aiTitle":"…","sessionId":"…"}           // generated
```

Display precedence, from the minified bundle (`hKt`):

```js
agentName || customTitle || aiTitle || summary || firstPrompt || sessionId.slice(0,8)
```

The writer we imitate is `saveAiGeneratedTitle`:

```js
function BEe(e,t){ Ete(tD(e),{type:"ai-title",aiTitle:t,sessionId:e}) … }
```

So the hook appends exactly the record the CLI would have written. `/resume`
entries render `customTitle ?? aiTitle`, which is why generated titles show up
there too.

This was **not** disabled by a setting in this repo. The only guard on the
built-in generator is

```js
function Nne(){ return Ot.sessionPersistenceDisabled }
```

which is about non-persistent sessions (`--bare`, some SDK paths), not user
config. The remaining call sites are guarded by "already has a custom title".
The regression therefore looks like a change in the generator's trigger
conditions in 2.1.220.

## What the hook does

1. On `UserPromptSubmit` (and `SessionStart`), label the Herdr tab using
   Claude's own precedence: `customTitle`, then an explicit `claude -n` name
   (`nameSource == "user"`), then `aiTitle`, then the first typed prompt.
2. If none of the first three exist, spawn a detached `claude -p --model haiku`
   to summarise the first prompt, append the result as an `ai-title` entry, and
   rename the tab. Once per session; no hook ever blocks on it.

Notes:

- A user `/rename` always wins — the generating child re-checks for a
  `customTitle` before renaming the tab.
- Appends lead with a newline only when the transcript was left mid-line, so a
  partially written last entry cannot be corrupted.
- If the built-in generator starts firing again, both it and this hook may
  append an `ai-title` to a fresh session. Last write wins and the hook skips
  generation when one already exists, so the only cost is a duplicate entry.

## Checking whether it is fixed

Start a fresh session in a directory whose hook is disabled (or temporarily
remove the `UserPromptSubmit` entry), send one prompt, let the first turn
finish, then:

```sh
grep -c '"type":"ai-title"' ~/.claude/projects/*/<session-id>.jsonl
```

A non-zero count with a title the hook did not write means the built-in
generator is back.

## Reverting

1. Delete `claude/hooks/herdr-session-title.sh` and its `UserPromptSubmit` and
   `SessionStart` entries in `claude/settings.json`.
2. Delete this file.
3. Re-link: `scripts/link-config.py` (`~/.claude/hooks` is hardlinked/copied
   from the repo, so stale copies must be cleared).

Herdr tab labels then need another source. Options, best first:

- **Supported hook output.** `UserPromptSubmit` and `SessionStart` accept
  `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","sessionTitle":"…"}}`,
  documented in the bundle's schema as *"Set the session title"* and routed
  through the rename path with a distinct `"hook"` source. It is synchronous, so
  it cannot carry a title that takes seconds to generate, but it is the right
  API for setting a title the hook already knows. It writes a `customTitle`,
  which would shadow a later user `/rename`.
- **Read-only labelling.** Keep a trimmed hook that only reads
  `customTitle`/`aiTitle` from the transcript and renames the tab, dropping the
  generation half entirely.

## Rejected approach

Writing `name` / `nameSource` into `~/.claude/sessions/<pid>.json`. It does
survive the live session's rewrites (verified by probing this file while a
session was running), but the record is keyed by **pid**, so the title is lost
on `/resume`, and the schema is undocumented.
