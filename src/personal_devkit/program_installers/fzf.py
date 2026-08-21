"""fzf installer."""

from __future__ import annotations

from pathlib import Path

from .common import (
    STATUS_SKIPPED,
    command_exists,
    error,
    force_symlink,
    fzf_supports_bash,
    info,
    refresh_fzf_path,
    run_command,
    version_for,
)


def install_fzf(options: object) -> int:
    if not options.reinstall and command_exists("fzf") and fzf_supports_bash():
        version = version_for("fzf")
        if version:
            info(f"Skipping fzf; already installed with current bash integration support ({version}).")
        else:
            info("Skipping fzf; already installed with current bash integration support.")
        return STATUS_SKIPPED

    if not command_exists("git"):
        error("git is required to install fzf from the upstream GitHub release path.")
        return 1

    home = Path.home()
    fzf_dir = home / ".fzf"
    fzf_git_dir = fzf_dir / ".git"

    info(f"Installing fzf from upstream GitHub into {home}/.fzf.")
    if fzf_git_dir.is_dir():
        if run_command(["git", "-C", str(fzf_dir), "pull", "--ff-only"], check=False).returncode != 0:
            return 1
    elif fzf_dir.exists():
        error(f"{home}/.fzf already exists and is not a git checkout; move it aside or rerun with a clean ~/.fzf.")
        return 1
    else:
        if run_command(
            ["git", "clone", "--depth", "1", "https://github.com/junegunn/fzf.git", str(fzf_dir)],
            check=False,
        ).returncode != 0:
            return 1

    if run_command([str(fzf_dir / "install"), "--bin", "--no-update-rc"], check=False).returncode != 0:
        return 1

    local_bin = home / ".local" / "bin"
    try:
        local_bin.mkdir(parents=True, exist_ok=True)
        force_symlink(fzf_dir / "bin" / "fzf", local_bin / "fzf")
        force_symlink(fzf_dir / "bin" / "fzf-tmux", local_bin / "fzf-tmux")
    except OSError:
        return 1
    info(f"Linked fzf into {home}/.local/bin.")

    refresh_fzf_path()

    if not command_exists("fzf"):
        error("fzf installation completed, but fzf was not found on PATH.")
        return 1

    if not fzf_supports_bash():
        error("fzf installed, but it still does not support 'fzf --bash'.")
        return 1

    version = version_for("fzf")
    if version:
        info(f"Installed fzf ({version}).")
    else:
        info("Installed fzf.")
    return 0
