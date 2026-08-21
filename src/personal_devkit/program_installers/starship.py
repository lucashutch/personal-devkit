"""Starship installer."""

from __future__ import annotations

import subprocess

from .common import (
    STATUS_SKIPPED,
    command_exists,
    error,
    info,
    should_skip_tool,
    version_for,
)


def install_starship(options: object) -> int:
    reinstall = bool(options.reinstall)
    if should_skip_tool("starship", reinstall=reinstall):
        return STATUS_SKIPPED

    if not command_exists("curl"):
        error("curl is required to install starship.")
        return 1

    info("Installing starship using the official noninteractive installer.")
    try:
        curl = subprocess.Popen(
            ["curl", "-sS", "https://starship.rs/install.sh"],
            stdout=subprocess.PIPE,
        )
        sh = subprocess.Popen(["sh", "-s", "--", "-y"], stdin=curl.stdout)
        if curl.stdout is not None:
            curl.stdout.close()
        sh_rc = sh.wait()
        curl_rc = curl.wait()
    except OSError:
        return 1
    if curl_rc != 0 or sh_rc != 0:
        return 1

    if not command_exists("starship"):
        error("starship installation completed, but starship was not found on PATH.")
        return 1

    version = version_for("starship")
    if version:
        info(f"Installed starship ({version}).")
    else:
        info("Installed starship.")
    return 0
