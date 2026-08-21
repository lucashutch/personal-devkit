# OpenCode V2 extension compatibility

## Version

- CLI: `@opencode-ai/cli@0.0.0-next-16621`
- Verified: 2026-08-01

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

The `personal.slim-skills` plugin uses the same session-context hook to replace
V2's verbose XML skill catalog with one `ID: description` line per skill. Skill
IDs and descriptions are preserved, so on-demand loading is unchanged.

## Patch-only editing

V2 advertises the builtin patch tool to `gpt-*` models and edit plus write to
every other model. The `personal.patch-only-tools` plugin reverses that swap for
all models, using the same session-context hook: it drops edit and write and
re-advertises patch. Only the advertisement is model-facing, so OpenCode's own
executor, permissions, and diff rendering are unchanged and nothing reimplements
patching. See [patch-only-findings.md](patch-only-findings.md) for the gate it
reverses, the measured token costs, and the reliability runs across four models.

## Model filter

V2 currently has no native provider/model whitelist, and per-model `disabled`
blocklists in `opencode.json` rot as providers add models (new entries appear
enabled until hand-blocked). Until whitelist support returns, the shared
`personal.model-filter` plugin (`shared/plugins/model-filter.js`) applies each
profile's `model_config.json` at the catalog level, following the same
per-profile config pattern as delegate profiles. Rules are `provider/model`
strings with `*` glob wildcards (`provider/*` matches all models of a
provider); a model-only glob such as `*free*` matches free-named models from
every provider. Rules operate in one of two modes:
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

## TUI plugins: working

`next-16902` exposes the host renderer to external plugins
(`context.renderer`), so plugin-local `@opentui/solid` JSX now renders instead
of crashing with `No renderer found`. The Limitwatch quota and subagent-session
plugins are enabled in `shared/cli.json` and load from
`shared/plugins/*/tui.tsx`.

`opencode/v2/package.json` declares only `@opencode-ai/plugin` on the `next`
channel, without a lockfile. `@opentui/*`, `solid-js`, and `@opencode-ai/theme`
are deliberately not declared: the host shares its renderer with the plugin, so
they must be the exact builds the host was compiled against, and their latest
published releases do not match. `@opencode-ai/plugin` names those builds in its
peer dependencies, but marks them optional so npm skips them, so
`scripts/link-config.py --opencode` reads the peers off the installed package and
installs them unsaved. No version is written down anywhere; a CLI upgrade moves
the peers and the next run follows.

Install from that directory only, because the plugin loader resolves imports
from the plugin source tree. Rerun the linker after upgrading the CLI, both to
follow the peers and to expose extension API breakage.
Both plugins claim the `sidebar.content` slot with `append`. See
[limitwatch-tui-findings.md](limitwatch-tui-findings.md).

A mounted external slot now updates in place: the host repaints on
`context.renderer.requestRender()` rather than needing the slot torn down. Both
plugins call it after asynchronous state changes instead of disposing and
re-registering their claim, which also used to discard sidebar scroll position
and per-component child state. The subagent plugin still reconciles sessions and
status once per second to handle event/cache ordering and missed parallel status
transitions; that polling is unrelated to repainting.

A retired `reactivity-smoke` plugin established that repainting works: a
component-local one-second Solid counter, which distinguished a missing renderer
flush from a disconnected computation. Recreate it as a bare counter in a
`sidebar.content` claim if a future build appears to stop updating mounted
slots.
