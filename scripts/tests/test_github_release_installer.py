"""Checks for the shared GitHub release tarball installer."""

from __future__ import annotations

import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from personal_devkit.program_installers import github_release, glow, glowm

RELEASE = {
    "tag_name": "v3.0.0",
    "assets": [
        {
            "name": "glow_3.0.0_Linux_x86_64.tar.gz",
            "digest": "sha256:" + "0" * 64,
            "browser_download_url": "https://example.invalid/glow.tar.gz",
        }
    ],
}


def tarball(names: tuple[str, ...], payload: bytes = b"binary") -> Path:
    archive = Path(tempfile.mkdtemp()) / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name in names:
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return archive


class AssetNameTests(unittest.TestCase):
    def test_glow_uses_the_capitalised_x86_64_asset_name(self) -> None:
        self.assertEqual(glow.ARCHITECTURES["x86_64"], "x86_64")

    def test_glowm_uses_the_lowercase_amd64_asset_name(self) -> None:
        self.assertEqual(glowm.ARCHITECTURES["x86_64"], "amd64")


class ExtractBinaryTests(unittest.TestCase):
    def test_extracts_a_nested_binary(self) -> None:
        archive = tarball(("README.md", "glow_3.0.0/glow"))
        destination = archive.parent / "glow"
        self.assertTrue(github_release._extract_binary(archive, "glow", destination))
        self.assertEqual(destination.read_bytes(), b"binary")
        self.assertTrue(destination.stat().st_mode & 0o111)

    def test_reports_a_missing_binary(self) -> None:
        archive = tarball(("README.md",))
        self.assertFalse(github_release._extract_binary(archive, "glow", archive.parent / "glow"))


class InstallReleaseTarballTests(unittest.TestCase):
    def install(self, release: dict, architectures: dict[str, str]) -> int:
        with (
            mock.patch.object(github_release, "_release", return_value=release),
            mock.patch.object(github_release.platform, "machine", return_value="x86_64"),
            mock.patch.object(github_release, "_download_and_verify", return_value=False),
        ):
            return github_release.install_release_tarball(
                repo="charmbracelet/glow",
                binary="glow",
                asset_for=lambda version, architecture: f"glow_{version}_Linux_{architecture}.tar.gz",
                architectures=architectures,
            )

    def test_rejects_an_unsupported_architecture(self) -> None:
        self.assertEqual(self.install(RELEASE, {"aarch64": "arm64"}), 1)

    def test_rejects_a_release_without_a_sha256_digest(self) -> None:
        release = {"tag_name": "v3.0.0", "assets": [dict(RELEASE["assets"][0], digest="")]}
        self.assertEqual(self.install(release, {"x86_64": "x86_64"}), 1)

    def test_rejects_a_release_missing_the_expected_asset(self) -> None:
        self.assertEqual(self.install({"tag_name": "v3.0.0", "assets": []}, {"x86_64": "x86_64"}), 1)


if __name__ == "__main__":
    unittest.main()
