"""opencode installer."""

from __future__ import annotations

from program_installers.common import (
    STATUS_SKIPPED,
    command_exists,
    error,
    info,
    run_command,
    should_skip_tool,
    version_for,
)


def install_opencode(options: object) -> int:
    if should_skip_tool("opencode", reinstall=options.reinstall):  # type: ignore[attr-defined]
        return STATUS_SKIPPED

    if not command_exists("npm"):
        error("npm is required to install opencode. Install npm or put opencode on PATH and rerun.")
        return 1

    info("Installing OpenCode V2 next with npm.")
    result = run_command(
        ["npm", "install", "--global", "@opencode-ai/cli@next"], check=False
    )
    if result.returncode != 0:
        return 1

    if not command_exists("opencode"):
        error("opencode installation completed, but opencode was not found on PATH.")
        return 1

    version = version_for("opencode")
    if version:
        info(f"Installed opencode ({version}).")
    else:
        info("Installed opencode.")
    return 0
