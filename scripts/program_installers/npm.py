"""Node.js npm installer."""

from __future__ import annotations

import os

from program_installers.common import STATUS_SKIPPED, command_exists, error, info, run_command, should_skip_tool, version_for


def _sudo_command(command: list[str]) -> list[str]:
    if os.geteuid() == 0:
        return command
    return ["sudo", *command]


def install_npm(options: object) -> int:
    reinstall = bool(getattr(options, "reinstall"))
    if not reinstall and command_exists("npm") and command_exists("npx"):
        # Use the shared helper for consistent skip logging and version output.
        should_skip_tool("npm", reinstall=False)
        return STATUS_SKIPPED

    required = ["apt-get"]
    if os.geteuid() != 0:
        required.append("sudo")
    missing = [command for command in required if not command_exists(command)]
    if missing:
        error(f"Cannot install npm; missing required command(s): {', '.join(missing)}.")
        return 1

    info("Installing npm and Node.js from the system apt repository.")
    if run_command(_sudo_command(["apt-get", "update"]), check=False).returncode != 0:
        error("Failed to update apt package lists before installing npm.")
        return 1
    if run_command(_sudo_command(["apt-get", "install", "-y", "npm"]), check=False).returncode != 0:
        error("Failed to install npm.")
        return 1

    if not command_exists("npm") or not command_exists("npx"):
        error("npm installation completed, but npm and npx were not both found on PATH.")
        return 1

    version = version_for("npm")
    if version:
        info(f"Installed npm ({version}) and npx.")
    else:
        info("Installed npm and npx.")
    return 0
