"""wslu installer — only meaningful inside WSL."""

from __future__ import annotations

import os

from .common import (
    STATUS_SKIPPED,
    command_exists,
    error,
    info,
    run_command,
    should_skip_tool,
)


def _is_wsl() -> bool:
    """Return True when running inside Windows Subsystem for Linux."""
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        return "microsoft" in open("/proc/version").read().lower()
    except OSError:
        return False


def install_wslu(options: object) -> int:
    if not _is_wsl():
        info("Skipping wslu; not running inside WSL.")
        return STATUS_SKIPPED

    reinstall = bool(options.reinstall)
    if should_skip_tool("wslview", reinstall=reinstall, display_name="wslu"):
        return STATUS_SKIPPED

    if not command_exists("apt-get"):
        error("wslu requires apt-get; cannot install on this system.")
        return 1

    info("Installing wslu via apt.")

    sudo_prefix: list[str] = [] if os.geteuid() == 0 else ["sudo"]

    if run_command(
        sudo_prefix + ["apt-get", "install", "-y", "wslu"],
        check=False,
    ).returncode != 0:
        error("Failed to install wslu via apt-get.")
        return 1

    if not command_exists("wslview"):
        error("wslu installation completed, but wslview was not found on PATH.")
        return 1

    info("Installed wslu.")
    return 0
