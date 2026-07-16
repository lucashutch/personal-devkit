"""Shared installer primitives."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path


STATUS_SKIPPED = 10
SUPPORTED_TOOLS = ("fzf", "starship", "npm", "opencode", "herdr", "code")


class _MaxLevelFilter(logging.Filter):
    def __init__(self, max_level: int) -> None:
        super().__init__()
        self.max_level = max_level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno <= self.max_level


def configure_logging() -> None:
    logging.addLevelName(logging.WARNING, "WARN")
    logger = logging.getLogger("install")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    logger.handlers.clear()

    formatter = logging.Formatter("[%(levelname)s] %(message)s")

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.INFO)
    stdout_handler.addFilter(_MaxLevelFilter(logging.INFO))
    stdout_handler.setFormatter(formatter)

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.WARNING)
    stderr_handler.setFormatter(formatter)

    logger.addHandler(stdout_handler)
    logger.addHandler(stderr_handler)


def info(message: str) -> None:
    logging.getLogger("install").info(message)


def warn(message: str) -> None:
    logging.getLogger("install").warning(message)


def error(message: str) -> None:
    logging.getLogger("install").error(message)


def fail(message: str) -> int:
    error(message)
    return 1


def prepend_existing_fzf_path() -> None:
    fzf_bin = Path.home() / ".fzf" / "bin"
    if fzf_bin.is_dir():
        os.environ["PATH"] = f"{fzf_bin}{os.pathsep}{os.environ.get('PATH', '')}"


def command_path(command: str) -> str | None:
    return shutil.which(command)


def command_exists(command: str) -> bool:
    return command_path(command) is not None


def run_command(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, **kwargs)


def version_for(tool: str, *, timeout: int = 10) -> str:
    if tool not in SUPPORTED_TOOLS:
        return ""
    try:
        result = run_command(
            [tool, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError, subprocess.TimeoutExpired):
        return ""
    return (result.stdout or "").splitlines()[0] if result.stdout else ""


def should_skip_tool(
    tool: str,
    *,
    reinstall: bool,
    display_name: str | None = None,
    include_version: bool = True,
    version_timeout: int = 10,
) -> bool:
    if not reinstall and command_exists(tool):
        name = display_name or tool
        version = version_for(tool, timeout=version_timeout) if include_version else ""
        if version:
            info(f"Skipping {name}; already installed ({version}).")
        else:
            info(f"Skipping {name}; already installed.")
        return True
    return False


def fzf_supports_bash() -> bool:
    try:
        result = run_command(
            ["fzf", "--bash"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def refresh_fzf_path() -> None:
    home = Path.home()
    os.environ["PATH"] = (
        f"{home / '.fzf' / 'bin'}{os.pathsep}"
        f"{home / '.local' / 'bin'}{os.pathsep}"
        f"{os.environ.get('PATH', '')}"
    )


def force_symlink(source: Path, target: Path) -> None:
    try:
        target.unlink()
    except FileNotFoundError:
        pass
    target.symlink_to(source)
