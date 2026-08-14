"""Profile checks for the OpenCode shell helpers."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPERS = ROOT / "dotfiles" / "bashrc.d" / "opencode.sh"
COMPLETIONS = ROOT / "dotfiles" / "bashrc.d" / "30-completions.sh"

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

    def test_v1_default_sets_no_xdg_override(self) -> None:
        seen = self.run_helper("opencode")
        self.assertEqual(seen["argv"], [])
        self.assertEqual(seen["config"], "")
        self.assertEqual(seen["data"], "")
        self.assertEqual(seen["state"], "")
        self.assertEqual(seen["cache"], "")
        self.assertEqual(seen["websockets"], "true")
        self.assertEqual(self.systemctl_calls(), [])

    def test_v1_short_alias_matches_the_default(self) -> None:
        seen = self.run_helper("oc --model anthropic/claude /tmp")
        self.assertEqual(seen["argv"], ["--model", "anthropic/claude", "/tmp"])
        self.assertEqual(seen["config"], "")
        self.assertEqual(seen["websockets"], "true")

    def test_v1_test_profile_applies_its_namespace(self) -> None:
        seen = self.run_helper("oct")
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v1-test")
        self.assertEqual(seen["data"], f"{self.home}/.local/share/opencode-v1-test")
        self.assertEqual(seen["state"], f"{self.home}/.local/state/opencode-v1-test")
        self.assertEqual(seen["cache"], f"{self.home}/.cache/opencode-v1-test")
        # gh stays shared so one login covers every profile.
        self.assertEqual(seen["gh"], f"{self.home}/.config/gh")
        self.assertEqual(seen["websockets"], "true")

    def test_v2_default_applies_its_namespace(self) -> None:
        seen = self.run_helper("opencode2")
        self.assertEqual(seen["argv"], [])
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v2")
        self.assertEqual(seen["data"], f"{self.home}/.local/share/opencode-v2")
        self.assertEqual(seen["state"], f"{self.home}/.local/state/opencode-v2")
        self.assertEqual(seen["cache"], f"{self.home}/.cache/opencode-v2")
        self.assertEqual(seen["gh"], f"{self.home}/.config/gh")
        self.assertEqual(self.systemctl_calls(), [])

    def test_v2_short_alias_matches_the_default(self) -> None:
        seen = self.run_helper("oc2 run hello")
        self.assertEqual(seen["argv"], ["run", "hello"])
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v2")

    def test_v2_test_profile_applies_its_namespace(self) -> None:
        seen = self.run_helper("o2t")
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v2-test")
        self.assertEqual(seen["data"], f"{self.home}/.local/share/opencode-v2-test")

    def test_v2_profile_roots_do_not_nest(self) -> None:
        seen = self.run_helper(
            f'XDG_CONFIG_HOME="{self.home}/.config/opencode-v2-test" opencode2'
        )
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v2")

    def test_v2_test_root_does_not_nest_under_the_default_root(self) -> None:
        seen = self.run_helper(f'XDG_CONFIG_HOME="{self.home}/.config/opencode-v2" o2t')
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-v2-test")

    def test_helpers_do_not_leak_the_namespace_into_the_shell(self) -> None:
        script = (
            f'set -u; source "{HELPERS}"; oct >/dev/null; '
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

    def test_v2_completions_are_loaded_when_binary_is_installed(self) -> None:
        stub = self.bin_dir / "opencode2"
        stub.write_text(
            "#!/usr/bin/env bash\n"
            "if [[ $1 == --completions && $2 == bash ]]; then\n"
            "  printf '%s\\n' 'complete -W \\\"run\\\" opencode2'\n"
            "fi\n"
        )
        stub.chmod(0o755)
        script = (
            f'set -u; source "{HELPERS}"; source "{COMPLETIONS}"; '
            'complete -p opencode2; complete -p oc2'
        )
        result = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            cwd=self.home,
            env={"HOME": str(self.home), "PATH": f"{self.bin_dir}:/usr/bin:/bin"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("complete -F _opencode2 opencode2", result.stdout)
        self.assertIn("complete -F _opencode2 oc2", result.stdout)


if __name__ == "__main__":
    unittest.main()
