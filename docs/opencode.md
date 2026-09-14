# OpenCode profiles and integrations

Link OpenCode configuration before using a profile:

```sh
uv run pdklink --opencode
```

The repository maintains one default profile and one isolated test profile.

| Helper | `XDG_CONFIG_HOME` | Global config |
| --- | --- | --- |
| `opencode`, `oc` | `~/.config` | `~/.config/opencode/opencode.json` |
| `oct` | `~/.config/opencode-test` | `opencode/opencode.json` |

The non-default wrapper isolates XDG config, data, state, and cache roots, including credentials, sessions, database, services, logs, and cache. It retains the normal shared GitHub CLI configuration through `GH_CONFIG_DIR`. Project `opencode.json(c)` files layer on the selected global profile; they do not isolate credentials or sessions.

The CLI keeps an `opencode2` bin alias, but nothing here uses it. The retired V1 database is kept at `~/.local/share/opencode-v1/opencode/opencode.db` for tokscale history only.

## Upgrading OpenCode

The CLI is the global npm package `@opencode/cli`, and the plugin SDK is
`@opencode/plugin` on the same release channel. Upgrade both, in this order:

```sh
npm install --global @opencode/cli@latest
uv run pdklink --opencode
```

The linker step reinstalls `opencode/node_modules` and re-resolves the SDK's
optional peers against the new build, which is what keeps the TUI plugins
rendering with the host's renderer. Restart the service and reopen the TUI
afterwards; server plugins are only loaded at startup.

Then validate:

```sh
opencode --version
node --test opencode/plugins/*.test.mjs
uv run pytest scripts/tests
```

Plugin load failures are warnings, not errors, so check the log rather than the
exit status:

```sh
grep "failed to load plugin" ~/.local/share/opencode/log/opencode.log
```

`uv run pdkinstall --opencode --reinstall` also upgrades the CLI, but it
reinstalls Node.js first. That is destructive to other global npm packages: a
new LTS moves `~/.local/share/node/current` and orphans them, and even a
same-version reinstall replaces `lib/node_modules`. Either way `tokscale`,
`ghui`, `druk`, and `codex` are left as dangling links in `~/.local/bin`.
Recover by reinstalling them and the CLI:

```sh
uv run pdkinstall --tokscale --ghui --druk --codex --reinstall
npm install --global @opencode/cli@latest
```

## Renaming notes

OpenCode 2.0 renamed the npm scope from `@opencode-ai/*` to `@opencode/*` and
moved from the `beta` channel to a stable `latest`. The CLI's bin is now
`opencode`; `opencode2` survives as a bin alias, and the generated bash
completion function is `_opencode` rather than `_opencode2`. Anything in this
repository that referred to the old names has been updated, so a machine
carrying an old `@opencode-ai/cli` install should remove it:

```sh
npm uninstall -g @opencode-ai/cli
```

## What the linker does

The linker installs profile configuration, shared agents, skills, plugins, and the OpenCode desktop launcher. OpenCode slash-command adapters are intentionally omitted. OpenCode provides its own `opencode` and `report` skills. The linker does not manage runtime-generated credentials or state files.

For OpenCode it also installs plugin dependencies and their optional peers in `opencode/`, without a lockfile or package scripts. The floating `latest` dependency can move independently of the CLI, and peer ranges do not guarantee exact host builds. Check both versions and validate plugins after relinking or upgrading; restart OpenCode to load changed server plugins.

The default profile uses OpenCode's built-in service endpoint. The test profile uses `127.0.0.1:4099` when `opencode` is available. To configure it manually:

```sh
oct service set hostname 127.0.0.1
oct service set port 4099
oct service restart
```

Use `opencode service status` and `oct service status` to check isolation.

## Remote access to the web interface

The service serves the API and the web interface the TUI renders from on the same port, behind HTTP basic auth. Bind it to all interfaces and set a password to reach it from another device on the Tailscale network:

```sh
oc service set hostname 0.0.0.0
oc service set password "$(openssl rand -base64 24)"
```

Each `set` stops the service, so the next `oc` launch applies the change. `oc pair` then prints the URLs, the password, and a QR code for the phone. The basic-auth username is always `opencode` and cannot be changed.

Both settings live in `service.json` under the profile config directory. The linker does not manage that file, because it stores the password in plaintext.

## Herdr

Herdr uses the TUI package at `opencode/plugins/herdr-tui-pane/`, registered in `opencode/cli.json`, because the shared background service cannot reliably identify the originating pane from a server-side plugin.

The plugin reports which session the pane holds and whether that session family is idle, working, or blocked. It polls the route to detect session switches; the shared server cannot attribute a route change to a particular pane.

Claude's Herdr hook is managed at `claude/hooks/herdr-agent-state.sh` and in `claude/settings.json`; link it with `pdklink --claude`.

Tab titles come from the [herdr-auto-title](https://github.com/kryptamine/herdr-auto-title) plugin, not from this repository. Install it with `herdr plugin install kryptamine/herdr-auto-title` and then `herdr server stop`, which is what starts it. Its settings are managed at `herdr-auto-title/config.env` and linked by `pdklink --herdr`; a change only takes effect after another `herdr server stop`.

For plugin compatibility, model profiles, and validation notes, see the [extension compatibility guide](../opencode/README.md).

## Tokscale history

`tok` snapshots the live database at `~/.local/share/opencode/opencode.db` and points tokscale at the snapshot plus the retired V1 backup at `~/.local/share/opencode-v1/opencode/opencode.db`, so token history survives the V1 removal.
