# Limitwatch quota TUI plugin

## Purpose

Adds a `Quotas` section to the session sidebar. It runs `limitwatch show
--json`, formats each account's quota, refreshes after session status changes,
and polls every two minutes.

## Configuration

- Plugin entry: `shared/cli.json` → `./shared/plugins/limitwatch-quota/tui.tsx`
- Command override: `LIMITWATCH_COMMAND`
- Account directory override: `LIMITWATCH_CONFIG_DIR`

When `LIMITWATCH_CONFIG_DIR` is unset, the plugin resets `XDG_CONFIG_HOME` to
`$HOME/.config` for the child process so profile-specific OpenCode config does
not hide the normal Limitwatch accounts.

## Troubleshooting

- `Accounts file not found`: set `LIMITWATCH_CONFIG_DIR` or verify the account
  file under the normal Limitwatch config directory.
- `No quota data`: run the configured command manually with `--json`.
- Plugin load errors: check for a red `Plugin` toast, then restart the active
  OpenCode service after changing the plugin.
