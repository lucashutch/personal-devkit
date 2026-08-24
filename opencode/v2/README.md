# OpenCode V2 extension compatibility

## Version

- CLI channel: `@opencode-ai/cli@beta`
- Verified: 2026-08-25

## Server plugins

V2 loads the profile plugins declared in each `opencode.json`. They export
`Plugin.define` from `@opencode-ai/plugin`, which resolves through the linked
plugin file back into `opencode/v2/node_modules`, so editors type the plugin
context. Settings come from each entry's `options` object rather than a
separate config file. The
`personal.slim-tools` plugin uses the runtime session-context hook to shorten
the model-facing descriptions and JSON-schema parameter descriptions of the
built-in tools. See [slim-tools-findings.md](slim-tools-findings.md) for its
implementation and capture-proxy validation procedure.

The published Promise and Effect plugin APIs both expose this hook as
`session.hook("context", ...)`.

The `personal.slim-skills` plugin uses the same session-context hook to replace
V2's verbose XML skill catalog with one `ID: description` line per skill. Skill
IDs and descriptions are preserved, so on-demand loading is unchanged.

## Model filter

V2 currently has no native provider/model whitelist, and per-model `disabled`
blocklists in `opencode.json` rot as providers add models (new entries appear
enabled until hand-blocked). Until whitelist support returns, the shared
`personal.model-filter` plugin (`shared/plugins/model-filter.js`) applies the
rules from its plugin `options` at the catalog level, following the same
per-profile pattern as delegate profiles. Rules are `provider/model`
strings with `*` glob wildcards (`provider/*` matches all models of a
provider); a model-only glob such as `*free*` matches free-named models from
every provider. Rules operate in one of two modes:
`allow` disables everything unlisted; `deny` disables only the listed models.
Remove the plugin and its options once V2 regains native whitelisting.

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

The beta API exposes the host renderer to external plugins
(`context.renderer`), so plugin-local `@opentui/solid` JSX renders with the
host's renderer. The Limitwatch quota and subagent-session plugins are enabled
in `shared/cli.json` and load from `shared/plugins/*/tui.tsx`.

`opencode/v2/package.json` declares only `@opencode-ai/plugin` on the `beta`
channel, matching the channel the installed CLI ships on, and without a
lockfile. `@opentui/*`, `solid-js`, and `@opencode-ai/theme`
are deliberately not declared: the host shares its renderer with the plugin, so
they must satisfy the peer requirements of the matching plugin package.
`@opencode-ai/plugin` declares those requirements but marks them optional, so
npm skips them. Therefore,
`scripts/link-config.py --opencode` reads the peers off the installed package and
installs them unsaved. No peer version is written down anywhere; a CLI upgrade
moves the peers and the next linker run follows.

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

The quota plugin stores its last result with the TUI's durable plugin storage.
New TUI instances can show cached quota data while the first refresh runs, and
running instances receive the same stored update.

A retired `reactivity-smoke` plugin established that repainting works: a
component-local one-second Solid counter, which distinguished a missing renderer
flush from a disconnected computation. Recreate it as a bare counter in a
`sidebar.content` claim if a future build appears to stop updating mounted
slots.
