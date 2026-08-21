"""Checks for the Node.js installer helpers."""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from personal_devkit.program_installers import node
from personal_devkit.program_installers.common import STATUS_SKIPPED, force_symlink


class Options:
    def __init__(self, reinstall: bool = False) -> None:
        self.reinstall = reinstall


class MajorVersionTests(unittest.TestCase):
    def test_parses_release_versions(self) -> None:
        self.assertEqual(node._major_version("v22.23.1"), 22)
        self.assertEqual(node._major_version("24.19.0"), 24)

    def test_returns_none_for_unparsable_output(self) -> None:
        self.assertIsNone(node._major_version(""))
        self.assertIsNone(node._major_version("not a version"))


class LatestLtsTests(unittest.TestCase):
    def test_selects_the_first_release_carrying_an_lts_line(self) -> None:
        releases = [
            {"version": "v25.1.0", "lts": False},
            {"version": "v24.19.0", "lts": "Krypton"},
            {"version": "v22.23.1", "lts": "Jod"},
        ]
        with mock.patch.object(node.json, "load", return_value=releases), mock.patch.object(node.urllib.request, "urlopen"):
            self.assertEqual(node._latest_lts(), "v24.19.0")

    def test_returns_none_when_no_release_is_lts(self) -> None:
        with mock.patch.object(node.json, "load", return_value=[{"version": "v25.1.0", "lts": False}]), mock.patch.object(
            node.urllib.request, "urlopen"
        ):
            self.assertIsNone(node._latest_lts())


class SkipTests(unittest.TestCase):
    def test_skips_when_a_recent_node_and_npm_are_present(self) -> None:
        with mock.patch.object(node, "_installed_major", return_value=node.MINIMUM_MAJOR), mock.patch.object(
            node, "command_exists", return_value=True
        ), mock.patch.object(node, "version_for", return_value="v22.23.1"):
            self.assertEqual(node.install_node(Options()), STATUS_SKIPPED)

    def test_does_not_skip_when_the_installed_node_is_too_old(self) -> None:
        with mock.patch.object(node, "_installed_major", return_value=node.MINIMUM_MAJOR - 1), mock.patch.object(
            node, "command_exists", return_value=True
        ), mock.patch.object(node, "_dist_arch", return_value=None):
            self.assertEqual(node.install_node(Options()), 1)

    def test_reinstall_overrides_the_skip(self) -> None:
        with mock.patch.object(node, "_installed_major", return_value=node.MINIMUM_MAJOR), mock.patch.object(
            node, "command_exists", return_value=True
        ), mock.patch.object(node, "_dist_arch", return_value=None):
            self.assertEqual(node.install_node(Options(reinstall=True)), 1)


class LinkBinariesTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.home = Path(self._temporary.name)
        self.root = self.home / ".local" / "share" / "node"
        patcher = mock.patch.object(node, "_install_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        home_patcher = mock.patch.object(node.Path, "home", staticmethod(lambda: self.home))
        home_patcher.start()
        self.addCleanup(home_patcher.stop)

    def _version_dir(self, version: str = "v24.19.0") -> Path:
        version_dir = self.root / version
        (version_dir / "bin").mkdir(parents=True)
        for binary in node.NODE_BINARIES:
            (version_dir / "bin" / binary).write_text("")
        return version_dir

    def test_points_current_at_the_version_directory(self) -> None:
        version_dir = self._version_dir()

        self.assertTrue(node._link_binaries(version_dir))

        current = self.root / "current"
        self.assertTrue(current.is_symlink())
        self.assertEqual(current.resolve(), version_dir.resolve())
        self.assertTrue(version_dir.is_dir())

    def test_links_binaries_through_current(self) -> None:
        version_dir = self._version_dir()

        self.assertTrue(node._link_binaries(version_dir))

        for binary in node.NODE_BINARIES:
            link = self.home / ".local" / "bin" / binary
            self.assertTrue(link.is_symlink(), binary)
            # Linking via current keeps the bins valid across version bumps.
            self.assertIn("current", str(link.readlink()))

    def test_relinks_over_an_existing_install(self) -> None:
        node._link_binaries(self._version_dir("v24.19.0"))
        newer = self._version_dir("v24.20.0")

        self.assertTrue(node._link_binaries(newer))

        self.assertEqual((self.root / "current").resolve(), newer.resolve())


class ForeignNodeTests(unittest.TestCase):
    def test_reports_a_node_outside_the_install_root(self) -> None:
        with mock.patch.object(node, "_install_root", return_value=Path("/home/u/.local/share/node")), mock.patch.object(
            node, "command_path", return_value="/usr/local/bin/node"
        ):
            self.assertEqual(node._foreign_node_on_path(), "/usr/local/bin/node")

    def test_ignores_our_own_install(self) -> None:
        root = Path("/home/u/.local/share/node")
        with mock.patch.object(node, "_install_root", return_value=root), mock.patch.object(
            node, "command_path", return_value=str(root / "v24.19.0" / "bin" / "node")
        ):
            self.assertIsNone(node._foreign_node_on_path())

    def test_reports_nothing_when_no_node_is_on_path(self) -> None:
        with mock.patch.object(node, "command_path", return_value=None):
            self.assertIsNone(node._foreign_node_on_path())


class PruneTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name) / "node"
        self.root.mkdir(parents=True)
        patcher = mock.patch.object(node, "_install_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_keeps_only_the_current_version(self) -> None:
        keep = self.root / "v24.19.0"
        keep.mkdir()
        (self.root / "v20.11.1").mkdir()
        force_symlink(keep, self.root / "current")

        node.prune_old_node_versions()

        self.assertEqual(sorted(entry.name for entry in self.root.iterdir()), ["current", "v24.19.0"])

    def test_does_nothing_without_a_current_symlink(self) -> None:
        (self.root / "v20.11.1").mkdir()

        node.prune_old_node_versions()

        self.assertTrue((self.root / "v20.11.1").is_dir())


@unittest.skipUnless(shutil.which("curl") or True, "network")
class ArchitectureTests(unittest.TestCase):
    def test_maps_known_machines_to_dist_names(self) -> None:
        with mock.patch.object(node.platform, "machine", return_value="x86_64"):
            self.assertEqual(node._dist_arch(), "x64")
        with mock.patch.object(node.platform, "machine", return_value="aarch64"):
            self.assertEqual(node._dist_arch(), "arm64")

    def test_returns_none_for_unknown_machines(self) -> None:
        with mock.patch.object(node.platform, "machine", return_value="riscv64"):
            self.assertIsNone(node._dist_arch())


if __name__ == "__main__":
    unittest.main()
