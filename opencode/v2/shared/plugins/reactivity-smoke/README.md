# TUI reactivity smoke plugin

## Purpose

Renders a one-second counter in `sidebar.content` to verify that a mounted
external TUI component reacts to plugin-local Solid signals. The timer also
calls `context.renderer.requestRender()` to distinguish a missing renderer
flush from a disconnected Solid computation. The counter should advance
continuously without hiding the sidebar, changing routes, or remounting the
slot.

## Configuration

- Plugin entry: `shared/cli.json` → `./shared/plugins/reactivity-smoke/tui.tsx`
- Expected output: `Plugin reactivity: 0s`, followed by `1s`, `2s`, and so on
- Dependencies: the shared packages installed from `opencode/v2/package.json`

The published package also exposes a legacy `TuiPluginModule` type under
`@opencode-ai/plugin/v1/tui`, but build `next-17028` rejects that module shape
at startup as `Invalid V2 TUI plugin module`. It is therefore not an alternate
loading path for this host.

V2 plugin dependencies intentionally track the current `next` channel. Do not
add a lockfile or pin preview builds; run `npm install --no-package-lock` from
`opencode/v2` after upgrading `opencode2`.

## Known result

With CLI, plugin, and theme build `0.0.0-next-17028`, the signal-only counter
remained at `0s` until the sidebar was hidden and shown. The current test also
requests an imperative renderer flush after each signal update. It uses a
component-local `createSignal`, creates its timer in `onMount`, cleans it up
with `onCleanup`, and returns the child component from `context.ui.slot`. This
isolates the failure from OpenCode data caches, `context.storage`, and the
production plugin logic.

Keep this plugin enabled while tracking the upstream external-slot reactivity
issue. Remove it from `shared/cli.json` once the counter advances normally.

## API compatibility

Build `next-17028` exports `@opencode-ai/plugin/tui`; it does not export the
newer `@opencode-ai/plugin/v2/tui` path used by current development examples.
Do not switch imports until the installed package exposes that export.
