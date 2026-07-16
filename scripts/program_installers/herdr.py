"""Herdr installer."""

from __future__ import annotations

import subprocess

from program_installers.common import (
    STATUS_SKIPPED,
    command_exists,
    error,
    info,
    should_skip_tool,
    version_for,
)


def install_herdr(options: object) -> int:
    reinstall = bool(getattr(options, "reinstall"))
    if should_skip_tool("herdr", reinstall=reinstall):
        return STATUS_SKIPPED

    if not command_exists("curl"):
        error("curl is required to install herdr.")
        return 1

    info("Installing herdr using the official installer.")
    try:
        curl = subprocess.Popen(
            ["curl", "-fsSL", "https://herdr.dev/install.sh"],
            stdout=subprocess.PIPE,
        )
        sh = subprocess.Popen(["sh", "-s"], stdin=curl.stdout)
        if curl.stdout is not None:
            curl.stdout.close()
        sh_rc = sh.wait()
        curl_rc = curl.wait()
    except OSError:
        return 1
    if curl_rc != 0 or sh_rc != 0:
        return 1

    if not command_exists("herdr"):
        error("herdr installation completed, but herdr was not found on PATH.")
        return 1

    version = version_for("herdr")
    info(f"Installed herdr ({version})." if version else "Installed herdr.")
    return 0
