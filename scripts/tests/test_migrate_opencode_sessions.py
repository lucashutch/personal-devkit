"""Merge checks for migrate_opencode_sessions.py against synthetic databases."""

from __future__ import annotations

import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATOR = ROOT / "scripts" / "migrate_opencode_sessions.py"

# The primary keys and unique indexes mirror the real OpenCode schemas.
V1_SCHEMA = """
CREATE TABLE project (
    id TEXT PRIMARY KEY,
    worktree TEXT NOT NULL,
    icon_color TEXT,
    time_created INTEGER
);
CREATE TABLE project_directory (
    project_id TEXT NOT NULL REFERENCES project(id),
    directory TEXT NOT NULL,
    time_seen INTEGER,
    PRIMARY KEY (project_id, directory)
);
CREATE TABLE permission (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    UNIQUE (project_id, action, resource)
);
CREATE TABLE session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    parent_id TEXT REFERENCES session(id),
    title TEXT,
    time_created INTEGER
);
CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES session(id),
    role TEXT
);
CREATE TABLE part (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES message(id),
    session_id TEXT REFERENCES session(id),
    text TEXT
);
CREATE TABLE todo (
    session_id TEXT NOT NULL REFERENCES session(id),
    position INTEGER NOT NULL,
    content TEXT,
    PRIMARY KEY (session_id, position)
);
CREATE TABLE session_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES session(id),
    message_id TEXT NOT NULL REFERENCES message(id),
    seq INTEGER NOT NULL,
    UNIQUE (session_id, seq)
);
CREATE TABLE event_sequence (
    aggregate_id TEXT PRIMARY KEY,
    owner_id TEXT,
    seq INTEGER NOT NULL
);
CREATE TABLE event (
    id TEXT PRIMARY KEY,
    aggregate_id TEXT NOT NULL REFERENCES event_sequence(aggregate_id),
    seq INTEGER NOT NULL,
    payload TEXT,
    UNIQUE (aggregate_id, seq)
);
CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER);
CREATE TABLE data_migration (id TEXT PRIMARY KEY, time_completed INTEGER);
CREATE TABLE __drizzle_migrations (hash TEXT PRIMARY KEY, created_at INTEGER);
"""

V2_SCHEMA = """
CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, time_created INTEGER);
CREATE TABLE session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    title TEXT
);
CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES session(id),
    role TEXT
);
CREATE TABLE instruction_entry (
    session_id TEXT NOT NULL REFERENCES session(id),
    key TEXT NOT NULL,
    body TEXT,
    PRIMARY KEY (session_id, key)
);
CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER);
"""

MIGRATION_IDS = ("0001_init", "0002_sessions")
DRIZZLE_HASHES = ("aaaa", "bbbb")


def load_migrator():
    from personal_devkit import migrate_opencode_sessions

    return migrate_opencode_sessions


def create(path: Path, schema: str = V1_SCHEMA) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(schema)
    for identifier in MIGRATION_IDS:
        connection.execute("INSERT INTO migration VALUES (?, 1)", (identifier,))
    if "__drizzle_migrations" in schema:
        for value in DRIZZLE_HASHES:
            connection.execute("INSERT INTO __drizzle_migrations VALUES (?, 1)", (value,))
    connection.commit()
    connection.close()


def populate(
    path: Path,
    *,
    project: str,
    worktree: str,
    session: str,
    message: str,
    text: str = "hello",
    icon_color: str = "blue",
    todo: str = "todo",
) -> None:
    connection = sqlite3.connect(path)
    connection.execute("INSERT INTO project VALUES (?, ?, ?, 1)", (project, worktree, icon_color))
    connection.execute(
        "INSERT INTO project_directory VALUES (?, ?, 1)", (project, worktree)
    )
    connection.execute(
        "INSERT INTO session VALUES (?, ?, NULL, ?, 1)", (session, project, f"t {session}")
    )
    connection.execute("INSERT INTO message VALUES (?, ?, 'user')", (message, session))
    connection.execute(
        "INSERT INTO part VALUES (?, ?, ?, ?)", (f"prt_{message}", message, session, text)
    )
    connection.execute("INSERT INTO todo VALUES (?, 0, ?)", (session, todo))
    connection.execute(
        "INSERT INTO session_message VALUES (?, ?, ?, 1)", (f"smg_{message}", session, message)
    )
    connection.execute("INSERT INTO event_sequence VALUES (?, ?, 2)", (session, session))
    connection.execute(
        "INSERT INTO event VALUES (?, ?, 1, '{}')", (f"evt_{session}_1", session)
    )
    connection.execute(
        "INSERT INTO event VALUES (?, ?, 2, '{}')", (f"evt_{session}_2", session)
    )
    connection.commit()
    connection.close()


def rows(path: Path, query: str) -> list[tuple]:
    connection = sqlite3.connect(path)
    try:
        return connection.execute(query).fetchall()
    finally:
        connection.close()


def count(path: Path, table: str) -> int:
    return rows(path, f"SELECT count(*) FROM {table}")[0][0]


class MigrateOpenCodeSessionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.home = Path(self._temporary.name)
        self.target = self.home / "opencode.db"
        self.first = self.home / "profile-one.db"
        self.second = self.home / "profile-two.db"

    def run_migrator(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(MIGRATOR), *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def merge(self, *extra: str, sources: list[Path] | None = None):
        arguments = ["--kind", "v1", "--target", str(self.target)]
        for path in sources or [self.first]:
            arguments += ["--source", str(path)]
        return self.run_migrator(*arguments, *extra, "--backup-dir", str(self.home / "backups"))

    def test_clean_merge_of_two_sources(self) -> None:
        for path in (self.target, self.first, self.second):
            create(path)
        populate(
            self.target, project="prj_t", worktree="/w/t", session="ses_t", message="msg_t"
        )
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        populate(self.second, project="prj_b", worktree="/w/b", session="ses_b", message="msg_b")

        result = self.merge(sources=[self.first, self.second])

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(count(self.target, "session"), 3)
        self.assertEqual(count(self.target, "part"), 3)
        self.assertEqual(count(self.target, "event"), 6)
        self.assertTrue((self.home / "backups" / "profile-one.db").is_file())
        self.assertTrue((self.home / "backups" / "opencode.db").is_file())

    def test_project_dedup_by_worktree_remaps_dependents(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_t", worktree="/w/same", session="ses_t", message="msg_t"
        )
        populate(self.first, project="prj_a", worktree="/w/same", session="ses_a", message="msg_a")

        result = self.merge()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(count(self.target, "project"), 1)
        self.assertEqual(
            rows(self.target, "SELECT project_id FROM session WHERE id = 'ses_a'"),
            [("prj_t",)],
        )
        self.assertIn("reuses target project prj_t", result.stdout)

    def test_identical_rows_are_skipped(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a"
        )
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")

        result = self.merge()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(count(self.target, "session"), 1)
        self.assertEqual(count(self.target, "message"), 1)
        self.assertEqual(count(self.target, "event"), 2)
        self.assertEqual(rows(self.target, "SELECT seq FROM event_sequence"), [(2,)])

    def test_shared_aggregate_keeps_monotonic_event_sequence(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a"
        )
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        connection = sqlite3.connect(self.first)
        connection.execute("INSERT INTO event VALUES ('evt_extra', 'ses_a', 3, '{}')")
        connection.execute("UPDATE event_sequence SET seq = 3")
        connection.commit()
        connection.close()

        result = self.merge()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(rows(self.target, "SELECT seq FROM event_sequence"), [(3,)])
        self.assertEqual(
            rows(self.target, "SELECT seq FROM event WHERE id = 'evt_extra'"), [(3,)]
        )

    def test_event_sequence_owner_is_copied(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")

        result = self.merge()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            rows(self.target, "SELECT owner_id FROM event_sequence"), [("ses_a",)]
        )

    def test_shared_project_id_with_same_worktree_keeps_the_target_row(self) -> None:
        for path in (self.target, self.first, self.second):
            create(path)
        populate(
            self.target,
            project="prj_a",
            worktree="/w/a",
            session="ses_t",
            message="msg_t",
            icon_color="blue",
        )
        populate(
            self.first,
            project="prj_a",
            worktree="/w/a",
            session="ses_a",
            message="msg_a",
            icon_color="green",
        )
        populate(
            self.second,
            project="prj_a",
            worktree="/w/a",
            session="ses_b",
            message="msg_b",
            icon_color="red",
        )

        result = self.merge(sources=[self.first, self.second])

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(count(self.target, "project"), 1)
        self.assertEqual(rows(self.target, "SELECT icon_color FROM project"), [("blue",)])
        self.assertEqual(count(self.target, "session"), 3)
        self.assertIn("kept the target row", result.stdout)

    def test_differing_composite_key_row_aborts_then_skips(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a"
        )
        populate(
            self.first,
            project="prj_a",
            worktree="/w/a",
            session="ses_a",
            message="msg_a",
            todo="rewritten",
        )

        aborted = self.merge()
        self.assertNotEqual(aborted.returncode, 0)
        self.assertIn("todo row", aborted.stdout + aborted.stderr)
        self.assertEqual(rows(self.target, "SELECT content FROM todo"), [("todo",)])

        skipped = self.merge("--on-collision", "skip")
        self.assertEqual(skipped.returncode, 0, skipped.stdout + skipped.stderr)
        self.assertEqual(rows(self.target, "SELECT content FROM todo"), [("todo",)])

    def test_unique_index_violation_names_the_constraint(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_a", worktree="/w/a", session="ses_t", message="msg_t"
        )
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        for path, identifier in ((self.target, "per_t"), (self.first, "per_a")):
            connection = sqlite3.connect(path)
            connection.execute(
                "INSERT INTO permission VALUES (?, 'prj_a', 'edit', '/w/a/f')", (identifier,)
            )
            connection.commit()
            connection.close()

        result = self.merge()

        self.assertNotEqual(result.returncode, 0)
        report = result.stdout + result.stderr
        self.assertIn("permission insert rejected by a constraint", report)
        self.assertIn("UNIQUE constraint failed", report)
        self.assertEqual(count(self.target, "session"), 1)

    def test_child_session_is_copied_after_its_renamed_parent(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_a", worktree="/w/a", session="ses_p", message="msg_t"
        )
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_p", message="msg_a")
        connection = sqlite3.connect(self.first)
        connection.execute("UPDATE session SET title = 'other' WHERE id = 'ses_p'")
        # Physically first but created later, so only a time_created ordering copies the parent first.
        connection.execute(
            "INSERT INTO session VALUES ('ses_c', 'prj_a', 'ses_p', 'child', 9)"
        )
        connection.execute("UPDATE session SET time_created = 5 WHERE id = 'ses_p'")
        connection.commit()
        connection.close()

        result = self.merge("--on-collision", "rename")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            rows(self.target, "SELECT parent_id FROM session WHERE id = 'ses_c'"),
            [("ses_p_profile-one",)],
        )

    def test_one_source_commits_while_another_rolls_back(self) -> None:
        for path in (self.target, self.first, self.second):
            create(path)
        populate(
            self.target, project="prj_t", worktree="/w/t", session="ses_t", message="msg_t"
        )
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        populate(
            self.second,
            project="prj_t",
            worktree="/w/t",
            session="ses_t",
            message="msg_t",
            todo="rewritten",
        )

        result = self.merge(sources=[self.first, self.second])

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            sorted(rows(self.target, "SELECT id FROM session")), [("ses_a",), ("ses_t",)]
        )
        self.assertIn("rolled back", result.stdout + result.stderr)

    def test_validation_fails_when_a_source_row_is_unaccounted_for(self) -> None:
        module = load_migrator()
        create(self.target)
        populate(
            self.target, project="prj_t", worktree="/w/t", session="ses_t", message="msg_t"
        )
        connection = sqlite3.connect(self.target)
        connection.row_factory = sqlite3.Row
        self.addCleanup(connection.close)
        stats = {"session": module.TableStats(source_rows=3, inserted=1, skipped=0)}

        lines, ok = module.validate(connection, {"session": 0}, stats)

        self.assertFalse(ok)
        self.assertIn("lost:", "\n".join(lines))

    def conflicting_source(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a"
        )
        populate(
            self.first,
            project="prj_a",
            worktree="/w/a",
            session="ses_a",
            message="msg_a",
            text="different",
        )

    def test_conflicting_row_aborts_by_default(self) -> None:
        self.conflicting_source()

        result = self.merge()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("prt_msg_a", result.stdout + result.stderr)
        self.assertEqual(rows(self.target, "SELECT text FROM part"), [("hello",)])

    def test_collision_skip_keeps_target_row(self) -> None:
        self.conflicting_source()

        result = self.merge("--on-collision", "skip")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(rows(self.target, "SELECT text FROM part"), [("hello",)])

    def test_collision_rename_keeps_both_rows(self) -> None:
        self.conflicting_source()

        result = self.merge("--on-collision", "rename")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            sorted(rows(self.target, "SELECT id, text FROM part")),
            [("prt_msg_a", "hello"), ("prt_msg_a_profile-one", "different")],
        )

    def test_schema_drift_is_refused_without_the_flag(self) -> None:
        create(self.target)
        create(self.first)
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        connection = sqlite3.connect(self.first)
        connection.execute("ALTER TABLE session ADD COLUMN extra TEXT")
        connection.execute("INSERT INTO migration VALUES ('0003_extra', 1)")
        connection.commit()
        connection.close()

        refused = self.merge()
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("--allow-schema-drift", refused.stdout + refused.stderr)
        self.assertEqual(count(self.target, "session"), 0)

        allowed = self.merge("--allow-schema-drift")
        self.assertEqual(allowed.returncode, 0, allowed.stdout + allowed.stderr)
        self.assertEqual(count(self.target, "session"), 1)

    def test_migration_metadata_is_preserved(self) -> None:
        for path in (self.target, self.first):
            create(path)
        connection = sqlite3.connect(self.first)
        connection.execute("INSERT INTO data_migration VALUES ('extra', 1)")
        connection.commit()
        connection.close()
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")

        result = self.merge("--allow-schema-drift")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(count(self.target, "data_migration"), 0)
        self.assertEqual(
            rows(self.target, "SELECT id FROM migration ORDER BY id"),
            [(value,) for value in MIGRATION_IDS],
        )
        self.assertIn("never merged", result.stdout)

    def test_dry_run_writes_nothing(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        storage = self.home / "storage-src"
        (storage / "session").mkdir(parents=True)
        (storage / "session" / "ses_a.json").write_text("{}")
        destination = self.home / "storage-dst"

        result = self.merge("--dry-run", "--storage", f"{storage}:{destination}")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(count(self.target, "session"), 0)
        self.assertFalse((self.home / "backups").exists())
        self.assertFalse(destination.exists())
        self.assertIn("ses_a.json", result.stdout)

    def test_storage_copy_skips_existing_destination_files(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        storage = self.home / "storage-src"
        (storage / "message" / "ses_a").mkdir(parents=True)
        (storage / "message" / "ses_a" / "msg_a.json").write_text("{\"new\": 1}")
        (storage / "session").mkdir()
        (storage / "session" / "ses_a.json").write_text("{}")
        destination = self.home / "storage-dst"
        (destination / "message" / "ses_a").mkdir(parents=True)
        (destination / "message" / "ses_a" / "msg_a.json").write_text("{\"old\": 1}")

        result = self.merge("--storage", f"{storage}:{destination}")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            (destination / "message" / "ses_a" / "msg_a.json").read_text(), "{\"old\": 1}"
        )
        self.assertTrue((destination / "session" / "ses_a.json").is_file())
        self.assertIn("already exists", result.stdout)

    def test_validation_reports_injected_foreign_key_violation(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(
            self.target, project="prj_t", worktree="/w/t", session="ses_t", message="msg_t"
        )
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        connection = sqlite3.connect(self.target)
        connection.execute("INSERT INTO message VALUES ('msg_orphan', 'ses_missing', 'user')")
        connection.commit()
        connection.close()

        result = self.merge()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("foreign_key_check: 1 violation", result.stdout)
        self.assertIn("validation failed", result.stdout + result.stderr)

    def test_hot_wal_is_refused_without_force(self) -> None:
        for path in (self.target, self.first):
            create(path)
        populate(self.first, project="prj_a", worktree="/w/a", session="ses_a", message="msg_a")
        self.first.with_name(self.first.name + "-wal").write_bytes(b"busy")

        refused = self.merge()
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("--force", refused.stdout + refused.stderr)

        forced = self.merge("--force")
        self.assertEqual(forced.returncode, 0, forced.stdout + forced.stderr)

    def test_v2_kind_merges_instruction_entries(self) -> None:
        create(self.target, V2_SCHEMA)
        create(self.first, V2_SCHEMA)
        connection = sqlite3.connect(self.first)
        connection.execute("INSERT INTO project VALUES ('prj_a', '/w/a', 1)")
        connection.execute("INSERT INTO session VALUES ('ses_a', 'prj_a', 'title')")
        connection.execute("INSERT INTO message VALUES ('msg_a', 'ses_a', 'user')")
        connection.execute("INSERT INTO instruction_entry VALUES ('ses_a', 'agents', 'body')")
        connection.commit()
        connection.close()

        result = self.run_migrator(
            "--kind",
            "v2",
            "--target",
            str(self.target),
            "--source",
            str(self.first),
            "--backup-dir",
            str(self.home / "backups"),
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(count(self.target, "instruction_entry"), 1)

    def test_module_is_importable(self) -> None:
        module = load_migrator()
        self.assertEqual(module.storage_pair("/a:/b"), (Path("/a"), Path("/b")))


if __name__ == "__main__":
    unittest.main()
