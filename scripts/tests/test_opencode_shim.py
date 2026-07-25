"""Profile resolution checks for the OpenCode shim used by external resume."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SHIM = ROOT / "dotfiles" / "bashrc.d" / "bin" / "opencode"

V1_DB_SESSION = "ses_v1homedbexample"
V1_LEGACY_SESSION = "ses_v1homejsonexample"
V2_SESSION = "ses_v2testexample"


def write_session_database(path: Path, session: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("create table session (id text primary key)")
    connection.execute("insert into session values (?)", (session,))
    connection.commit()
    connection.close()


class OpenCodeShimTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.home = Path(self._temporary.name)

        # Live V1 sessions are in opencode.db; the JSON tree is the legacy store.
        write_session_database(
            self.home / ".local/share/opencode-v1-home/opencode/opencode.db",
            V1_DB_SESSION,
        )
        session_dir = (
            self.home
            / ".local/share/opencode-v1-home/opencode/storage/session/global"
        )
        session_dir.mkdir(parents=True)
        (session_dir / f"{V1_LEGACY_SESSION}.json").write_text("{}")

        write_session_database(
            self.home / ".local/share/opencode-v2-test/opencode/opencode-next.db",
            V2_SESSION,
        )

        # Stand-in binaries so the shim's exec target and environment are observable.
        self.bin_dir = self.home / "bin"
        self.bin_dir.mkdir()
        for name in ("opencode", "opencode2"):
            binary = self.bin_dir / name
            binary.write_text(
                "#!/bin/sh\n"
                f'printf "binary=%s data=%s\\n" {name} "${{XDG_DATA_HOME-unset}}"\n'
            )
            binary.chmod(0o755)

    def run_shim(self, name: str, *args: str, profile: str | None = None) -> str:
        environment = os.environ | {
            "HOME": str(self.home),
            "PATH": f"{self.bin_dir}:/usr/bin:/bin",
        }
        if profile is None:
            environment.pop("OPENCODE_PROFILE", None)
        else:
            environment["OPENCODE_PROFILE"] = profile
        # The shim keys its generation off argv[0], so it is invoked by name.
        invocation = self.home / name
        if not invocation.is_symlink():
            invocation.symlink_to(SHIM)
        result = subprocess.run(
            [str(invocation), *args],
            env=environment,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def test_v1_defaults_to_work_profile(self) -> None:
        output = self.run_shim("opencode")
        self.assertIn("binary=opencode", output)
        self.assertIn("opencode-v1-work", output)

    def test_requested_v2_profile_is_applied(self) -> None:
        output = self.run_shim("opencode2", profile="home")
        self.assertIn("binary=opencode2", output)
        self.assertIn("opencode-v2-home", output)

    def test_bare_v2_keeps_global_namespace(self) -> None:
        output = self.run_shim("opencode2", profile="")
        self.assertIn("binary=opencode2", output)
        self.assertIn("data=unset", output)

    def test_session_switches_to_owning_v1_profile(self) -> None:
        output = self.run_shim("opencode", "--session", V1_DB_SESSION, profile="work")
        self.assertIn("binary=opencode", output)
        self.assertIn("opencode-v1-home", output)

    def test_legacy_v1_session_store_is_still_matched(self) -> None:
        output = self.run_shim(
            "opencode", "--session", V1_LEGACY_SESSION, profile="work"
        )
        self.assertIn("binary=opencode", output)
        self.assertIn("opencode-v1-home", output)

    def test_session_switches_generation_and_profile(self) -> None:
        output = self.run_shim("opencode", f"--session={V2_SESSION}", profile="work")
        self.assertIn("binary=opencode2", output)
        self.assertIn("opencode-v2-test", output)

    def test_unknown_session_keeps_requested_profile(self) -> None:
        output = self.run_shim("opencode", "-s", "ses_missing", profile="work")
        self.assertIn("binary=opencode", output)
        self.assertIn("opencode-v1-work", output)


if __name__ == "__main__":
    unittest.main()
