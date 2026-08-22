"""Shared helpers for installing a binary from a GitHub release tarball."""

from __future__ import annotations

import hashlib
import json
import platform
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from .common import error, info

USER_AGENT = "personal-devkit-installer"


def _release(repo: str) -> dict | None:
    try:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/releases/latest",
            headers={"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        error(f"Could not fetch the latest {repo} release: {exc}")
        return None


def _download_and_verify(url: str, expected_sha256: str, destination: Path) -> bool:
    digest = hashlib.sha256()
    try:
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/octet-stream", "User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as archive:
            while chunk := response.read(1024 * 1024):
                archive.write(chunk)
                digest.update(chunk)
    except (OSError, urllib.error.URLError) as exc:
        error(f"Could not download {destination.name}: {exc}")
        return False
    if digest.hexdigest().lower() != expected_sha256.lower():
        error(f"{destination.name} failed SHA-256 verification.")
        return False
    return True


def _extract_binary(archive: Path, binary: str, destination: Path) -> bool:
    try:
        with tarfile.open(archive) as tar:
            member = next(
                (entry for entry in tar.getmembers() if entry.isfile() and Path(entry.name).name == binary),
                None,
            )
            if member is None:
                error(f"{archive.name} does not contain a {binary} binary.")
                return False
            extracted = tar.extractfile(member)
            if extracted is None:
                return False
            with extracted, destination.open("wb") as target:
                while chunk := extracted.read(1024 * 1024):
                    target.write(chunk)
    except (OSError, tarfile.TarError) as exc:
        error(f"Could not extract {binary} from {archive.name}: {exc}")
        return False
    destination.chmod(0o755)
    return True


def install_release_tarball(
    *,
    repo: str,
    binary: str,
    asset_for: object,
    architectures: dict[str, str],
) -> int:
    """Install `binary` into ~/.local/bin from the latest release of `repo`.

    `asset_for(version, architecture)` returns the tarball asset name. Releases that
    publish no SHA-256 digest are rejected rather than installed unverified.
    """
    architecture = architectures.get(platform.machine().lower())
    if not architecture:
        error(f"{binary} is not packaged for this architecture: {platform.machine()}.")
        return 1

    release = _release(repo)
    if release is None:
        return 1
    version = str(release.get("tag_name", "")).lstrip("v")
    if not version:
        error(f"The latest {repo} release has no tag name.")
        return 1

    asset_name = asset_for(version, architecture)  # type: ignore[operator]
    asset = next((item for item in release.get("assets", []) if item.get("name") == asset_name), None)
    if asset is None:
        error(f"The latest {repo} release has no {asset_name} asset.")
        return 1
    digest = asset.get("digest", "")
    if not isinstance(digest, str) or not digest.startswith("sha256:"):
        error(f"The {repo} release does not provide a SHA-256 digest for {asset_name}.")
        return 1
    url = asset.get("browser_download_url", "")
    if not url:
        error(f"{asset_name} has no download URL.")
        return 1

    info(f"Installing {binary} {version} from the {repo} GitHub release.")
    local_bin = Path.home() / ".local" / "bin"
    try:
        local_bin.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        error(f"Could not create {local_bin}: {exc}")
        return 1

    with tempfile.TemporaryDirectory() as temp_dir:
        archive = Path(temp_dir) / asset_name
        if not _download_and_verify(url, digest.removeprefix("sha256:"), archive):
            return 1
        staged = Path(temp_dir) / binary
        if not _extract_binary(archive, binary, staged):
            return 1
        try:
            installed = local_bin / binary
            installed.write_bytes(staged.read_bytes())
            installed.chmod(0o755)
        except OSError as exc:
            error(f"Could not install {binary} into {local_bin}: {exc}")
            return 1

    info(f"Installed {binary} {version} into {local_bin}.")
    return 0
