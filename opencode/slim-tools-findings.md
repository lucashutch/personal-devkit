# OpenCode V2 slim-tools: findings

## Current implementation

`@opencode-ai/cli@0.0.0-next-15779` supplies a session hook that runs after
the built-in tools have been permission-filtered and immediately before the
model request is built. `shared/plugins/slim-tools` uses that hook to
replace only known tool and parameter descriptions. It preserves the actual
schemas, tool names, permissions, and executors.

The public plugin documentation calls this hook `request`, but this runtime
triggers it as `context`; the plugin must use `ctx.session.hook("context", …)`
until the documentation and implementation converge. The hook's `tools` value
is a record keyed by tool name, with `{ description, input }` values.

This supersedes the previous AI-SDK `language`-hook workaround. Because the
session hook precedes both native and AI-SDK model routes, it covers the home,
work, and test profiles and does not require a capture-provider package rename.

## Validation

Start the capture proxy, restart only the test service, then issue one harmless
test request:

```sh
cd /home/lucas/9999-personal/context-proxy-forward
uv run python context_proxy_forward.py --host 127.0.0.1 --port 1234

# In another terminal
o2t service restart
o2t run --model prompt-capture-openai/gpt-5.6-luna 'Reply with OK without calling tools'
```

The proxy intentionally may return a non-zero result when it is capture-only.
Inspect its newest `request.raw.json` and confirm that known tool descriptions
and their parameter descriptions equal `shared/lib/slim-tools-data.js`.

## Compatibility notes

- V2 plugin APIs are beta and may change. Re-run the capture validation after
  upgrading `@opencode-ai/cli@beta`.
- Plugin load failures are logged at
  `~/.local/share/opencode-v2-<profile>/opencode/log/opencode.log`.
- V2 loads and activates external **TUI** plugins through `cli.json`. This does
  not affect this server-side tool-description plugin.
