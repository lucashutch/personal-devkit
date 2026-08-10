# OpenCode profile migration

Use this guide to migrate from the old per-account OpenCode profiles
(`och`/`ocw`, `o2h`/`o2w`) to one default profile per OpenCode generation, and
to merge the retired profiles' session history into the new defaults.

## Resulting layout

| Helper | `XDG_CONFIG_HOME` | Global config | `XDG_DATA_HOME` |
| --- | --- | --- | --- |
| `opencode`, `oc` | `~/.config` (default) | `opencode/opencode.json` | `~/.local/share` (default) |
| `oct` | `~/.config/opencode-v1-test` | `opencode/opencode.json` | `~/.local/share/opencode-v1-test` |
| `opencode2`, `oc2` | `~/.config/opencode-v2` | `opencode/opencode.json` | `~/.local/share/opencode-v2` |
| `o2t` | `~/.config/opencode-v2-test` | `opencode/opencode.json` | `~/.local/share/opencode-v2-test` |

V1 owns the default namespace so that tools which read the default OpenCode
locations — Tokscale, Herdr resume, the desktop launcher — need no per-profile
plumbing. V2 keeps one dedicated namespace because both generations read
`$XDG_CONFIG_HOME/opencode/opencode.json` with incompatible schemas.

The default configs in `opencode/v1/default/` and `opencode/v2/default/` are the
union of the retired home and work configs, with the home value kept wherever
the two disagreed. Provider credentials are the union of both accounts.

Persistent data includes provider credentials, sessions, session history,
snapshots, logs, and databases. It is not stored in this repository.

## Prerequisites

1. Use this repository revision, which includes `opencode/v{1,2}/default/`, the
   updated `dotfiles/bashrc.d/opencode.sh`, and
   `scripts/migrate_opencode_sessions.py`.
2. Ensure the repository-managed Bash snippets are loaded from `~/.bashrc`.
3. Close every OpenCode process that writes to a source or target data
   directory. Never copy or merge a SQLite database while its process runs.

```bash
ps -eo pid=,args= | grep -E '[o]pencode( |$|\.exe|2)' || true
```

Stop a V2 profile service explicitly, using the wrapper from the revision you
are migrating from:

```bash
o2h service stop
o2w service stop
```

## 1. Back up everything that will change

```bash
set -eu
stamp=$(date +%Y%m%d-%H%M%S)
backup="$HOME/opencode-profile-collapse-backup-$stamp"
mkdir -p "$backup/config" "$backup/data"

for profile in opencode opencode-v1-home opencode-v1-work \
  opencode-v2-home opencode-v2-work; do
  if test -d "$HOME/.config/$profile"; then
    rsync -aH "$HOME/.config/$profile" "$backup/config"/
  fi
  if test -d "$HOME/.local/share/$profile"; then
    rsync -aH --exclude bin "$HOME/.local/share/$profile" "$backup/data"/
  fi
done
printf 'Backup written to %s\n' "$backup"
```

Run each block in this guide with `bash -c '...'` if you would rather not leave
`set -eu` active in your interactive shell.

Keep this backup until you have listed and resumed sessions from both retired
profiles in the new defaults.

## 2. Retire the legacy default namespace

The default namespace still held the pre-profile additive config and its
file-based storage. Move it aside, keeping `~/.local/share/opencode/bin`, which
holds the installed binary:

```bash
retired="$HOME/opencode-legacy-default-$stamp"
mkdir -p "$retired/config" "$retired/data"
mv "$HOME/.config/opencode" "$retired/config/opencode"
for item in opencode.db opencode.db-wal opencode.db-shm \
  opencode-next.db opencode-next.db-wal opencode-next.db-shm \
  auth.json storage; do
  if test -e "$HOME/.local/share/opencode/$item"; then
    mv "$HOME/.local/share/opencode/$item" "$retired/data"/
  fi
done
```

`opencode-next.db` in this legacy default namespace holds 9 V2 sessions from the
period when V2 ran in the default namespace. They are deliberately **not**
merged: the legacy default namespace is being retired wholesale, and V2's new
home is `~/.local/share/opencode-v2`. Those sessions stay recoverable in
`$retired/data/opencode-next.db`; merge them later with `--kind v2` if you
decide you want them.

## 3. Link the new config trees

```bash
scripts/link-config.py --opencode --force
readlink -f ~/.config/opencode/opencode.json
readlink -f ~/.config/opencode-v2/opencode/opencode.json
```

They should resolve to `opencode/v1/default/opencode.json` and
`opencode/v2/default/opencode.json` in this repository.

Now start a new terminal, so the new helpers are loaded. In the pre-migration
shell `opencode` still points at the retired work profile and `opencode2` is the
bare binary, so the next step would create both databases in the wrong
namespace.

## 4. Create empty target databases with the target binaries

Do not hand-build a schema, and do not copy a database from a different CLI
version. Let each binary create its own database in the new namespace so the
schema and applied migrations match the version you actually run. The XDG roots
are set explicitly so the result does not depend on which shell you are in:

```bash
XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" \
  opencode auth list >/dev/null
XDG_CONFIG_HOME="$HOME/.config/opencode-v2" \
  XDG_DATA_HOME="$HOME/.local/share/opencode-v2" \
  opencode2 auth list >/dev/null
opencode2 service stop || true    # nothing should hold the target open
```

Verify both target files now exist at the expected paths, and nowhere else,
before merging:

```bash
ls -l ~/.local/share/opencode/opencode.db \
  ~/.local/share/opencode-v2/opencode/opencode-next.db
find ~/.local/share -maxdepth 4 -name 'opencode*.db' -newermt '-1 hour'
```

Both should be freshly created and otherwise empty.

## 5. Merge the retired session databases

`scripts/migrate_opencode_sessions.py` merges sources into an existing target in
foreign-key dependency order. It backs up every database first, refuses to touch
a database with a hot WAL, deduplicates projects by worktree while remapping
dependent rows, never merges migration bookkeeping or account/credential tables,
and validates the result.

Rehearse first — `--dry-run` replays the whole merge on a temporary copy:

```bash
uv run scripts/migrate_opencode_sessions.py --kind v1 --dry-run \
  --target ~/.local/share/opencode/opencode.db \
  --source ~/.local/share/opencode-v1-home/opencode/opencode.db \
  --source ~/.local/share/opencode-v1-work/opencode/opencode.db
```

Then merge V1, including the out-of-database storage trees:

```bash
uv run scripts/migrate_opencode_sessions.py --kind v1 \
  --target ~/.local/share/opencode/opencode.db \
  --source ~/.local/share/opencode-v1-home/opencode/opencode.db \
  --source ~/.local/share/opencode-v1-work/opencode/opencode.db \
  --storage ~/.local/share/opencode-v1-home/opencode/storage:$HOME/.local/share/opencode/storage \
  --storage ~/.local/share/opencode-v1-work/opencode/storage:$HOME/.local/share/opencode/storage
```

Both retired V1 profiles were seeded from the same machine, so they share several
`project.id` values for the same worktree whose `icon_color` or `time_created`
differ. The tool treats a source project row whose worktree already exists in the
target under the same id as already represented: the target row wins, the source
row is skipped, and dependent rows keep that id. Only rows outside `project` can
still collide. If a `session`, `message`, `part`, or `todo` row collides with
differing content and you trust the target copy — for example after a partially
completed earlier merge — rerun with `--on-collision=skip`. Use it also when the
two profiles recorded the same session with diverging metadata and you only need
one copy. A UNIQUE-index violation is reported with its table and constraint and
rolls the source back without dropping rows; resolve it before rerunning.

And V2:

```bash
uv run scripts/migrate_opencode_sessions.py --kind v2 \
  --target ~/.local/share/opencode-v2/opencode/opencode-next.db \
  --source ~/.local/share/opencode-v2-home/opencode/opencode-next.db
```

A source whose applied-migration set differs from the target is refused, because
merging into a mismatched schema silently drops or misplaces data. Upgrade that
profile by launching its own CLI version once, or accept a reduced merge with
`--allow-schema-drift`, which copies only the columns both databases share. A
primary-key collision with differing content aborts by default; choose
`--on-collision=skip` to keep the target row or `--on-collision=rename` to keep
both.

The tool prints `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, and a
per-table source/before/inserted/skipped/after table. Any nonzero delta, any
violation, or any `lost` row — a source row that was neither inserted nor skipped
by policy — fails the run with a nonzero exit status.

V2 keeps provider credentials in the database rather than `auth.json`, and the
tool never merges credential rows. Reconnect each provider in the new V2
profile with `opencode2 auth login`.

## 6. Merge V1 credentials

V1 keeps credentials in `auth.json`, keyed by provider, so the retired accounts
can be combined directly. Take the union and drop providers you no longer use:

```bash
python3 - <<'PY'
import json, pathlib

target = pathlib.Path.home() / ".local/share/opencode/auth.json"
merged = {}
for profile in ("opencode-v1-work", "opencode-v1-home"):
    path = pathlib.Path.home() / ".local/share" / profile / "opencode/auth.json"
    if path.is_file():
        # The home account wins a provider both accounts authenticated.
        merged.update(json.loads(path.read_text()))
target.write_text(json.dumps(merged, indent=2))
print(sorted(merged))
PY
chmod 600 ~/.local/share/opencode/auth.json
```

## 7. Copy the V2 auxiliary state

V2 stores snapshots, shell history, and tool output beside its database. Copy
them so merged sessions can still show their history:

```bash
for item in snapshot shell tool-output repos; do
  if test -d "$HOME/.local/share/opencode-v2-home/opencode/$item"; then
    rsync -aH "$HOME/.local/share/opencode-v2-home/opencode/$item" \
      "$HOME/.local/share/opencode-v2/opencode"/
  fi
done
```

## 8. Validate

Count the merged sessions. The merged `session` count must equal what the target
held before the merge plus each source's count, minus nothing — the tool never
drops a session. Set `backup` to the directory printed in step 1, since this is a
new shell:

```bash
backup=$HOME/opencode-profile-collapse-backup-<stamp>
for db in "$backup/data/opencode-v1-home/opencode/opencode.db" \
  "$backup/data/opencode-v1-work/opencode/opencode.db" \
  "$HOME/.local/share/opencode/opencode.db"; do
  printf '%s %s\n' "$(sqlite3 "$db" 'SELECT count(*) FROM session')" "$db"
done
```

Then, in a new terminal so the new helpers are loaded:

```bash
opencode auth list       # union of the retired V1 accounts
opencode                 # session list shows both accounts' history
opencode2 service status
opencode2                # session list shows the retired V2 home sessions
```

Open one session that originated in each retired profile and confirm it resumes
with its messages intact. Only then delete the backups and the old profile
trees:

```bash
rm -rf ~/.config/opencode-v1-home ~/.config/opencode-v1-work \
  ~/.config/opencode-v2-home ~/.config/opencode-v2-work \
  ~/.local/share/opencode-v1-home ~/.local/share/opencode-v1-work \
  ~/.local/share/opencode-v2-home ~/.local/share/opencode-v2-work
```

Remove the now-orphaned per-profile desktop artifacts too:

```bash
rm -f ~/.local/share/applications/opencode-home.desktop \
  ~/.local/share/applications/opencode-work.desktop \
  ~/.local/share/icons/hicolor/scalable/apps/opencode-home.png \
  ~/.local/share/icons/hicolor/scalable/apps/opencode-work.png
update-desktop-database ~/.local/share/applications || true
```

## Rollback

Nothing is deleted by this procedure. Restore `~/.config/opencode` and
`~/.local/share/opencode` from the retired-legacy directory, restore the profile
trees from the backup directory, check out the previous revision of
`dotfiles/bashrc.d/opencode.sh` and `links.yaml`, rerun
`scripts/link-config.py --opencode --force`, and open a new shell. The merge
tool's own timestamped backup directory holds the pre-merge copy of every
database it touched.

## Notes

- Do not convert any file under `opencode/v1/` to V2-native configuration.
  Keep those files in V1 format while `opencode` is still in use.
- Do not commit copied data, database files, credentials, or backups to this
  repository.
