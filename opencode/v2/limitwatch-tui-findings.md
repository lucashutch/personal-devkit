# V2 TUI plugin notes

Verified against the `@opencode-ai/cli@beta` plugin API on Linux/WSL2.

## Shared setup

- TUI plugins are listed in `shared/cli.json` as file paths, not directories.
- Both plugins use `@opencode-ai/plugin/tui` and `@opentui/solid` JSX.
- `opencode/v2/package.json` declares only `@opencode-ai/plugin@beta`. The
  renderer-sharing packages (`@opentui/*`, `solid-js`, `@opencode-ai/theme`) come
  from that package's optional peer dependencies, resolved at install time by
  `scripts/link-config.py --opencode`. Do not pin them separately from the
  plugin package; the linker follows its current exact versions or ranges.
- The profile config links `shared` into the active OpenCode config directory.
- External plugin errors appear as red TUI `Plugin` toasts.

## Current plugins

- `shared/plugins/limitwatch-quota/tui.tsx` renders quota data in the sidebar.
- `shared/plugins/subagent-sessions/tui.tsx` renders direct child sessions in
  the sidebar and links each row to its session.

Both use the `sidebar.content` slot, which is an additive slot; order follows
`shared/cli.json`.

## Upgrade checklist

1. Update the CLI.
2. Run `scripts/link-config.py --opencode`, which reinstalls the plugin tree at
   the host's peer versions.
3. Check `@opencode-ai/plugin/dist/tui/context.d.ts` for changed slot and data
   APIs. This surface has already broken twice: `ui.slot(path, render)` became
   `ui.slot({ append: path, render })`, and `@opentui`'s `<text bold>` became
   `attributes={TextAttributes.BOLD}`.
4. Restart the relevant OpenCode service; it keeps plugin modules in memory.
5. Check for plugin toasts, quota output, and a parent session with subagents.

The plugin-specific behavior and troubleshooting notes live beside each plugin
in its `README.md`.
