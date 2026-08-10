#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Merge OpenCode session databases from retired profiles into one target database."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from program_installers.common import configure_logging, fail, info, warn

# Dependency order; tables absent from either database are skipped.
MERGE_ORDER = {
    "v1": (
        "project",
        "project_directory",
        "workspace",
        "permission",
        "session",
        "message",
        "part",
        "todo",
        "session_message",
    ),
    "v2": (
        "project",
        "project_directory",
        "workspace",
        "permission",
        "session",
        "message",
        "part",
        "session_message",
        "instruction_blob",
        "instruction_entry",
        "instruction_state",
        "session_pending",
    ),
}

# The target keeps its own migration bookkeeping; merging it would lie about history.
METADATA_TABLES = ("migration", "data_migration", "__drizzle_migrations")

# Global or credential state that must never be mixed between accounts.
IGNORED_TABLES = (
    "kv",
    "account",
    "account_state",
    "control_account",
    "credential",
    "session_share",
    "session_context_epoch",
    "session_input",
)

REFERENCES = {
    "project_directory": {"project_id": "project"},
    "workspace": {"project_id": "project"},
    "permission": {"project_id": "project"},
    "session": {"project_id": "project", "parent_id": "session", "workspace_id": "workspace"},
    "message": {"session_id": "session"},
    "part": {"message_id": "message", "session_id": "session"},
    "todo": {"session_id": "session"},
    "session_message": {"session_id": "session", "message_id": "message"},
    "instruction_entry": {"session_id": "session"},
    "instruction_state": {"session_id": "session"},
    "session_pending": {"session_id": "session"},
}

STORAGE_KINDS = ("message", "part", "session", "session_diff", "project")

# A self-referencing table must be copied parent-first; no foreign key enforces it.
COPY_ORDER_COLUMNS = {"session": "time_created"}


@dataclass
class TableStats:
    source_rows: int = 0
    inserted: int = 0
    skipped: int = 0
    renamed: int = 0


@dataclass
class Outcome:
    lines: list[str] = field(default_factory=list)
    stats: dict[str, TableStats] = field(default_factory=dict)

    def stat(self, table: str) -> TableStats:
        return self.stats.setdefault(table, TableStats())

    def note(self, message: str) -> None:
        self.lines.append(message)


class MergeError(Exception):
    """A source could not be merged; its transaction is rolled back."""


def connect(path: Path, *, writable: bool) -> sqlite3.Connection:
    uri = path.as_uri() if writable else f"{path.as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return connection


def table_names(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    return {row["name"] for row in rows}


def columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [row["name"] for row in connection.execute(f'PRAGMA table_info("{table}")')]


def primary_key(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = [row for row in connection.execute(f'PRAGMA table_info("{table}")') if row["pk"]]
    return [row["name"] for row in sorted(rows, key=lambda row: row["pk"])]


def applied_migrations(connection: sqlite3.Connection) -> set[str]:
    if "migration" not in table_names(connection):
        return set()
    return {str(row[0]) for row in connection.execute("SELECT id FROM migration")}


def drizzle_hashes(connection: sqlite3.Connection) -> set[str]:
    if "__drizzle_migrations" not in table_names(connection):
        return set()
    return {str(row[0]) for row in connection.execute("SELECT hash FROM __drizzle_migrations")}


def schema_differences(
    target: sqlite3.Connection, source: sqlite3.Connection, label: str
) -> list[str]:
    differences = []
    target_tables, source_tables = table_names(target), table_names(source)
    for name in sorted(source_tables - target_tables):
        differences.append(f"{label}: table {name} is missing from the target")
    for name in sorted(target_tables - source_tables):
        differences.append(f"{label}: table {name} is missing from the source")
    for name in sorted(target_tables & source_tables):
        target_columns = set(columns(target, name))
        source_columns = set(columns(source, name))
        for column in sorted(source_columns - target_columns):
            differences.append(f"{label}: {name}.{column} is missing from the target")
        for column in sorted(target_columns - source_columns):
            differences.append(f"{label}: {name}.{column} is missing from the source")
    for name, reader in (("migration", applied_migrations), ("__drizzle_migrations", drizzle_hashes)):
        target_ids, source_ids = reader(target), reader(source)
        for value in sorted(source_ids - target_ids):
            differences.append(f"{label}: {name} {value} applied only in the source")
        for value in sorted(target_ids - source_ids):
            differences.append(f"{label}: {name} {value} applied only in the target")
    return differences


def hot_journal(path: Path) -> str | None:
    wal, journal = path.with_name(path.name + "-wal"), path.with_name(path.name + "-journal")
    if wal.exists() and wal.stat().st_size > 0:
        return f"{wal} is not empty"
    if journal.exists() and journal.stat().st_size > 0:
        return f"{journal} is not empty"
    return None


def backup(paths: list[Path], directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for path in paths:
        for suffix in ("", "-wal", "-shm"):
            candidate = path.with_name(path.name + suffix)
            if candidate.exists():
                shutil.copy2(candidate, directory / candidate.name)


def rename_id(value: str, tag: str, taken: set[str]) -> str:
    candidate = f"{value}_{tag}"
    index = 2
    while candidate in taken:
        candidate = f"{value}_{tag}_{index}"
        index += 1
    return candidate


def existing_row(
    target: sqlite3.Connection, table: str, keys: list[str], values: dict[str, object]
) -> sqlite3.Row | None:
    where = " AND ".join(f'"{key}" = ?' for key in keys)
    return target.execute(
        f'SELECT * FROM "{table}" WHERE {where}', tuple(values[key] for key in keys)
    ).fetchone()


def store_row(
    target: sqlite3.Connection,
    table: str,
    values: dict[str, object],
    keys: list[str],
    mapping: dict[str, dict[str, str]],
    outcome: Outcome,
    *,
    tag: str,
    on_collision: str,
) -> None:
    """Insert one already remapped row, resolving a primary-key collision by policy."""
    stats = outcome.stat(table)
    key = keys[0] if len(keys) == 1 else None
    original = values[key] if key is not None else None
    existing = existing_row(target, table, keys, values) if keys else None
    if existing is not None:
        if all(existing[column] == value for column, value in values.items()):
            stats.skipped += 1
            if isinstance(original, str):
                mapping.setdefault(table, {})[original] = original
            return
        identifier = ", ".join(f"{name}={values[name]!r}" for name in keys)
        if on_collision == "abort":
            raise MergeError(f"{table} row {identifier} already exists with different content")
        if on_collision == "skip" or key is None or not isinstance(original, str):
            stats.skipped += 1
            outcome.note(f"{table} row {identifier} kept the target row; source row skipped")
            return
        taken = {
            str(row[0])
            for row in target.execute(f'SELECT "{key}" FROM "{table}"')
            if isinstance(row[0], str)
        }
        replacement = rename_id(original, tag, taken)
        mapping.setdefault(table, {})[original] = replacement
        values[key] = replacement
        stats.renamed += 1
        outcome.note(f"{table} {original} renamed to {replacement} on collision")
    insert_row(target, table, values)
    stats.inserted += 1


def insert_row(target: sqlite3.Connection, table: str, values: dict[str, object]) -> None:
    names = ", ".join(f'"{column}"' for column in values)
    holders = ", ".join("?" for _ in values)
    try:
        target.execute(
            f'INSERT INTO "{table}" ({names}) VALUES ({holders})', tuple(values.values())
        )
    except sqlite3.IntegrityError as error:
        # --on-collision only resolves primary keys; a UNIQUE index needs an operator decision.
        raise MergeError(
            f"{table} insert rejected by a constraint ({error}); "
            "the row was not dropped, choose how to resolve it before rerunning"
        ) from error


def remap(values: dict[str, object], table: str, mapping: dict[str, dict[str, str]]) -> None:
    for column, referenced in REFERENCES.get(table, {}).items():
        current = values.get(column)
        if isinstance(current, str) and current in mapping.get(referenced, {}):
            values[column] = mapping[referenced][current]


def dedupe_projects(
    target: sqlite3.Connection,
    source: sqlite3.Connection,
    mapping: dict[str, dict[str, str]],
    outcome: Outcome,
) -> None:
    if "worktree" not in columns(source, "project"):
        return
    known = {
        row["worktree"]: row["id"]
        for row in target.execute("SELECT id, worktree FROM project")
    }
    for row in source.execute("SELECT id, worktree FROM project"):
        reused = known.get(row["worktree"])
        if reused is None:
            continue
        mapping["project"][row["id"]] = reused
        if reused == row["id"]:
            # Same worktree under the same id: the target row wins even if other columns differ.
            outcome.note(
                f"project {row['id']} already holds worktree {row['worktree']}; "
                "kept the target row"
            )
        else:
            outcome.note(
                f"project {row['id']} reuses target project {reused} for worktree {row['worktree']}"
            )


def copy_table(
    target: sqlite3.Connection,
    source: sqlite3.Connection,
    table: str,
    mapping: dict[str, dict[str, str]],
    outcome: Outcome,
    *,
    tag: str,
    on_collision: str,
) -> None:
    shared = [column for column in columns(source, table) if column in set(columns(target, table))]
    if not shared:
        raise MergeError(f"{table} has no columns in common with the target")
    keys = primary_key(source, table)
    keys = keys if keys and all(key in shared for key in keys) else []
    stats = outcome.stat(table)
    selection = ", ".join(f'"{column}"' for column in shared)
    ordering = COPY_ORDER_COLUMNS.get(table)
    order = f' ORDER BY "{ordering}"' if ordering in shared else ""
    for row in source.execute(f'SELECT {selection} FROM "{table}"{order}'):
        stats.source_rows += 1
        values = {column: row[column] for column in shared}
        # Projects deduplicated by worktree are already represented in the target.
        if len(keys) == 1 and mapping.get(table, {}).get(values[keys[0]]) is not None:
            stats.skipped += 1
            continue
        remap(values, table, mapping)
        store_row(
            target, table, values, keys, mapping, outcome, tag=tag, on_collision=on_collision
        )


def copy_events(
    target: sqlite3.Connection,
    source: sqlite3.Connection,
    mapping: dict[str, dict[str, str]],
    outcome: Outcome,
    *,
    tag: str,
    on_collision: str,
) -> None:
    """Merge the event log, offsetting source seq numbers past aggregates the target already has."""
    shared = {"event_sequence", "event"} & table_names(target) & table_names(source)
    if "event_sequence" not in shared:
        return
    sequence_stats = outcome.stat("event_sequence")
    offsets: dict[str, int] = {}
    continued: dict[str, str] = {}
    sequence_columns = [
        column
        for column in columns(source, "event_sequence")
        if column in set(columns(target, "event_sequence"))
    ]
    sequence_selection = ", ".join(f'"{column}"' for column in sequence_columns)
    for row in source.execute(f"SELECT {sequence_selection} FROM event_sequence"):
        sequence_stats.source_rows += 1
        aggregate = mapping.get("session", {}).get(row["aggregate_id"], row["aggregate_id"])
        existing = target.execute(
            "SELECT seq FROM event_sequence WHERE aggregate_id = ?", (aggregate,)
        ).fetchone()
        if existing is None:
            values = {column: row[column] for column in sequence_columns}
            values["aggregate_id"] = aggregate
            insert_row(target, "event_sequence", values)
            sequence_stats.inserted += 1
            continue
        offsets[row["aggregate_id"]] = int(existing["seq"])
        continued[row["aggregate_id"]] = aggregate
        sequence_stats.skipped += 1
        outcome.note(
            f"event_sequence {aggregate} continues from seq {existing['seq']} in the target"
        )
    if "event" not in shared:
        return
    stats = outcome.stat("event")
    columns_shared = [
        column for column in columns(source, "event") if column in set(columns(target, "event"))
    ]
    keys = primary_key(source, "event")
    keys = keys if keys and all(key in columns_shared for key in keys) else []
    selection = ", ".join(f'"{column}"' for column in columns_shared)
    order = " ORDER BY seq" if "seq" in columns_shared else ""
    added: dict[str, int] = {}
    for row in source.execute(f'SELECT {selection} FROM "event"{order}'):
        stats.source_rows += 1
        values = {column: row[column] for column in columns_shared}
        aggregate = values.get("aggregate_id")
        if isinstance(aggregate, str):
            values["aggregate_id"] = mapping.get("session", {}).get(aggregate, aggregate)
        # An event already present under its own key was merged before; its seq must not shift.
        if keys and existing_row(target, "event", keys, values) is not None:
            stats.skipped += 1
            continue
        if isinstance(aggregate, str) and aggregate in continued and values.get("seq") is not None:
            # Continue the target's counter instead of trusting the source numbering.
            added[aggregate] = added.get(aggregate, 0) + 1
            values["seq"] = offsets[aggregate] + added[aggregate]
        store_row(
            target, "event", values, keys, mapping, outcome, tag=tag, on_collision=on_collision
        )
    for aggregate, mapped in continued.items():
        target.execute(
            "UPDATE event_sequence SET seq = ? WHERE aggregate_id = ?",
            (offsets[aggregate] + added.get(aggregate, 0), mapped),
        )


def merge_source(
    target: sqlite3.Connection,
    path: Path,
    kind: str,
    *,
    tag: str,
    on_collision: str,
) -> tuple[Outcome, dict[str, dict[str, str]]]:
    outcome = Outcome()
    mapping: dict[str, dict[str, str]] = {"project": {}}
    source = connect(path, writable=False)
    try:
        shared = table_names(target) & table_names(source)
        target.execute("BEGIN")
        try:
            if "project" in shared:
                dedupe_projects(target, source, mapping, outcome)
            for table in MERGE_ORDER[kind]:
                if table in shared:
                    copy_table(
                        target,
                        source,
                        table,
                        mapping,
                        outcome,
                        tag=tag,
                        on_collision=on_collision,
                    )
            copy_events(
                target, source, mapping, outcome, tag=tag, on_collision=on_collision
            )
        except (MergeError, sqlite3.Error) as error:
            target.execute("ROLLBACK")
            raise MergeError(f"{path}: {error}") from error
        target.execute("COMMIT")
    finally:
        source.close()
    return outcome, mapping


def copy_storage(
    roots: list[tuple[Path, Path]],
    mapping: dict[str, dict[str, str]],
    outcome: Outcome,
    *,
    dry_run: bool,
) -> None:
    renames = {old: new for table in mapping.values() for old, new in table.items()}
    for source_root, destination_root in roots:
        for kind in STORAGE_KINDS:
            directory = source_root / kind
            if not directory.is_dir():
                continue
            for item in sorted(directory.rglob("*")):
                if not item.is_file():
                    continue
                relative = item.relative_to(source_root)
                parts = [renames.get(part, part) for part in relative.parts[:-1]]
                stem, suffix = item.stem, item.suffix
                parts.append(renames.get(stem, stem) + suffix)
                destination = destination_root.joinpath(*parts)
                if destination.exists():
                    outcome.note(f"storage {relative} skipped; {destination} already exists")
                    continue
                outcome.note(f"storage {relative} copied to {destination}")
                if not dry_run:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, destination)


def validate(
    target: sqlite3.Connection, before: dict[str, int], stats: dict[str, TableStats]
) -> tuple[list[str], bool]:
    lines, ok = [], True
    integrity = [str(row[0]) for row in target.execute("PRAGMA integrity_check")]
    lines.append(f"integrity_check: {', '.join(integrity)}")
    if integrity != ["ok"]:
        ok = False
    violations = target.execute("PRAGMA foreign_key_check").fetchall()
    lines.append(f"foreign_key_check: {len(violations)} violation(s)")
    for violation in violations:
        lines.append(f"  {violation[0]} rowid {violation[1]} -> {violation[2]}")
    if violations:
        ok = False
    lines.append(
        "table                 source  before  insert    skip  after  expected  delta  lost"
    )
    for table in sorted(stats):
        stat = stats[table]
        after = target.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
        expected = before.get(table, 0) + stat.inserted
        delta = after - expected
        # Every source row must be accounted for as inserted or deliberately skipped.
        lost = stat.source_rows - stat.inserted - stat.skipped
        lines.append(
            f"{table:<21} {stat.source_rows:>6} {before.get(table, 0):>7} "
            f"{stat.inserted:>7} {stat.skipped:>7} {after:>6} {expected:>9} {delta:>6} {lost:>5}"
        )
        if delta or lost:
            ok = False
    if any(stat.source_rows - stat.inserted - stat.skipped for stat in stats.values()):
        lines.append("lost: source rows that were neither inserted nor skipped by policy")
    return lines, ok


def storage_pair(value: str) -> tuple[Path, Path]:
    source, separator, destination = value.rpartition(":")
    if not separator or not source or not destination:
        raise argparse.ArgumentTypeError("expected SRC_ROOT:DST_ROOT")
    return Path(source).expanduser(), Path(destination).expanduser()


def parse_arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="migrate_opencode_sessions.py",
        description="Merge OpenCode session databases from retired profiles into one target database.",
    )
    parser.add_argument(
        "--kind", choices=("v1", "v2"), required=True, help="OpenCode database generation"
    )
    parser.add_argument(
        "--target",
        required=True,
        type=Path,
        help="Existing database created by the target OpenCode binary",
    )
    parser.add_argument(
        "--source",
        required=True,
        action="append",
        type=Path,
        metavar="PATH",
        help="Database to merge in; repeat for each retired profile",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Directory for the pre-merge copies (default: timestamped beside the target)",
    )
    parser.add_argument(
        "--on-collision",
        choices=("abort", "skip", "rename"),
        default="abort",
        help="Action for a differing row that already holds the source primary key",
    )
    parser.add_argument(
        "--allow-schema-drift",
        action="store_true",
        help="Merge shared columns only instead of aborting on a schema or migration mismatch",
    )
    parser.add_argument(
        "--storage",
        action="append",
        default=[],
        type=storage_pair,
        metavar="SRC_ROOT:DST_ROOT",
        help="Copy the V1 storage tree for merged ids; repeatable",
    )
    parser.add_argument(
        "--force", action="store_true", help="Proceed even if a database looks in use"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Report the merge without writing anything"
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    configure_logging()
    args = parse_arguments(argv)
    target_path = args.target.expanduser()
    sources = [path.expanduser() for path in args.source]
    if not target_path.is_file():
        return fail(f"target database does not exist: {target_path}")
    for path in sources:
        if not path.is_file():
            return fail(f"source database does not exist: {path}")
        if path.resolve() == target_path.resolve():
            return fail(f"source and target are the same database: {path}")

    if not args.force:
        for path in [target_path, *sources]:
            reason = hot_journal(path)
            if reason is not None:
                return fail(f"{path} may be in use ({reason}); close OpenCode or pass --force")

    target = connect(target_path, writable=True)
    differences: list[str] = []
    for path in sources:
        source = connect(path, writable=False)
        try:
            differences.extend(schema_differences(target, source, path.name))
        finally:
            source.close()
    if differences:
        for line in differences:
            warn(line)
        if not args.allow_schema_drift:
            target.close()
            return fail("schema or migration mismatch; rerun with --allow-schema-drift to accept")
        info("Schema drift accepted; only columns present in both databases are copied.")

    scratch: tempfile.TemporaryDirectory[str] | None = None
    if args.dry_run:
        target.close()
        scratch = tempfile.TemporaryDirectory()
        working = Path(scratch.name) / target_path.name
        # The WAL comes too, or the rehearsal replays against pre-WAL content; -shm is rebuilt.
        for suffix in ("", "-wal", "-journal"):
            candidate = target_path.with_name(target_path.name + suffix)
            if candidate.exists():
                shutil.copy2(candidate, working.with_name(working.name + suffix))
        target = connect(working, writable=True)
        info("Dry run: the merge is rehearsed on a temporary copy of the target.")
    else:
        directory = args.backup_dir or target_path.parent / (
            f"opencode-merge-backup-{datetime.now(UTC).astimezone():%Y%m%d-%H%M%S}"
        )
        backup([target_path, *sources], directory)
        info(f"Backups written to {directory}")

    info(f"Migration metadata is preserved: {', '.join(METADATA_TABLES)} are never merged.")
    info(f"Account and global state is not merged: {', '.join(IGNORED_TABLES)}.")

    tables = set(MERGE_ORDER[args.kind]) | {"event_sequence", "event"}
    present = tables & table_names(target)
    before = {
        table: target.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
        for table in present
    }
    target.execute("PRAGMA foreign_keys=ON")

    stats: dict[str, TableStats] = {}
    mapping: dict[str, dict[str, str]] = {}
    failures = []
    for path in sources:
        info(f"Merging {path}")
        try:
            outcome, source_mapping = merge_source(
                target,
                path,
                args.kind,
                tag=path.stem.replace(".", "_"),
                on_collision=args.on_collision,
            )
        except MergeError as error:
            failures.append(str(error))
            warn(f"rolled back {path}: {error}")
            continue
        for line in outcome.lines:
            info(f"  {line}")
        for table, stat in outcome.stats.items():
            total = stats.setdefault(table, TableStats())
            total.source_rows += stat.source_rows
            total.inserted += stat.inserted
            total.skipped += stat.skipped
            total.renamed += stat.renamed
        for table, values in source_mapping.items():
            mapping.setdefault(table, {}).update(values)

    if args.storage:
        storage = Outcome()
        copy_storage(args.storage, mapping, storage, dry_run=args.dry_run)
        for line in storage.lines:
            info(f"  {line}")

    info("Validation report")
    lines, ok = validate(target, before, stats)
    for line in lines:
        info(f"  {line}")
    target.close()
    if scratch is not None:
        scratch.cleanup()
        info("Dry run complete; no changes were made.")
    for failure in failures:
        fail(failure)
    if not ok:
        return fail("validation failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
