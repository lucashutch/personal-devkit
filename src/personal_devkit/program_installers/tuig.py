"""Tuig installer."""

from __future__ import annotations

import json
import urllib.request

from .common import STATUS_SKIPPED, error, info, should_skip_tool
from .node import run_command

RELEASE_URL = "https://api.github.com/repos/lucashutch/tuig/releases/latest"
REPOSITORY = "git+https://github.com/lucashutch/tuig.git"


def install_tuig(options: object) -> int:
    if should_skip_tool("tuig", reinstall=options.reinstall):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    try:
        request = urllib.request.Request(RELEASE_URL, headers={"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            tag = json.load(response).get("tag_name")
    except (OSError, ValueError) as exc:
        error(f"Could not fetch the latest tuig release: {exc}")
        return 1
    if not isinstance(tag, str) or not tag:
        error("The latest tuig release has no tag name.")
        return 1
    info(f"Installing tuig {tag} from GitHub.")
    return run_command(["bun", "install", "--global", f"{REPOSITORY}#{tag}"], check=False).returncode
