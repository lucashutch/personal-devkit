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

## Model filter

V2 currently has no native provider/model whitelist, and per-model `disabled`
blocklists in `opencode.json` rot as providers add models (new entries appear
enabled until hand-blocked). Until whitelist support returns, the shared
`personal.model-filter` plugin (`shared/plugins/model-filter.js`) applies each
profile's `model_config.json` at the catalog level, following the same
per-profile config pattern as delegate profiles. Rules are `provider/model`
strings (`provider/*` matches all models of a provider) in one of two modes:
`allow` disables everything unlisted; `deny` disables only the listed models.
Remove the plugin and configs once V2 regains native whitelisting.

## Delegate model profiles

All V2 profiles use a model-profile extension for the native `subagent` tool.
It preserves the native executor while adding
`fast`, `standard`, `deep`, and `inherit` through the session-context and
pre-execution hooks. See
[DELEGATE-PROFILES.md](DELEGATE-PROFILES.md) for model settings, implementation
details, beta dependencies, capture-proxy validation, upgrade steps, and known
limitations.

## Agents, commands, and skills

V2 carries the V1 on-demand orchestration setup: General remains the primary
agent, with Worker, WebResearcher, and Reviewer as bounded subagents. The lifecycle
and orchestration skills and their slash commands are linked into every V2
profile.

The port uses V2's ordered `permissions` rules instead of V1's `permission`
map. Tool names also differ (`subagent` replaces `task`, and `shell` replaces
`bash`). Subagents run with their own configured permissions rather than an
inherited subset of the parent's permissions, so Worker, WebResearcher, and
Reviewer explicitly deny further delegation. Skill IDs are path-derived and
case-sensitive in V2; the lowercase skill directory names are intentional.

V2's native `subagent` tool creates a fresh child session and can run in the
foreground or background. The orchestration skill therefore treats delegation
as an explicit context/latency cost and keeps cohesive work in the primary
session. Skill bodies are loaded on demand rather than injected into the
initial prompt. Command `subtask` metadata has no execution effect in V2, so
the ported commands explicitly tell General to load the corresponding skill.

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
