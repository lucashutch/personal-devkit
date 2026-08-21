"""OpenCode Desktop installer for Debian-based Linux systems."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from .common import STATUS_SKIPPED, command_exists, error, info, run_command

RELEASE_API = "https://api.github.com/repos/anomalyco/opencode/releases/latest"
PACKAGE_NAME = "opencode"
ARCHITECTURES = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}


def _sudo_command(command: list[str]) -> list[str]:
    return command if os.geteuid() == 0 else ["sudo", *command]


def _installed_version() -> str:
    try:
        result = run_command(
            ["dpkg-query", "-W", "-f=${db:Status-Abbrev} ${Version}", PACKAGE_NAME],
            capture_output=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    status, _, version = result.stdout.partition(" ")
    return version.strip() if result.returncode == 0 and status.startswith("ii") else ""


def _desktop_asset() -> tuple[str, str, str] | None:
    architecture = ARCHITECTURES.get(platform.machine().lower())
    if not architecture:
        error(f"OpenCode Desktop is not packaged for this architecture: {platform.machine()}.")
        return None
    asset_name = f"opencode-desktop-linux-{architecture}.deb"
    try:
        request = urllib.request.Request(
            RELEASE_API,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "personal-devkit-opencode-installer",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            release = json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        error(f"Could not fetch the latest OpenCode Desktop release: {exc}")
        return None

    for asset in release.get("assets", []):
        if asset.get("name") != asset_name:
            continue
        digest = asset.get("digest", "")
        if not isinstance(digest, str) or not digest.startswith("sha256:"):
            error("The OpenCode Desktop release does not provide a SHA-256 digest.")
            return None
        return asset_name, asset.get("browser_download_url", ""), digest.removeprefix("sha256:")
    error(f"The latest OpenCode Desktop release has no {asset_name} package.")
    return None


def _download_and_verify(url: str, expected_sha256: str, destination: Path) -> bool:
    if not url:
        error("The OpenCode Desktop release package has no download URL.")
        return False
    digest = hashlib.sha256()
    try:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/octet-stream",
                "User-Agent": "personal-devkit-opencode-installer",
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as package:
            while chunk := response.read(1024 * 1024):
                package.write(chunk)
                digest.update(chunk)
    except (OSError, urllib.error.URLError) as exc:
        error(f"Could not download OpenCode Desktop: {exc}")
        return False
    if digest.hexdigest().lower() != expected_sha256.lower():
        error("OpenCode Desktop download failed SHA-256 verification.")
        return False
    return True


def install_opencode_desktop(options: object) -> int:
    """Install the official OpenCode Desktop DEB, or skip an existing install."""
    reinstall = bool(options.reinstall)
    installed = _installed_version()
    if installed and not reinstall:
        info(f"Skipping OpenCode Desktop; already installed ({installed}).")
        return STATUS_SKIPPED

    required = ["apt-get", "dpkg-query"]
    if os.geteuid() != 0:
        required.append("sudo")
    missing = [command for command in required if not command_exists(command)]
    if missing:
        error(f"Cannot install OpenCode Desktop; missing required command(s): {', '.join(missing)}.")
        return 1

    asset = _desktop_asset()
    if not asset:
        return 1
    asset_name, url, sha256 = asset
    info("Installing OpenCode Desktop from the official GitHub release.")
    with tempfile.TemporaryDirectory() as temp_dir:
        package = Path(temp_dir) / asset_name
        if not _download_and_verify(url, sha256, package):
            return 1
        result = run_command(_sudo_command(["apt-get", "install", "-y", str(package)]), check=False)
    if result.returncode != 0:
        error("Failed to install the OpenCode Desktop package.")
        return 1

    version = _installed_version()
    if not version:
        error("OpenCode Desktop installation completed, but its system package was not found.")
        return 1
    info(f"Installed OpenCode Desktop ({version}).")
    return 0
