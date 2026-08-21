"""Node.js installer."""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from .common import (
    STATUS_SKIPPED,
    command_exists,
    command_path,
    error,
    force_symlink,
    info,
    run_command,
    version_for,
    warn,
)

DIST_INDEX_URL = "https://nodejs.org/dist/index.json"
MINIMUM_MAJOR = 22
NODE_BINARIES = ("node", "npm", "npx", "corepack")

# Arch names as published under https://nodejs.org/dist, keyed by platform.machine().
_ARCHITECTURES = {
    "x86_64": "x64",
    "aarch64": "arm64",
    "armv7l": "armv7l",
}


def _install_root() -> Path:
    return Path.home() / ".local" / "share" / "node"


def _dist_arch() -> str | None:
    return _ARCHITECTURES.get(platform.machine())


def _major_version(version: str) -> int | None:
    match = re.search(r"v?(\d+)\.", version)
    return int(match.group(1)) if match else None


def _installed_major() -> int | None:
    return _major_version(version_for("node")) if command_exists("node") else None


def _latest_lts() -> str | None:
    """Return the newest release whose 'lts' field names a line, e.g. 'v22.20.0'."""
    try:
        with urllib.request.urlopen(DIST_INDEX_URL, timeout=30) as response:
            releases = json.load(response)
    except (urllib.error.URLError, OSError, ValueError):
        error(f"Failed to fetch the Node.js release index from {DIST_INDEX_URL}.")
        return None

    for release in releases:
        if release.get("lts"):
            return release.get("version")
    error("The Node.js release index contained no LTS release.")
    return None


def _download_and_extract(version: str, arch: str, destination: Path) -> bool:
    name = f"node-{version}-linux-{arch}"
    url = f"https://nodejs.org/dist/{version}/{name}.tar.xz"

    info(f"Downloading Node.js {version} for linux-{arch}.")
    with tempfile.TemporaryDirectory() as work_dir:
        archive = Path(work_dir) / f"{name}.tar.xz"
        try:
            with urllib.request.urlopen(url, timeout=120) as response, archive.open("wb") as handle:
                shutil.copyfileobj(response, handle)
        except (urllib.error.URLError, OSError):
            error(f"Failed to download {url}.")
            return False

        try:
            with tarfile.open(archive) as tar:
                tar.extractall(work_dir, filter="data")
        except (tarfile.TarError, OSError):
            error(f"Failed to extract {archive.name}.")
            return False

        extracted = Path(work_dir) / name
        if not (extracted / "bin" / "node").is_file():
            error(f"{name} did not contain bin/node.")
            return False

        try:
            if destination.exists():
                shutil.rmtree(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(extracted), str(destination))
        except OSError:
            error(f"Failed to move Node.js {version} into {destination}.")
            return False
    return True


def _link_binaries(version_dir: Path) -> bool:
    local_bin = Path.home() / ".local" / "bin"
    try:
        local_bin.mkdir(parents=True, exist_ok=True)
        force_symlink(version_dir, _install_root() / "current")
        for binary in NODE_BINARIES:
            source = _install_root() / "current" / "bin" / binary
            if source.exists():
                force_symlink(source, local_bin / binary)
    except OSError:
        error(f"Failed to link Node.js binaries into {local_bin}.")
        return False
    info(f"Linked Node.js binaries into {local_bin}.")
    return True


def _foreign_node_on_path() -> str | None:
    """Return a node outside our install root that wins on PATH, which would shadow this install."""
    resolved = command_path("node")
    if not resolved:
        return None
    if _install_root() in Path(resolved).resolve().parents:
        return None
    return resolved


def install_node(options: object) -> int:
    reinstall = bool(options.reinstall)
    installed_major = _installed_major()
    if not reinstall and installed_major is not None and installed_major >= MINIMUM_MAJOR and command_exists("npm"):
        info(f"Skipping Node.js; already installed ({version_for('node')}) with npm.")
        return STATUS_SKIPPED

    arch = _dist_arch()
    if arch is None:
        error(f"Unsupported architecture for a Node.js release download: {platform.machine()}.")
        return 1

    version = _latest_lts()
    if version is None:
        return 1

    # Resolve against the caller's PATH; prepending ours below would mask any shadowing node.
    shadowing = _foreign_node_on_path()

    version_dir = _install_root() / version
    if not _download_and_extract(version, arch, version_dir):
        return 1
    if not _link_binaries(version_dir):
        return 1

    os.environ["PATH"] = f"{Path.home() / '.local' / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"
    if not command_exists("node") or not command_exists("npm"):
        error("Node.js installation completed, but node and npm were not both found on PATH.")
        return 1

    if shadowing:
        warn(f"{shadowing} is earlier on PATH and will shadow this install until that entry is removed.")
    info(f"Installed Node.js ({version_for('node')}) with npm ({version_for('npm')}) and npx.")
    return 0


def prune_old_node_versions() -> None:
    """Remove version directories under the install root that 'current' does not point at."""
    root = _install_root()
    current = root / "current"
    if not root.is_dir() or not current.is_symlink():
        return
    keep = current.resolve()
    for entry in root.iterdir():
        if entry.is_symlink() or not entry.is_dir() or entry.resolve() == keep:
            continue
        try:
            shutil.rmtree(entry)
            info(f"Removed superseded Node.js install {entry.name}.")
        except OSError:
            warn(f"Could not remove superseded Node.js install {entry}.")


def npm_global_install(package: str, binary: str, display_name: str) -> int:
    """Shared helper for CLIs published as npm packages with a '#!/usr/bin/env node' bin."""
    if not command_exists("npm"):
        error(f"npm is required to install {display_name}. Install Node.js first and rerun.")
        return 1

    info(f"Installing {display_name} with npm.")
    if run_command(["npm", "install", "--global", package], check=False).returncode != 0:
        return 1

    if not command_exists(binary):
        error(f"{display_name} installation completed, but {binary} was not found on PATH.")
        return 1

    version = version_for(binary)
    info(f"Installed {display_name} ({version})." if version else f"Installed {display_name}.")
    return 0
