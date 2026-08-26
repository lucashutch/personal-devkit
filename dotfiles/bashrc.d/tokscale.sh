# tokscale helpers.
#
# tokscale reads OpenCode usage from a `message` table. V1's database still
# carries that table, but V2 renamed it to `session_message`, so V2 usage is
# invisible to tokscale. `tok` refreshes a compatibility snapshot of the V2
# database with `message` and `session` views over the renamed tables, then
# points tokscale's own settings at that snapshot.
#
# The snapshot is a copy because the views are additive schema changes, and
# OpenCode V2 owns its live database. sqlite3's backup API is used rather than
# a file copy so the write-ahead log is included.

_TOKSCALE_V2_SOURCE="$HOME/.local/share/opencode-v2/opencode/opencode.db"
_TOKSCALE_V2_SNAPSHOT="$HOME/.cache/tokscale/opencode-v2.db"
_TOKSCALE_CLIENTS="opencode claude"

_tokscale_sync() {
  [ -f "$_TOKSCALE_V2_SOURCE" ] || return 0

  python3 - "$_TOKSCALE_V2_SOURCE" "$_TOKSCALE_V2_SNAPSHOT" $_TOKSCALE_CLIENTS <<'PY'
import json
import os
import sqlite3
import sys
from pathlib import Path

source, snapshot, *clients = sys.argv[1:]
snapshot = Path(snapshot)
snapshot.parent.mkdir(parents=True, exist_ok=True)

staged = snapshot.with_suffix(".db.new")
for leftover in (staged, *(staged.with_name(staged.name + suffix) for suffix in ("-wal", "-shm"))):
    leftover.unlink(missing_ok=True)

origin = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
copy = sqlite3.connect(staged)
try:
    origin.backup(copy)
    copy.execute(
        "CREATE VIEW IF NOT EXISTS message AS SELECT id, session_id,"
        " time_created, time_updated, data FROM session_message"
    )
    copy.execute("CREATE VIEW IF NOT EXISTS session AS SELECT * FROM session_v2")
    copy.commit()
finally:
    # Closing checkpoints and removes the copy's own write-ahead log, so the
    # single-file rename below carries the whole snapshot.
    copy.close()
    origin.close()
os.replace(staged, snapshot)

settings = Path(os.environ.get("TOKSCALE_CONFIG_DIR") or Path.home() / ".config/tokscale") / "settings.json"
current = json.loads(settings.read_text()) if settings.is_file() else {}
current.setdefault("scanner", {})["opencodeDbPaths"] = [str(snapshot)]
current["defaultClients"] = clients

settings.parent.mkdir(parents=True, exist_ok=True)
staged_settings = settings.with_suffix(".json.new")
staged_settings.write_text(json.dumps(current, indent=2) + "\n")
os.replace(staged_settings, settings)
PY
}

tok() {
  if ! _tokscale_sync; then
    printf 'tok: could not refresh the OpenCode V2 snapshot\n' >&2
    return 1
  fi
  command tokscale "$@"
}
