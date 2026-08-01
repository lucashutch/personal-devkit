# V2 TUI plugin notes

Verified with `@opencode-ai/cli@0.0.0-next-16621` on Linux/WSL2.

## Shared setup

- TUI plugins are listed in `shared/cli.json` as file paths, not directories.
- Both plugins use `@opencode-ai/plugin/tui` and `@opentui/solid` JSX.
- Dependencies are pinned in `opencode/v2/package.json`; keep
  `@opencode-ai/plugin` aligned with the installed CLI and run `npm install`
  after upgrades.
- The profile config links `shared` into the active OpenCode config directory.
- External plugin errors appear as red TUI `Plugin` toasts.

## Current plugins

- `shared/plugins/limitwatch-quota/tui.tsx` renders quota data in the sidebar.
- `shared/plugins/subagent-sessions/tui.tsx` renders direct child sessions in
  the sidebar and links each row to its session.

Both use the `sidebar.content` slot, which is an additive slot; order follows
`shared/cli.json`.

## Upgrade checklist

1. Update the CLI and matching package pins.
2. Run `npm install` in `opencode/v2`.
3. Check `@opencode-ai/plugin/dist/tui/context.d.ts` for changed slot and data
   APIs.
4. Restart the relevant OpenCode service; it keeps plugin modules in memory.
5. Check for plugin toasts, quota output, and a parent session with subagents.

The plugin-specific behavior and troubleshooting notes live beside each plugin
in its `README.md`.
