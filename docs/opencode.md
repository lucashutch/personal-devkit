# OpenCode profiles and integrations

Link OpenCode configuration before using a profile:

```sh
uv run pdklink --opencode
```

The repository maintains one default profile and one isolated test profile for each OpenCode generation.

| Helper | `XDG_CONFIG_HOME` | Global config |
| --- | --- | --- |
| `opencode`, `oc` | `~/.config` | `~/.config/opencode/opencode.json` |
| `oct` | `~/.config/opencode-v1-test` | `opencode/opencode.json` |
| `opencode2`, `oc2` | `~/.config/opencode-v2` | `opencode/opencode.json` |
| `o2t` | `~/.config/opencode-v2-test` | `opencode/opencode.json` |

The non-default wrappers isolate XDG config, data, state, and cache roots, including credentials, sessions, database, services, logs, and cache. They retain the normal shared GitHub CLI configuration through `GH_CONFIG_DIR`. Project `opencode.json(c)` files layer on the selected global profile; they do not isolate credentials or sessions.

V1 uses the default namespace so external integrations can resume its sessions. V2 has a distinct namespace because its configuration schema is incompatible with V1's.

## What the linker does

The linker installs V1 and V2 profile configuration, shared agents, skills, commands, plugins, and the OpenCode desktop launcher. It does not link runtime-generated credentials or state files.

For V2 it also runs `npm install --no-package-lock` in `opencode/v2/` to install the current TUI plugin dependencies. Rerun the linker after upgrading the V2 CLI, then restart OpenCode.

The V2 default profile uses OpenCode's built-in service endpoint. The test profile uses `127.0.0.1:4099` when `opencode2` is available. To configure it manually:

```sh
o2t service set hostname 127.0.0.1
o2t service set port 4099
o2t service restart
```

Use `opencode2 service status` and `o2t service status` to check isolation.

## Remote access to the V2 web interface

The V2 service serves the API and the web interface the TUI renders from on the same port, behind HTTP basic auth. Bind it to all interfaces and set a password to reach it from another device on the Tailscale network:

```sh
oc2 service set hostname 0.0.0.0
oc2 service set password "$(openssl rand -base64 24)"
```

Each `set` stops the service, so the next `oc2` launch applies the change. `oc2 pair` then prints the URLs, the password, and a QR code for the phone. The basic-auth username is always `opencode` and cannot be changed.

Both settings live in `service.json` under the profile config directory. The linker does not manage that file, because it stores the password in plaintext.

## Herdr

The V1 Herdr plugin is managed at `opencode/v1/shared/plugins/herdr-agent-state.js`; refresh it with `herdr integration install opencode` and copy the generated plugin into that path. V2 uses the TUI plugin at `opencode/v2/shared/plugins/herdr-tui-pane.js`, registered in `opencode/v2/shared/cli.json`, because V2's shared background service cannot reliably identify the originating pane from a server-side plugin.

Tab labels follow the selected session, so they are set from the TUI too:
`opencode/v1/shared/herdr-tui-title.js` (registered in `tui.json`) for V1, and
the same pane sync inside `herdr-tui-pane` for V2. Both poll the current route,
because a server plugin only sees the session that happens to be active and
cannot tell one pane's session switch from another's.

Claude's Herdr hook is managed at `claude/hooks/herdr-agent-state.sh` and in `claude/settings.json`; link it with `pdklink --claude`.

For V2 plugin compatibility, model profiles, and validation notes, see the [V2 extension compatibility guide](../opencode/v2/README.md). For migration from the retired account profiles, see the [V1 migration guide](../opencode/v1/MIGRATION.md).
