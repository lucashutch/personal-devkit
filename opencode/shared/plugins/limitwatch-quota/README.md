# Limitwatch quota TUI plugin

## Purpose

Adds a `Quotas` section to the session sidebar. It runs `limitwatch show
--json`, formats each account's quota, refreshes after session status changes,
and polls every two minutes.

## Configuration

- Plugin entry: `shared/cli.json` -> `./shared/plugins/limitwatch-quota`
- Command override: `LIMITWATCH_COMMAND`
- Account directory override: `LIMITWATCH_CONFIG_DIR`

V2 plugin dependencies intentionally track the current `next` channel. Do not
add a lockfile or pin preview builds; run `npm install --no-package-lock` from
`opencode` after upgrading `opencode2`.

When `LIMITWATCH_CONFIG_DIR` is unset, the plugin resets `XDG_CONFIG_HOME` to
`$HOME/.config` for the child process so profile-specific OpenCode config does
not hide the normal Limitwatch accounts.

The plugin calls `context.renderer.requestRender()` after asynchronous updates.
It previously remounted its slot instead, because with `next-17028` a mounted
external component never repainted; that turned out to be a missing renderer
flush rather than a disconnected Solid computation, so a repaint request is
sufficient and the slot claim now survives a refresh.

## Troubleshooting

- `Accounts file not found`: set `LIMITWATCH_CONFIG_DIR` or verify the account
  file under the normal Limitwatch config directory.
- `No quota data`: run the configured command manually with `--json`.
- Plugin load errors: check for a red `Plugin` toast, then restart the active
  OpenCode service after changing the plugin.
