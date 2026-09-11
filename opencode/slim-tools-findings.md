# OpenCode V2 slim-tools: findings

## Current implementation

The session-context hook runs after the built-in tools have been
permission-filtered and immediately before the model request is built.
`plugins/slim-tools` uses that hook to
replace only known tool and parameter descriptions. It preserves the actual
schemas, tool names, permissions, and executors.

The plugin registers `ctx.session.hook("context", …)`. The hook's `tools`
value is a record keyed by tool name, with `{ description, input }` values.
The capture below verified this on `@opencode-ai/cli@0.0.0-beta-19271`.

This supersedes the previous AI-SDK `language`-hook workaround. Because the
session hook precedes both native and AI-SDK model routes, it covers the home,
work, and test profiles and does not require a capture-provider package rename.

## Validation

Start the capture proxy, then use a private server for a harmless test request
so the plugin reloads without restarting a shared service:

```sh
cd /home/lucas/9999-personal/context-proxy-forward
uv run python context_proxy_forward.py --host 127.0.0.1 --port 1234

# In another terminal
o2t run --standalone --model prompt-capture-openai/gpt-5.6-luna 'Reply with OK without calling tools'
```

The proxy forwards OpenAI chat requests by default, even with a dummy key.
For local-only estimates, use a capture-only handler calling the proxy's
`analyse_request` and `write_reports` functions instead. A capture-only error
is expected; no model generates a response. Inspect the newest
`request.raw.json` and confirm that known tool descriptions and their
parameter descriptions equal `lib/slim-tools-data.js`.

## Wording revision and Luna capture, 2026-09-11

The revision restores operational details rather than minimizing token count
alone: search and timeout defaults, PDF support, line-prefix handling, exact
edit constraints, background notifications without polling, subagent roles
and model profiles, explicit user-named skills, and question UI conventions.
The shell timeout documents the upstream defaults without inventing a maximum.
Subagent resumes explicitly require `inherit` or a profile matching the child's
model and variant.
The patch-language instructions remain unchanged. `slim-skills` is unchanged.

The fresh request went through the isolated test profile with `--standalone`
to a local-only capture handler. No request went upstream. Counts use the
proxy's `o200k_base` tokenizer and TypeScript tool-render estimate, not billed
provider usage.

For a controlled comparison, all three versions below use the same messages
from the earlier both-plugins capture, with `slim-skills` enabled. Only tool
descriptions and parameter descriptions differ.

| Wording | Tool tokens | Whole prompt tokens |
|---|---:|---:|
| Original | 1,831 | 3,241 |
| Previous slim | 1,077 | 2,487 |
| Revised slim | 1,236 | 2,646 |

The revision adds 159 tool tokens over the previous wording. It still saves
595 tool tokens against the original, a 32.5% reduction, retaining 78.9% of
the previous tool-token savings.

| Tool | Original | Previous slim | Revised slim |
|---|---:|---:|---:|
| `glob` | 95 | 61 | 75 |
| `grep` | 177 | 94 | 115 |
| `patch` | 299 | 294 | 297 |
| `question` | 209 | 124 | 134 |
| `read` | 170 | 75 | 106 |
| `shell` | 224 | 117 | 126 |
| `skill` | 76 | 57 | 62 |
| `subagent` | 449 | 168 | 216 |
| `webfetch` | 132 | 87 | 105 |

The fresh capture also totals 2,646 estimated prompt tokens. Its messages
match the controlled comparison except for the session ID, which has the same
token count. Its tool definitions exactly match the plugin's output, and schemas match the
original after removing description strings. The Luna route does not expose
`edit`, `write`, or `execute`, so this capture does not measure those rewrites.

Artifacts are under
`~/9999-personal/context-proxy-forward/proxy-captures/slim-ab/openai-luna-reworked/`:

- `opencode-gpt-5.6-luna-20260911-050438-270e837f/`: final request and token reports.
- `comparison-final.json`: controlled comparison and per-tool estimates.

Other captures and reports in that directory are intermediate revisions.

Validation: all 53 tests passed with `node --test opencode/plugins/*.test.mjs`.
The added tests cover every configured delegation role/profile, preservation
of the delegation schema and executor, retention of upstream patch grammar,
and the absence of an invented shell timeout cap. A numeric audit of all 44
captured tool/schema descriptions found no numbers absent from their upstream
descriptions and constraints.
This checks plugin integration and prompt size, not model task performance.

## Compatibility notes

- V2 plugin APIs are beta and may change. Re-run the capture validation after
  upgrading `@opencode-ai/cli@beta`.
- Plugin load failures are logged at
  `~/.local/share/opencode-v2-<profile>/opencode/log/opencode.log`.
- V2 loads and activates external **TUI** plugins through `cli.json`. This does
  not affect this server-side tool-description plugin.
