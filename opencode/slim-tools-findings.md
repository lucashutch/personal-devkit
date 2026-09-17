# slim-tools: findings

## Current implementation

The session-context hook runs after the built-in tools have been
permission-filtered and immediately before the model request is built.
`plugins/slim-tools` uses that hook to
replace only known tool and parameter descriptions. It preserves the actual
schemas, tool names, permissions, and executors.

The plugin registers `ctx.session.hook("context", …)`. The hook's `tools`
value is a record keyed by tool name, with `{ description, input }` values.
The capture below verified this on `@opencode-ai/cli@0.0.0-beta-19271`, the
last beta before the 2.x rename. It has not been recaptured on 2.x.

This supersedes the previous AI-SDK `language`-hook workaround. Because the
session hook precedes both native and AI-SDK model routes, it covers the home,
work, and test profiles and does not require a capture-provider package rename.

## What the wording keeps

The descriptions are not minimized for token count alone. They retain search
and timeout defaults, PDF support, line-prefix handling, exact edit
constraints, background notifications without polling, subagent roles and the
model routing matrix, explicit user-named skills, and question UI conventions.
The shell timeout documents the upstream defaults without inventing a maximum.
Subagent resumes preserve the child's model unless the user explicitly asks to
change it. The patch-language instructions are unchanged, as is `slim-skills`.

## Token measurements

Captured through the isolated test profile with `--standalone` against a
local-only handler; no request went upstream. Counts use the proxy's
`o200k_base` tokenizer and TypeScript tool-render estimate, not billed provider
usage. Both rows use the same messages with `slim-skills` enabled, so only tool
and parameter descriptions differ.

| Wording | Tool tokens | Whole prompt tokens |
|---|---:|---:|
| Original | 1,831 | 3,241 |
| Slim | 1,236 | 2,646 |

That saves 595 tool tokens, a 32.5% reduction.

| Tool | Original | Slim |
|---|---:|---:|
| `glob` | 95 | 75 |
| `grep` | 177 | 115 |
| `patch` | 299 | 297 |
| `question` | 209 | 134 |
| `read` | 170 | 106 |
| `shell` | 224 | 126 |
| `skill` | 76 | 62 |
| `subagent` | 449 | 216 |
| `webfetch` | 132 | 105 |

The captured tool definitions match the plugin's output exactly, and the
schemas match the original once description strings are removed. The Luna route
does not expose `edit`, `write`, or `execute`, so those rewrites are unmeasured.
A numeric audit of all 44 captured tool and schema descriptions found no numbers
absent from their upstream descriptions and constraints. This checks plugin
integration and prompt size, not model task performance.

## Validation

Start the capture proxy, then use a private server for a harmless test request
so the plugin reloads without restarting a shared service:

```sh
cd /home/lucas/9999-personal/context-proxy-forward
uv run python context_proxy_forward.py --host 127.0.0.1 --port 1234

# In another terminal
oct run --standalone --model prompt-capture-openai/gpt-5.6-luna 'Reply with OK without calling tools'
```

The proxy forwards OpenAI chat requests by default, even with a dummy key.
For local-only estimates, use a capture-only handler calling the proxy's
`analyse_request` and `write_reports` functions instead. A capture-only error
is expected; no model generates a response. Inspect the newest
`request.raw.json` and confirm that known tool descriptions and their
parameter descriptions equal `lib/slim-tools-data.js`.

Run the plugin tests alongside a capture:

```sh
node --test opencode/plugins/*.test.mjs
```

They cover preservation of the native delegation schema and executor, retention
of upstream patch grammar, and the absence of an invented shell timeout cap.

## Compatibility notes

- Plugin APIs still change between releases. Re-run the capture validation
  after upgrading `@opencode/cli`.
- Plugin load failures are logged at
  `~/.local/share/opencode-<profile>/opencode/log/opencode.log`.
