# Limitwatch quota TUI plugin

## Purpose

Adds a `Quotas` section to the session sidebar. It runs `limitwatch show
--json`, formats each account's quota, refreshes after session status changes,
and polls every two minutes.

## Configuration

- Plugin entry: `shared/cli.json` → `./shared/plugins/limitwatch-quota/tui.tsx`
- Command override: `LIMITWATCH_COMMAND`
- Account directory override: `LIMITWATCH_CONFIG_DIR`

V2 plugin dependencies intentionally track the current `next` channel. Do not
add a lockfile or pin preview builds; run `npm install --no-package-lock` from
`opencode/v2` after upgrading `opencode2`.

When `LIMITWATCH_CONFIG_DIR` is unset, the plugin resets `XDG_CONFIG_HOME` to
`$HOME/.config` for the child process so profile-specific OpenCode config does
not hide the normal Limitwatch accounts.

The plugin remounts its slot after asynchronous updates. With `next-17028`, a
minimal component-local Solid timer remained at its initial value until the
sidebar was hidden and shown, confirming that mounted external slots do not
currently react even when state is entirely plugin-local.

## Troubleshooting

- `Accounts file not found`: set `LIMITWATCH_CONFIG_DIR` or verify the account
  file under the normal Limitwatch config directory.
- `No quota data`: run the configured command manually with `--json`.
- Plugin load errors: check for a red `Plugin` toast, then restart the active
  OpenCode service after changing the plugin.
