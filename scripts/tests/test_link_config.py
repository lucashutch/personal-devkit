"""Integration checks for profile destinations created by link-config.py."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
LINKER = ROOT / "scripts" / "link-config.py"


def load_linker():
    from personal_devkit import link_config

    return link_config


class LinkConfigTests(unittest.TestCase):
    def environment(self, home: str) -> dict[str, str]:
        return os.environ | {
            "HOME": home,
            "XDG_CONFIG_HOME": str(Path(home) / ".config"),
            "XDG_DATA_HOME": str(Path(home) / ".local" / "share"),
            "XDG_STATE_HOME": str(Path(home) / ".local" / "state"),
            "XDG_CACHE_HOME": str(Path(home) / ".cache"),
            "PATH": "/nonexistent",
        }

    def run_linker(self, home: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(LINKER), *arguments],
            cwd=ROOT,
            env=self.environment(home),
            capture_output=True,
            text=True,
        )

    def test_check_fails_before_linking_and_passes_after(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            before = self.run_linker(home, "--dotfiles", "--check")
            self.assertNotEqual(before.returncode, 0)
            self.assertFalse((Path(home) / ".asoundrc").exists())

            self.assertEqual(self.run_linker(home, "--dotfiles").returncode, 0)
            after = self.run_linker(home, "--dotfiles", "--check")
            self.assertEqual(after.returncode, 0, after.stderr)

    def test_dry_run_makes_no_changes_and_does_not_execute_actions(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            binary = Path(home) / "bin"
            binary.mkdir()
            action_log = Path(home) / "actions"
            for name in ("opencode2", "npm"):
                executable = binary / name
                executable.write_text(f"#!/bin/sh\necho {name} >> '{action_log}'\n")
                executable.chmod(0o755)
            environment = self.environment(home) | {"PATH": str(binary)}
            result = subprocess.run(
                [sys.executable, str(LINKER), "--dry-run"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("would configure", result.stdout)
            self.assertFalse((Path(home) / ".config").exists())
            self.assertFalse(action_log.exists())

    def test_unlink_removes_matching_link_and_refuses_unmanaged_object(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(self.run_linker(home, "--dotfiles").returncode, 0)
            unmanaged = Path(home) / ".config" / "starship.toml"
            unmanaged.unlink()
            unmanaged.write_text("mine")
            result = self.run_linker(home, "--dotfiles", "--unlink")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(unmanaged.read_text(), "mine")
            self.assertTrue((Path(home) / ".asoundrc").is_symlink())

    def test_force_refuses_non_empty_directory(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            destination = Path(home) / ".config" / "ghostty"
            destination.mkdir(parents=True)
            destination.joinpath("mine").write_text("keep")
            result = self.run_linker(home, "--dotfiles", "--force")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(destination.joinpath("mine").read_text(), "keep")
            self.assertFalse(destination.is_symlink())

    def test_late_apply_conflict_leaves_earlier_link_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            manifest = Path(home) / "manifest.yaml"
            first = Path(home) / "first"
            late = Path(home) / "late"
            late.write_text("mine")
            manifest.write_text(
                "version: 1\ngroups:\n  dotfiles:\n"
                "    - source: dotfiles/starship.toml\n"
                f"      destinations:\n        - {first}\n"
                "    - source: dotfiles/.asoundrc\n"
                f"      destinations:\n        - {late}\n"
            )
            result = self.run_linker(
                home, "--dotfiles", "--manifest", str(manifest)
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(first.exists())
            self.assertEqual(late.read_text(), "mine")

    def test_late_unlink_conflict_leaves_earlier_link_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            manifest = Path(home) / "manifest.yaml"
            first = Path(home) / "first"
            late = Path(home) / "late"
            manifest.write_text(
                "version: 1\ngroups:\n  dotfiles:\n"
                "    - source: dotfiles/starship.toml\n"
                f"      destinations:\n        - {first}\n"
                "    - source: dotfiles/.asoundrc\n"
                f"      destinations:\n        - {late}\n"
            )
            self.assertEqual(
                self.run_linker(
                    home, "--dotfiles", "--manifest", str(manifest)
                ).returncode,
                0,
            )
            late.unlink()
            late.write_text("mine")
            result = self.run_linker(
                home, "--dotfiles", "--unlink", "--manifest", str(manifest)
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(first.is_symlink())
            self.assertEqual(late.read_text(), "mine")

    def test_desktop_conflict_prevents_manifest_link_mutations(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            desktop = Path(home) / ".local/share/applications/opencode.desktop"
            desktop.parent.mkdir(parents=True)
            desktop.write_text("mine")
            result = self.run_linker(home, "--opencode")
            self.assertNotEqual(result.returncode, 0)
            first_link = (
                Path(home)
                / ".config/opencode/opencode/opencode.json"
            )
            self.assertFalse(first_link.exists())
            self.assertEqual(desktop.read_text(), "mine")

    def test_opencode_unlink_installs_no_icons_and_keeps_generated_desktop_files(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(self.run_linker(home, "--opencode").returncode, 0)
            data_home = Path(home) / ".local/share"
            icons = data_home / "icons"
            desktop = data_home / "applications/opencode.desktop"
            self.assertFalse(icons.exists())
            self.assertTrue(desktop.is_file())

            result = self.run_linker(home, "--opencode", "--unlink")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(icons.exists())
            self.assertTrue(desktop.is_file())

    def test_real_manifest_contains_one_source_to_many_destinations(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            with mock.patch.dict(os.environ, self.environment(home), clear=True):
                plan = load_linker().build_plan({"opencode"})
            cli_links = [link for link in plan if link.source == ROOT / "opencode/shared/cli.json"]
            self.assertEqual(len(cli_links), 2)
            self.assertEqual(len({link.destination for link in cli_links}), 2)

    def test_build_plan_rejects_duplicate_destinations(self) -> None:
        self.assert_plan_conflict(["$HOME/target", "$HOME/target"], "duplicate destination")

    def test_build_plan_rejects_parent_child_destinations(self) -> None:
        self.assert_plan_conflict(["$HOME/target", "$HOME/target/child"], "parent/child")

    def test_filtered_mapping_preserves_paths_and_exclusion_wins(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            source = Path(home) / "source"
            source.joinpath("nested").mkdir(parents=True)
            source.joinpath("root.md").write_text("root")
            source.joinpath("nested", "keep.md").write_text("keep")
            source.joinpath("nested", "skip.md").write_text("skip")
            source.joinpath("nested", "other.txt").write_text("other")
            manifest = Path(home) / "manifest.yaml"
            manifest.write_text(
                "version: 1\ngroups:\n  dotfiles:\n"
                f"  - source: {source}\n    destinations:\n    - $HOME/target\n"
                "    include: ['*.md']\n    exclude: ['skip.md']\n"
            )
            with mock.patch.dict(os.environ, self.environment(home), clear=True):
                plan = load_linker().build_plan({"dotfiles"}, manifest)
            self.assertEqual(
                [link.destination.relative_to(Path(home) / "target").as_posix() for link in plan],
                ["nested/keep.md", "root.md"],
            )

    def test_excluded_mapping_expands_all_directories(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            source = Path(home) / "source"
            source.joinpath("complete").mkdir(parents=True)
            source.joinpath("complete", "one.txt").write_text("one")
            source.joinpath("partial").mkdir()
            source.joinpath("partial", "keep.txt").write_text("keep")
            source.joinpath("partial", "drop.log").write_text("drop")
            manifest = Path(home) / "manifest.yaml"
            manifest.write_text(
                "version: 1\ngroups:\n  dotfiles:\n"
                f"  - source: {source}\n    destinations:\n    - $HOME/target\n"
                "    exclude: ['*.log']\n"
            )
            with mock.patch.dict(os.environ, self.environment(home), clear=True):
                plan = load_linker().build_plan({"dotfiles"}, manifest)
            pairs = [(link.source.name, link.destination.relative_to(Path(home) / "target").as_posix()) for link in plan]
            self.assertEqual(
                pairs,
                [("one.txt", "complete/one.txt"), ("keep.txt", "partial/keep.txt")],
            )

    def test_filtered_mapping_schema_validation(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            source = Path(home) / "file"
            source.write_text("file")
            for field in (
                "include: '*.md'",
                "exclude: ['']",
                "include: ['*.md']",
                "include: ['file[0-9]']",
            ):
                manifest = Path(home) / "manifest.yaml"
                manifest.write_text(
                    "version: 1\ngroups:\n  dotfiles:\n"
                    f"  - source: {source}\n    destinations: [$HOME/target]\n    {field}\n"
                )
                with mock.patch.dict(os.environ, self.environment(home), clear=True):
                    with self.assertRaises(ValueError):
                        load_linker().build_plan({"dotfiles"}, manifest)

    def test_supported_glob_forms_and_symlink_directory_is_atomic(self) -> None:
        linker = load_linker()
        self.assertTrue(linker.path_matches("root.md", "**/*.md"))
        self.assertTrue(linker.path_matches("deep/root.md", "*.md"))
        self.assertTrue(linker.path_matches("subdir/deep/file", "subdir/**"))
        self.assertTrue(linker.path_matches("name.txt", "name.???"))
        with tempfile.TemporaryDirectory() as home:
            source = Path(home) / "source"
            outside = Path(home) / "outside"
            source.mkdir()
            outside.mkdir()
            outside.joinpath("secret.md").write_text("secret")
            source.joinpath("external").symlink_to(outside, target_is_directory=True)
            manifest = Path(home) / "manifest.yaml"
            manifest.write_text(
                "version: 1\ngroups:\n  dotfiles:\n"
                f"  - source: {source}\n    destinations: [$HOME/target]\n"
                "    include: ['**']\n"
            )
            with mock.patch.dict(os.environ, self.environment(home), clear=True):
                plan = linker.build_plan({"dotfiles"}, manifest)
            self.assertEqual([(link.source, link.destination) for link in plan], [
                (source / "external", Path(home) / "target/external")
            ])

    def test_evolved_filter_never_operates_through_old_directory_link(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            source = Path(home) / "source"
            source.joinpath("docs").mkdir(parents=True)
            keep = source / "docs/keep.md"
            excluded = source / "docs/excluded.txt"
            keep.write_text("keep")
            excluded.write_text("source data")
            manifest = Path(home) / "manifest.yaml"
            base = (
                "version: 1\ngroups:\n  dotfiles:\n"
                f"  - source: {source}\n    destinations: [$HOME/target]\n"
            )
            manifest.write_text(base + "    include: ['docs/**']\n")
            self.assertEqual(
                self.run_linker(home, "--dotfiles", "--manifest", str(manifest)).returncode,
                0,
            )
            self.assertTrue((Path(home) / "target/docs").is_symlink())
            manifest.write_text(
                base + "    include: ['docs/**']\n    exclude: ['excluded.txt']\n"
            )
            for mode in ((), ("--check",), ("--dry-run",), ("--unlink",)):
                result = self.run_linker(
                    home, "--dotfiles", *mode, "--manifest", str(manifest)
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(keep.read_text(), "keep")
                self.assertEqual(excluded.read_text(), "source data")

    def test_opencode_check_validates_desktop_files_without_actions(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            self.assertNotEqual(self.run_linker(home, "--opencode", "--check").returncode, 0)
            self.assertEqual(self.run_linker(home, "--opencode").returncode, 0)
            self.assertEqual(self.run_linker(home, "--opencode", "--check").returncode, 0)
            desktop = Path(home) / ".local/share/applications/opencode.desktop"
            desktop.write_text("wrong")
            self.assertNotEqual(self.run_linker(home, "--opencode", "--check").returncode, 0)

    def assert_plan_conflict(self, destinations: list[str], message: str) -> None:
        with tempfile.TemporaryDirectory() as home:
            manifest = Path(home) / "manifest.yaml"
            destination_lines = "\n".join(f"        - {item}" for item in destinations)
            manifest.write_text(
                "version: 1\ngroups:\n  dotfiles:\n"
                "    - source: dotfiles/starship.toml\n"
                f"      destinations:\n{destination_lines}\n"
            )
            with mock.patch.dict(os.environ, self.environment(home), clear=True):
                with self.assertRaisesRegex(ValueError, message):
                    load_linker().build_plan({"dotfiles"}, manifest)

    def test_dotfiles_links_pulse_alsa_config_to_home(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            environment = os.environ | {
                "HOME": temporary_home,
                "XDG_CONFIG_HOME": str(Path(temporary_home) / ".config"),
                "PATH": "/nonexistent",
            }
            result = subprocess.run(
                [sys.executable, str(LINKER), "--dotfiles"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            target = Path(temporary_home) / ".asoundrc"
            self.assertTrue(target.is_symlink())
            self.assertEqual(target.resolve(), ROOT / "dotfiles" / ".asoundrc")

    def test_herdr_links_repo_config(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            config_home = Path(temporary_home) / ".config"
            environment = os.environ | {
                "HOME": temporary_home,
                "XDG_CONFIG_HOME": str(config_home),
                "PATH": "/nonexistent",
            }
            result = subprocess.run(
                [sys.executable, str(LINKER), "--herdr"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            target = config_home / "herdr" / "config.toml"
            self.assertTrue(target.is_symlink())
            self.assertEqual(target.resolve(), ROOT / "herdr" / "config.toml")

    def test_opencode_links_surviving_profiles_without_service_files(self) -> None:
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
            npm = binary_directory / "npm"
            npm.write_text("#!/bin/sh\nexit 0\n")
            npm.chmod(0o755)
            systemctl = binary_directory / "systemctl"
            systemctl.write_text("#!/bin/sh\nexit 0\n")
            systemctl.chmod(0o755)
            environment = os.environ | {
                "HOME": temporary_home,
                "XDG_CONFIG_HOME": str(config_home),
                "XDG_DATA_HOME": str(Path(temporary_home) / ".local" / "share"),
                "XDG_STATE_HOME": str(Path(temporary_home) / ".local" / "state"),
                "XDG_CACHE_HOME": str(Path(temporary_home) / ".cache"),
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
            self.assertIn("opencode-tui-dependencies", result.stdout)
            repeat = subprocess.run(
                ["python3", str(LINKER), "--opencode"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(repeat.returncode, 0, repeat.stderr)
            for profile in ("default", "test"):
                suffix = "" if profile == "default" else f"-{profile}"
                target = config_home / f"opencode{suffix}" / "opencode"
                self.assertEqual(
                    target.joinpath("opencode.json").resolve(),
                    ROOT / "opencode" / profile / "opencode.json",
                )
                self.assertEqual(
                    target.joinpath("cli.json").resolve(),
                    ROOT / "opencode" / "shared" / "cli.json",
                )
                self.assertEqual(
                    target.joinpath("agents").resolve(),
                    ROOT / "opencode" / "shared" / "agents",
                )
                self.assertEqual(
                    target.joinpath("shared").resolve(),
                    ROOT / "opencode" / "shared",
                )
                self.assertEqual(
                    target.joinpath("shared", "plugins", "model-filter", "index.js").resolve(),
                    ROOT / "opencode" / "shared" / "plugins" / "model-filter" / "index.js",
                )
                self.assertFalse(target.joinpath("service.json").exists())
            applications = Path(environment["XDG_DATA_HOME"]) / "applications"
            launcher = applications / "opencode.desktop"
            self.assertTrue(launcher.is_file())
            self.assertIn(f"GH_CONFIG_DIR={config_home}/gh", launcher.read_text())
            self.assertFalse((Path(environment["XDG_DATA_HOME"]) / "icons").exists())
            self.assertEqual(
                service_log.read_text().splitlines(),
                [
                    "service set hostname 127.0.0.1",
                    "service set port 4099",
                    "service set hostname 127.0.0.1",
                    "service set port 4099",
                ],
            )

    def test_profile_roots_do_not_nest_when_linker_runs_in_a_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            base = Path(temporary_home) / ".config"
            environment = os.environ | {
                "HOME": temporary_home,
                "XDG_CONFIG_HOME": str(base / "opencode-test"),
                "XDG_DATA_HOME": str(Path(temporary_home) / ".local" / "share"),
                "XDG_STATE_HOME": str(Path(temporary_home) / ".local" / "state"),
                "XDG_CACHE_HOME": str(Path(temporary_home) / ".cache"),
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
            self.assertTrue((base / "opencode" / "opencode" / "opencode.json").is_symlink())
            self.assertTrue((base / "opencode-test" / "opencode" / "opencode.json").is_symlink())
            self.assertFalse((base / "opencode-test" / "opencode-test").exists())

    def test_retired_profile_roots_do_not_nest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            base = Path(temporary_home) / ".config"
            environment = os.environ | {
                "HOME": temporary_home,
                "XDG_CONFIG_HOME": str(base / "opencode-v1-home"),
                "XDG_DATA_HOME": str(Path(temporary_home) / ".local" / "share" / "opencode-v1-home"),
                "XDG_STATE_HOME": str(Path(temporary_home) / ".local" / "state"),
                "XDG_CACHE_HOME": str(Path(temporary_home) / ".cache"),
                "PATH": "/nonexistent",
            }
            result = subprocess.run(
                [sys.executable, str(LINKER), "--opencode"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((base / "opencode" / "opencode" / "opencode.json").is_symlink())
            self.assertFalse((base / "opencode-v1-home" / "opencode").exists())


if __name__ == "__main__":
    unittest.main()
