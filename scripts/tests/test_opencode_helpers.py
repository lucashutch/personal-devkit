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
    "websockets": os.environ.get("OPENCODE_EXPERIMENTAL_OPENAI_RESPONSES_WEBSOCKET", ""),
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

        for name in ("opencode2",):
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

    def test_default_applies_its_namespace(self) -> None:
        seen = self.run_helper("opencode")
        self.assertEqual(seen["argv"], [])
        self.assertEqual(seen["config"], "")
        self.assertEqual(seen["data"], "")
        self.assertEqual(seen["state"], "")
        self.assertEqual(seen["cache"], "")
        self.assertEqual(seen["gh"], f"{self.home}/.config/gh")
        self.assertEqual(self.systemctl_calls(), [])

    def test_short_alias_matches_the_default(self) -> None:
        seen = self.run_helper("oc --model anthropic/claude /tmp")
        self.assertEqual(seen["argv"], ["--model", "anthropic/claude", "/tmp"])
        self.assertEqual(seen["config"], "")
        self.assertEqual(seen["websockets"], "1")

    def test_short_alias_enables_websockets_when_stripping_profile(self) -> None:
        seen = self.run_helper(
            f'XDG_CONFIG_HOME="{self.home}/.config/opencode-test" oc service start'
        )
        self.assertEqual(seen["config"], f"{self.home}/.config")
        self.assertEqual(seen["argv"], ["service", "start"])
        self.assertEqual(seen["websockets"], "1")

    def test_short_alias_does_not_leak_websocket_setting(self) -> None:
        seen = self.run_helper("oc >/dev/null; opencode")
        self.assertEqual(seen["websockets"], "")

    def test_test_profile_applies_its_namespace(self) -> None:
        seen = self.run_helper("oct")
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-test")
        self.assertEqual(seen["data"], f"{self.home}/.local/share/opencode-test")
        self.assertEqual(seen["state"], f"{self.home}/.local/state/opencode-test")
        self.assertEqual(seen["cache"], f"{self.home}/.cache/opencode-test")
        # gh stays shared so one login covers every profile.
        self.assertEqual(seen["gh"], f"{self.home}/.config/gh")

    def test_legacy_aliases_match_the_new_names(self) -> None:
        seen = self.run_helper("opencode2")
        self.assertEqual(seen["config"], "")
        seen = self.run_helper("oc2 run hello")
        self.assertEqual(seen["argv"], ["run", "hello"])
        self.assertEqual(seen["config"], "")
        seen = self.run_helper("o2t")
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-test")

    def test_profile_roots_do_not_nest(self) -> None:
        seen = self.run_helper(
            f'XDG_CONFIG_HOME="{self.home}/.config/opencode-test" opencode'
        )
        self.assertEqual(seen["config"], f"{self.home}/.config")

    def test_test_root_does_not_nest_under_the_default_root(self) -> None:
        seen = self.run_helper(f'XDG_CONFIG_HOME="{self.home}/.config/opencode" oct')
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-test")

    def test_retired_roots_still_de_nest(self) -> None:
        seen = self.run_helper(f'XDG_CONFIG_HOME="{self.home}/.config/opencode-v2" oct')
        self.assertEqual(seen["config"], f"{self.home}/.config/opencode-test")

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

    def test_completions_are_loaded_when_binary_is_installed(self) -> None:
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
            'complete -p opencode; complete -p oct'
        )
        result = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            cwd=self.home,
            env={"HOME": str(self.home), "PATH": f"{self.bin_dir}:/usr/bin:/bin"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("complete -F _opencode2 opencode", result.stdout)
        self.assertIn("complete -F _opencode2 oct", result.stdout)


if __name__ == "__main__":
    unittest.main()
