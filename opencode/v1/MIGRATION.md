# OpenCode V1 profile migration

Use this guide to migrate this repository's OpenCode V1 home, work, and test
profiles from the old additive-config setup to explicit, isolated config and
data trees.

This migration is for the **V1** `opencode` binary. It deliberately keeps V1
separate from the normal `~/.config/opencode/opencode.json` location, which is
reserved for a future OpenCode V2 configuration.

## Resulting layout

After migration, each V1 helper selects both a complete global configuration
and independent persistent data:

| Helper | `XDG_CONFIG_HOME` | V1 global config | `XDG_DATA_HOME` |
| --- | --- | --- | --- |
| `och` | `~/.config/opencode-v1-home` | `opencode/opencode.json` | `~/.local/share/opencode-v1-home` |
| `ocw` | `~/.config/opencode-v1-work` | `opencode/opencode.json` | `~/.local/share/opencode-v1-work` |
| `oct` | `~/.config/opencode-v1-test` | `opencode/opencode.json` | `~/.local/share/opencode-v1-test` |

The profile configs are self-contained. Unlike the previous setup, they do
not use `OPENCODE_CONFIG`, which V1 loads *in addition to* its global config.

Persistent data includes provider credentials, sessions, session history,
snapshots, logs, and databases. It is not stored in this repository.

## Prerequisites

1. Use this repository revision, which includes `opencode/v1/<profile>/` and
   the updated `dotfiles/bashrc.d/opencode.sh`.
2. Ensure the repository-managed Bash snippets are loaded from `~/.bashrc`.
3. Close every OpenCode process that writes to the old profile data directory
   before moving data. In particular, do not copy a SQLite database while its
   corresponding process is running.

Check for running OpenCode processes:

```bash
ps -eo pid=,comm=,args= | grep -E '[o]pencode( |$|\.exe|2)' || true
```

`opencode2` normally uses separate V2 state. However, an older `o2h`/`o2w`/
`o2t` helper may have started V2 with the old `xdg-home`, `xdg-work`, or
`xdg-test` directory. Stop that service before copying the affected profile;
otherwise its logs or database sidecars can change while `rsync` is running.

## 1. Link the new profile config trees

From the repository root, run:

```bash
scripts/link-config.py --opencode
```

This links the V1 configs and shared assets into each profile-specific config
home. It does not modify the old V1 data directories or copy credentials.

Verify the links, for example:

```bash
readlink -f ~/.config/opencode-v1-home/opencode/opencode.json
readlink -f ~/.config/opencode-v1-work/opencode/opencode.json
```

They should resolve to this repository's `opencode/v1/home/opencode.json` and
`opencode/v1/work/opencode.json`, respectively.

## 2. Copy existing home and work state

The old helpers used these data roots:

```text
~/.config/opencode/xdg-home
~/.config/opencode/xdg-work
```

Copy them to the new XDG data roots with `rsync`. This preserves the old
locations as a rollback source. The commands also save any newly created data
at the destination before replacing it.

```bash
set -eu
stamp=$(date +%Y%m%dT%H%M%S)

for profile in home work; do
  old="$HOME/.config/opencode/xdg-$profile/"
  new="$HOME/.local/share/opencode-v1-$profile"
  backup="${new}.before-state-migration-$stamp"

  test -d "$old" || {
    printf 'Old %s data directory does not exist: %s\n' "$profile" "$old" >&2
    exit 1
  }

  if [ -e "$new" ]; then
    mv "$new" "$backup"
    printf 'Saved existing destination state at %s\n' "$backup"
  fi

  mkdir -p "$new"
  rsync -aH --delete "$old" "$new"/
done
```

Run the equivalent loop with `test` included if the test profile has state you
want to preserve:

```bash
# Change `home work` above to `home work test`.
```

Do not commit copied data, database files, credentials, or backups to this
repository.

## 3. Verify the copied state

With V1 still closed, verify that source and destination match:

```bash
for profile in home work; do
  old="$HOME/.config/opencode/xdg-$profile/"
  new="$HOME/.local/share/opencode-v1-$profile/"
  rsync -aHn --checksum --delete --itemize-changes "$old" "$new"
done
```

The command should print no changes. Optionally validate the copied V1 SQLite
databases using Python's built-in SQLite module:

```bash
python3 - <<'PY'
import os
import sqlite3

for profile in ("home", "work"):
    database = os.path.expanduser(
        f"~/.local/share/opencode-v1-{profile}/opencode/opencode.db"
    )
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        print(f"{profile}: {connection.execute('PRAGMA integrity_check').fetchone()[0]}")
    finally:
        connection.close()
PY
```

This should report `ok` for each profile. If you run this check before the
`rsync` comparison, run a final `rsync -aH --delete` afterward: SQLite may
touch its shared-memory sidecar while opening the database.

## 4. Start a new shell and validate the profiles

Start a new terminal, or reload the Bash configuration. Then confirm the
expected provider lists:

```bash
ocw models github-copilot

# If the home profile uses OpenAI:
och models openai
```

Open `och` and `ocw` normally and confirm that their expected session history
and provider connections appear. If authentication is missing, do not delete
old data; re-check the copy first, then reconnect only the affected profile.

## Rollback

The old V1 data trees are retained, and the previous destination state is
saved under a timestamped `.before-state-migration-*` directory. To roll back
the shell behavior, restore the previous wrapper functions from Git and open a
new shell. No repository data or credential data needs to be deleted.

## Future V2 migration

Do not convert any file under `opencode/v1/` to V2-native configuration. Keep
these files in V1 format while `opencode` is still in use. A future V2-native
config belongs at `opencode/opencode.json`; V2 currently does not support the
V1-style profile selection mechanism.
