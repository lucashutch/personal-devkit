"""Bun installer."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .common import (
    STATUS_SKIPPED,
    command_exists,
    error,
    info,
    should_skip_tool,
    version_for,
)

INSTALL_URL = "https://bun.com/install"


def install_bun(options: object) -> int:
    reinstall = bool(options.reinstall)
    if should_skip_tool("bun", reinstall=reinstall):
        return STATUS_SKIPPED

    if not command_exists("curl"):
        error("curl is required to install bun.")
        return 1

    info("Installing bun using the official installer.")
    try:
        curl = subprocess.Popen(["curl", "-fsSL", INSTALL_URL], stdout=subprocess.PIPE)
        shell = subprocess.Popen(["bash"], stdin=curl.stdout)
        if curl.stdout is not None:
            curl.stdout.close()
        shell_rc = shell.wait()
        curl_rc = curl.wait()
    except OSError:
        return 1
    if curl_rc != 0 or shell_rc != 0:
        return 1

    # The installer writes shell rc exports we do not source; add its bin for this run.
    os.environ["PATH"] = f"{Path.home() / '.bun' / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"
    if not command_exists("bun"):
        error("bun installation completed, but bun was not found on PATH.")
        return 1

    version = version_for("bun")
    info(f"Installed bun ({version})." if version else "Installed bun.")
    return 0
