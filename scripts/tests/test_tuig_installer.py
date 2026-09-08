"""Checks for the tuig installer."""

from __future__ import annotations

import io
import json
import unittest
import urllib.request
from types import SimpleNamespace
from unittest import mock

from personal_devkit.program_installers import tuig


def release_response(tag: str) -> io.BytesIO:
    return io.BytesIO(json.dumps({"tag_name": tag}).encode())


class InstallTuigTests(unittest.TestCase):
    def test_missing_bun_fails_without_touching_the_network(self) -> None:
        options = SimpleNamespace(reinstall=False)
        with (
            mock.patch.object(tuig, "should_skip_tool", return_value=False),
            mock.patch.object(tuig, "command_exists", return_value=False),
            mock.patch.object(tuig.urllib.request, "urlopen") as urlopen,
        ):
            self.assertEqual(tuig.install_tuig(options), 1)
        urlopen.assert_not_called()

    def test_install_runs_bun_global_install_for_the_latest_tag(self) -> None:
        options = SimpleNamespace(reinstall=False)
        completed = SimpleNamespace(returncode=0)
        with (
            mock.patch.object(tuig, "should_skip_tool", return_value=False),
            mock.patch.object(tuig, "command_exists", return_value=True),
            mock.patch.object(
                tuig.urllib.request,
                "urlopen",
                return_value=release_response("v1.2.3"),
            ),
            mock.patch.object(tuig, "run_command", return_value=completed) as run,
        ):
            self.assertEqual(tuig.install_tuig(options), 0)
        run.assert_called_once_with(
            ["bun", "install", "--global", f"{tuig.REPOSITORY}#v1.2.3"], check=False
        )


if __name__ == "__main__":
    unittest.main()
