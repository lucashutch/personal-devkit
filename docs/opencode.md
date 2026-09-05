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

The linker installs profile configuration, shared agents, skills, commands, plugins, and the OpenCode desktop launcher. It does not link runtime-generated credentials or state files.

For OpenCode it also runs `npm install --no-package-lock` in `opencode/` to install the current TUI plugin dependencies. Rerun the linker after upgrading the CLI, then restart OpenCode.

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

Herdr uses the TUI plugin at `opencode/shared/plugins/herdr-tui-pane.js`, registered in `opencode/shared/cli.json`, because the shared background service cannot reliably identify the originating pane from a server-side plugin.

Tab labels follow the selected session from the same pane sync inside `herdr-tui-pane`. It renames on `session.updated` and polls the route once a second, because a route change has no event and a server plugin only sees the session that happens to be active, so it cannot tell one pane's session switch from another's.

Claude's Herdr hook is managed at `claude/hooks/herdr-agent-state.sh` and in `claude/settings.json`; link it with `pdklink --claude`.

For plugin compatibility, model profiles, and validation notes, see the [extension compatibility guide](../opencode/README.md).

## Tokscale history

`tok` snapshots the live database at `~/.local/share/opencode/opencode.db` and points tokscale at the snapshot plus the retired V1 backup at `~/.local/share/opencode-v1/opencode/opencode.db`, so token history survives the V1 removal.
