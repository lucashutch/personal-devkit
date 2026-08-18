"""Claude Code installer."""

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

INSTALL_URL = "https://claude.ai/install.sh"
CHANNEL = "stable"


def install_claude(options: object) -> int:
    reinstall = bool(getattr(options, "reinstall"))
    if should_skip_tool("claude", reinstall=reinstall, display_name="Claude Code"):
        return STATUS_SKIPPED

    if not command_exists("curl"):
        error("curl is required to install Claude Code.")
        return 1

    info("Installing Claude Code using the official native installer.")
    try:
        curl = subprocess.Popen(["curl", "-fsSL", INSTALL_URL], stdout=subprocess.PIPE)
        shell = subprocess.Popen(["bash", "-s", CHANNEL], stdin=curl.stdout)
        if curl.stdout is not None:
            curl.stdout.close()
        shell_rc = shell.wait()
        curl_rc = curl.wait()
    except OSError:
        return 1
    if curl_rc != 0 or shell_rc != 0:
        return 1

    if not command_exists("claude"):
        error("Claude Code installation completed, but claude was not found on PATH.")
        return 1

    version = version_for("claude")
    info(f"Installed Claude Code ({version})." if version else "Installed Claude Code.")
    return 0
