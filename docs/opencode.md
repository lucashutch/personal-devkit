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

Legacy aliases `opencode2`, `oc2`, and `o2t` still point at the default and test profiles. The retired V1 database is kept at `~/.local/share/opencode-v1/opencode/opencode.db` for tokscale history only.

## What the linker does

The linker installs profile configuration, shared agents, skills, plugins, and the OpenCode desktop launcher. OpenCode slash-command adapters are intentionally omitted. OpenCode provides its own `opencode` and `report` skills. The linker does not manage runtime-generated credentials or state files.

For OpenCode it also installs plugin dependencies and their optional peers in `opencode/`, without a lockfile or package scripts. The floating `beta` dependency can move independently of the CLI, and peer ranges do not guarantee exact host builds. Check both versions and validate plugins after relinking or upgrading; restart OpenCode to load changed server plugins.

The default profile uses OpenCode's built-in service endpoint. The test profile uses `127.0.0.1:4099` when `opencode2` is available. To configure it manually:

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

Tab labels and activity follow the selected session family in that TUI pane. The plugin listens for session renames and polls the route to detect session switches; the shared server cannot attribute a route change to a particular pane.

Claude's Herdr hook is managed at `claude/hooks/herdr-agent-state.sh` and in `claude/settings.json`; link it with `pdklink --claude`.

For plugin compatibility, model profiles, and validation notes, see the [extension compatibility guide](../opencode/README.md).

## Tokscale history

`tok` snapshots the live database at `~/.local/share/opencode/opencode.db` and points tokscale at the snapshot plus the retired V1 backup at `~/.local/share/opencode-v1/opencode/opencode.db`, so token history survives the V1 removal.
