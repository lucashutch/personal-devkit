"""Visual Studio Code installer."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from .common import (
    STATUS_SKIPPED,
    command_exists,
    error,
    info,
    run_command,
    should_skip_tool,
)


def _code_version(timeout: int = 2) -> str:
    try:
        result = run_command(
            ["code", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError, subprocess.TimeoutExpired):
        return ""
    return (result.stdout or "").splitlines()[0] if result.stdout else ""


def _sudo_command(command: list[str]) -> list[str]:
    if os.geteuid() == 0:
        return command
    return ["sudo", *command]


def _require_commands(commands: list[str]) -> bool:
    missing = [command for command in commands if not command_exists(command)]
    if not missing:
        return True
    error(
        "Cannot install Visual Studio Code; missing required command(s): "
        f"{', '.join(missing)}. Install them and rerun."
    )
    return False


def _verify_code() -> bool:
    if not command_exists("code"):
        error("Visual Studio Code installation completed, but code was not found on PATH.")
        return False
    version = _code_version()
    if version:
        info(f"Installed Visual Studio Code ({version}).")
    else:
        info("Installed Visual Studio Code.")
    return True


def install_vscode(options: object) -> int:
    reinstall = bool(options.reinstall)
    if should_skip_tool(
        "code",
        reinstall=reinstall,
        display_name="Visual Studio Code",
        include_version=False,
    ):
        return STATUS_SKIPPED

    required_commands = ["apt-get", "wget", "gpg", "install", "tee"]
    if os.geteuid() != 0:
        required_commands.append("sudo")
    if not _require_commands(required_commands):
        return 1

    info("Installing Visual Studio Code from Microsoft's official apt repository.")

    prereq_install = _sudo_command(["apt-get", "install", "-y", "apt-transport-https"])
    if run_command(prereq_install, check=False).returncode != 0:
        error("Failed to install apt prerequisite package: apt-transport-https.")
        return 1

    key_fetch = run_command(
        ["wget", "-qO-", "https://packages.microsoft.com/keys/microsoft.asc"],
        stdout=subprocess.PIPE,
        check=False,
    )
    if key_fetch.returncode != 0 or not key_fetch.stdout:
        error("Failed to download Microsoft's apt repository signing key.")
        return 1

    with tempfile.TemporaryDirectory() as temp_dir:
        key_asc = Path(temp_dir) / "microsoft.asc"
        key_gpg = Path(temp_dir) / "packages.microsoft.gpg"
        try:
            key_asc.write_text(key_fetch.stdout)
        except OSError:
            error("Failed to write Microsoft's apt repository signing key to a temporary file.")
            return 1

        try:
            dearmor = run_command(
                ["gpg", "--dearmor", "--yes", "--output", str(key_gpg), str(key_asc)],
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            error("Failed to convert Microsoft's apt repository signing key.")
            return 1
        if dearmor.returncode != 0 or not key_gpg.is_file():
            error("Failed to convert Microsoft's apt repository signing key.")
            return 1

        install_key = run_command(
            _sudo_command(
                [
                    "install",
                    "-D",
                    "-o",
                    "root",
                    "-g",
                    "root",
                    "-m",
                    "644",
                    str(key_gpg),
                    "/etc/apt/keyrings/packages.microsoft.gpg",
                ]
            ),
            check=False,
        )
        if install_key.returncode != 0:
            error("Failed to install Microsoft's apt repository signing key.")
            return 1

    repo_line = (
        "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] "
        "https://packages.microsoft.com/repos/code stable main\n"
    )
    add_repo = run_command(
        _sudo_command(["tee", "/etc/apt/sources.list.d/vscode.list"]),
        input=repo_line,
        stdout=subprocess.DEVNULL,
        check=False,
    )
    if add_repo.returncode != 0:
        error("Failed to add Microsoft's Visual Studio Code apt repository.")
        return 1

    if run_command(_sudo_command(["apt-get", "update"]), check=False).returncode != 0:
        error("Failed to update apt package lists after adding Microsoft's repository.")
        return 1

    if run_command(_sudo_command(["apt-get", "install", "-y", "code"]), check=False).returncode != 0:
        error("Failed to install Visual Studio Code package: code.")
        return 1

    return 0 if _verify_code() else 1
