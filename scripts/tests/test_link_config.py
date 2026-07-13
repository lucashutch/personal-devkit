"""Integration checks for profile destinations created by link-config.py."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
LINKER = ROOT / "scripts" / "link-config.py"


class LinkConfigTests(unittest.TestCase):
    def test_opencode_links_all_v2_profiles_without_service_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            config_home = Path(temporary_home) / ".config"
            binary_directory = Path(temporary_home) / "bin"
            binary_directory.mkdir()
            service_log = Path(temporary_home) / "service.log"
            executable = binary_directory / "opencode2"
            executable.write_text(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$SERVICE_LOG\"\n"
            )
            executable.chmod(0o755)
            environment = os.environ | {
                "HOME": temporary_home,
                "XDG_CONFIG_HOME": str(config_home),
                "PATH": f"{binary_directory}:{os.environ['PATH']}",
                "SERVICE_LOG": str(service_log),
            }
            result = subprocess.run(
                ["python3", str(LINKER), "--opencode"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            repeat = subprocess.run(
                ["python3", str(LINKER), "--opencode"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(repeat.returncode, 0, repeat.stderr)
            self.assertFalse((config_home / "opencode").exists())
            for profile in ("home", "work", "test"):
                target = config_home / f"opencode-v2-{profile}" / "opencode"
                self.assertEqual(
                    target.joinpath("opencode.json").resolve(),
                    ROOT / "opencode" / "v2" / profile / "opencode.json",
                )
                self.assertEqual(
                    target.joinpath("cli.json").resolve(),
                    ROOT / "opencode" / "v2" / "shared" / "cli.json",
                )
                self.assertEqual(
                    target.joinpath("agents").resolve(),
                    ROOT / "opencode" / "v2" / "shared" / "agents",
                )
                self.assertFalse(target.joinpath("service.json").exists())
            self.assertEqual(
                (config_home / "opencode-v2-work" / "opencode" / "plugins").resolve(),
                ROOT / "opencode" / "v2" / "work" / "plugins",
            )
            self.assertEqual(
                (config_home / "opencode-v2-test" / "opencode" / "plugins").resolve(),
                ROOT / "opencode" / "v2" / "test" / "plugins",
            )
            self.assertEqual(
                service_log.read_text().splitlines(),
                [
                    "service set hostname 127.0.0.1",
                    "service set port 4098",
                    "service set hostname 127.0.0.1",
                    "service set port 4097",
                    "service set hostname 127.0.0.1",
                    "service set port 4099",
                    "service set hostname 127.0.0.1",
                    "service set port 4098",
                    "service set hostname 127.0.0.1",
                    "service set port 4097",
                    "service set hostname 127.0.0.1",
                    "service set port 4099",
                ],
            )

    def test_profile_roots_do_not_nest_when_linker_runs_in_a_v1_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            base = Path(temporary_home) / ".config"
            environment = os.environ | {
                "HOME": temporary_home,
                "XDG_CONFIG_HOME": str(base / "opencode-v1-home"),
                "PATH": "/nonexistent",
            }
            result = subprocess.run(
                [sys.executable, str(LINKER), "--opencode"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((base / "opencode-v2-home" / "opencode" / "opencode.json").is_symlink())
            self.assertFalse((base / "opencode-v1-home" / "opencode-v2-home").exists())


if __name__ == "__main__":
    unittest.main()
