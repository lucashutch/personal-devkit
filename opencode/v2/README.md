# OpenCode V2 extension compatibility

## Version

- CLI: `@opencode-ai/cli@0.0.0-next-15788`
- Verified: 2026-07-18

## Server plugins

V2 loads the profile plugins declared in each `opencode.json`. The
`personal.slim-tools` plugin uses the runtime session-context hook to shorten
the model-facing descriptions and JSON-schema parameter descriptions of the
built-in tools. See [slim-tools-findings.md](slim-tools-findings.md) for its
implementation and capture-proxy validation procedure.

The public plugin documentation currently describes the hook as `request`,
while this CLI release implements it as `context`. The plugin intentionally
uses the runtime name. Revalidate after every V2 upgrade because this is beta
API surface.

## Delegate model profiles

All V2 profiles use a model-profile extension for the native `subagent` tool.
It preserves the native executor while adding
`fast`, `standard`, `deep`, and `inherit` through the session-context and
pre-execution hooks. See
[DELEGATE-PROFILES.md](DELEGATE-PROFILES.md) for model settings, implementation
details, beta dependencies, capture-proxy validation, upgrade steps, and known
limitations.

## TUI plugins: blocked

V2 contains the same TUI slot API used by V1 (`sidebar_content`,
`sidebar_footer`, and related slots), but it does not yet load external TUI
plugins from `cli.json`. The staged Limitwatch plugin is therefore inert; see
[limitwatch-tui-findings.md](limitwatch-tui-findings.md).

The V1 `subagent-sessions-plugin` is affected by the same limitation. Its
sidebar child-session view depends on `api.slots.register`, so it cannot be
ported as a functioning V2 sidebar plugin until the V2 external TUI-plugin
loader lands. The existing V1 plugin remains the supported implementation.

When V2 does load external TUI plugins, port the V1
`opencode/v1/shared/plugins/subagent-sessions-plugin/` directory alongside the
already staged Limitwatch plugin, then verify session-created, session-updated,
and session-deleted refreshes in the V2 sidebar.
