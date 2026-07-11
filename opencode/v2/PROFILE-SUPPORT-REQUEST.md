# OpenCode V2: home/work profile support request

## Summary

OpenCode V2 needs a supported way to run separate **home** and **work**
profiles under one operating-system user. A profile must isolate both
configuration and all persistent server state, not merely select a different
model list.

This repository previously used V1 account-specific wrappers. V1 allowed
profile-specific configuration and data roots, which separated home and work
provider credentials, sessions, snapshots, logs, databases, and service state.
V2's documented global configuration and shared-server paths currently make
that arrangement unavailable.

## Current V2 behavior that creates the problem

The V2 docs define one global config path:

```text
~/.config/opencode/opencode.json(c)
```

They also document one shared-service registration, service config, and default
database path:

```text
~/.local/state/opencode/service.json
~/.config/opencode/service.json
~/.local/share/opencode/opencode-next.db
```

The background server owns sessions, plugins, permissions, credentials, and
other application state. Therefore, separate executable installations alone do
not provide separate accounts: both clients discover the same service and use
the same persistent state.

## Requested outcome

A user should be able to do this without containers or separate OS accounts:

```bash
opencode2 --profile home
opencode2 --profile work
```

Each profile should have independent:

- global configuration and configured providers/models;
- credentials and OAuth tokens;
- sessions, snapshots, permissions, and database;
- logs, cache, plugin runtime/dependencies, and service configuration;
- background-service discovery and lifecycle.

A home client must never accidentally connect to the work profile's server or
read/write its state.

## Preferred option: first-class profiles

Add a profile selector accepted consistently by the CLI, service commands, and
server startup, for example:

```bash
opencode2 --profile home
opencode2 service --profile work status
OPENCODE_PROFILE=home opencode2
```

The selected profile would scope all configuration and state paths. One
possible layout is:

```text
~/.config/opencode/profiles/home/opencode.json
~/.config/opencode/profiles/home/service.json
~/.local/share/opencode/profiles/home/opencode-next.db
~/.local/state/opencode/profiles/home/service.json

~/.config/opencode/profiles/work/opencode.json
~/.config/opencode/profiles/work/service.json
~/.local/share/opencode/profiles/work/opencode-next.db
~/.local/state/opencode/profiles/work/service.json
```

The exact layout is less important than a documented stable profile namespace
that applies identically to client, service discovery, server, credential
storage, and every persistent sidecar.

Useful details:

- The default profile should preserve current behavior for existing users.
- A profile name should be validated and safe to use in paths.
- The profile should be part of service identity, so home and work daemons can
  run concurrently.
- The selected profile should be visible in `service status`, logs, and the
  TUI, making account mistakes obvious.
- Project config may still layer over the selected profile's global config.

## Alternative option: complete XDG support

Alternatively, fully respect XDG base-directory variables for every V2 path:

```bash
XDG_CONFIG_HOME="$HOME/.config/opencode-home" \
XDG_DATA_HOME="$HOME/.local/share/opencode-home" \
XDG_STATE_HOME="$HOME/.local/state/opencode-home" \
opencode2
```

At minimum, the same XDG-derived root must be used consistently for:

- global config and service config;
- SQLite database and credential storage;
- service registration/discovery;
- logs, cache, plugin dependencies, and generated files.

For example, when `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` are
set, V2 could use:

```text
$XDG_CONFIG_HOME/opencode/opencode.json
$XDG_CONFIG_HOME/opencode/service.json
$XDG_DATA_HOME/opencode/opencode-next.db
$XDG_STATE_HOME/opencode/service.json
```

This would let shell wrappers select isolated profiles while retaining the
normal shared-server model *within* each profile.

## Optional explicit-config support

A complementary feature would be an explicit config-root or config-file option,
such as:

```bash
opencode2 --config /path/to/home/opencode.json
# or
OPENCODE_CONFIG=/path/to/home/opencode.json opencode2
```

If added, its precedence and scope must be documented. Config selection alone
is not sufficient: it must also select a matching independent service/data
namespace, or account credentials and sessions would remain shared.

## Acceptance criteria

1. Home and work servers can run at the same time under one Unix user.
2. Each profile can authenticate the same provider as different accounts.
3. A session created in one profile is not visible in the other.
4. `service status`, start, stop, restart, and automatic discovery affect only
   the selected profile.
5. Existing users who do not select a profile retain the current default paths
   and behavior.
6. The feature is documented, including migration guidance and path
   precedence.

## Relevant V2 documentation

- [Configuration locations](https://v2.opencode.ai/config.md)
- [Service files and explicit servers](https://v2.opencode.ai/troubleshooting.md)
- [V1-to-V2 migration](https://v2.opencode.ai/migrate-v1.md)
