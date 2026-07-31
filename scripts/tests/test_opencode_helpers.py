"""Profile and attach-mode checks for the OpenCode shell helpers."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPERS = ROOT / "dotfiles" / "bashrc.d" / "opencode.sh"

# Records the argv and the profile-relevant environment of the real binary.
STUB = """#!/usr/bin/env bash
python3 - "$@" <<'PY'
import json, os, sys
print(json.dumps({
    "argv": sys.argv[1:],
    "config": os.environ.get("XDG_CONFIG_HOME", ""),
    "data": os.environ.get("XDG_DATA_HOME", ""),
    "state": os.environ.get("XDG_STATE_HOME", ""),
    "cache": os.environ.get("XDG_CACHE_HOME", ""),
    "gh": os.environ.get("GH_CONFIG_DIR", ""),
    "websockets": os.environ.get("OPENCODE_EXPERIMENTAL_WEBSOCKETS", ""),
}))
PY
"""

SYSTEMCTL_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_LOG"
"""


class OpenCodeHelperTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.home = Path(self._temporary.name)
        self.bin_dir = self.home / "bin"
        self.bin_dir.mkdir()
        self.log = self.home / "systemctl.log"

        for name in ("opencode", "opencode2"):
            stub = self.bin_dir / name
            stub.write_text(STUB)
            stub.chmod(0o755)
        systemctl = self.bin_dir / "systemctl"
        systemctl.write_text(SYSTEMCTL_STUB)
        systemctl.chmod(0o755)

    def run_helper(self, command: str) -> dict:
        """Runs one helper invocation and returns what the stub binary saw."""
        script = f'set -u; source "{HELPERS}"; {command}'
        result = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            cwd=self.home,
            env={
                "HOME": str(self.home),
                "PATH": f"{self.bin_dir}:/usr/bin:/bin",
                "STUB_LOG": str(self.log),
            },
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def systemctl_calls(self) -> list[str]:
        if not self.log.exists():
            return []
        return self.log.read_text().split("\n")[:-1]

    def test_v1_helper_applies_profile_namespace(self) -> None:
        seen = self.run_helper("och")
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v1-home")
        self.assertEqual(seen["data"], f"{self.home}/.local/share/opencode-v1-home")
        self.assertEqual(seen["state"], f"{self.home}/.local/state/opencode-v1-home")
        self.assertEqual(seen["cache"], f"{self.home}/.cache/opencode-v1-home")
        # gh stays shared so one login covers every profile.
        self.assertEqual(seen["gh"], f"{self.home}/.config/gh")
        self.assertEqual(seen["websockets"], "true")

    def test_v1_tui_attaches_to_the_profile_server(self) -> None:
        seen = self.run_helper("och")
        self.assertEqual(
            seen["argv"],
            ["attach", "http://127.0.0.1:4195", "--dir", str(self.home)],
        )
        self.assertEqual(
            self.systemctl_calls(), ["--user start opencode-v1-home.service"]
        )

    def test_each_v1_profile_uses_its_own_port(self) -> None:
        self.assertIn("http://127.0.0.1:4196", self.run_helper("ocw")["argv"])
        self.assertIn("http://127.0.0.1:4197", self.run_helper("oct")["argv"])

    def test_directory_argument_becomes_the_attach_directory(self) -> None:
        seen = self.run_helper("och /tmp")
        self.assertEqual(seen["argv"][-2:], ["--dir", "/tmp"])

    def test_session_flag_is_forwarded_to_attach(self) -> None:
        seen = self.run_helper("och --session ses_example")
        self.assertEqual(
            seen["argv"],
            [
                "attach",
                "http://127.0.0.1:4195",
                "--session",
                "ses_example",
                "--dir",
                str(self.home),
            ],
        )

    def test_subcommands_keep_the_standalone_path(self) -> None:
        seen = self.run_helper("och models")
        self.assertEqual(seen["argv"], ["models"])
        self.assertEqual(self.systemctl_calls(), [])

    def test_unsupported_tui_flags_keep_the_standalone_path(self) -> None:
        seen = self.run_helper("och --model anthropic/claude")
        self.assertEqual(seen["argv"], ["--model", "anthropic/claude"])
        self.assertEqual(self.systemctl_calls(), [])

    def test_v2_helper_applies_profile_namespace_without_attach(self) -> None:
        seen = self.run_helper("o2h")
        self.assertEqual(seen["argv"], [])
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v2-home")
        self.assertEqual(seen["data"], f"{self.home}/.local/share/opencode-v2-home")
        self.assertEqual(self.systemctl_calls(), [])

    def test_v2_profile_roots_do_not_nest(self) -> None:
        seen = self.run_helper(
            f'XDG_CONFIG_HOME="{self.home}/.config/opencode-v2-work" o2h'
        )
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v2-home")

    def test_helpers_do_not_leak_the_namespace_into_the_shell(self) -> None:
        script = (
            f'set -u; source "{HELPERS}"; och >/dev/null; '
            'printf "%s\\n" "${XDG_CONFIG_HOME:-unset}"'
        )
        result = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            cwd=self.home,
            env={
                "HOME": str(self.home),
                "PATH": f"{self.bin_dir}:/usr/bin:/bin",
                "STUB_LOG": str(self.log),
            },
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "unset")


if __name__ == "__main__":
    unittest.main()
