#!/usr/bin/env python3
"""Link repo-managed OpenCode, Claude Code, Herdr, and desktop configuration."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from program_installers.common import configure_logging, fail, info


OPENCODE_V2_PROFILES = ("home", "work", "test")
OPENCODE_V2_SHARED_ENTRIES = ("cli.json", "agents")
OPENCODE_V2_SERVICE_PORTS = {"home": 4098, "work": 4097, "test": 4099}

OPENCODE_V1_PROFILES = ("home", "work", "test")
OPENCODE_DESKTOP_ENTRIES = (
    "opencode-home.desktop.in",
    "opencode-work.desktop.in",
    "ai.opencode.desktop.desktop.in",
)

# Every V1 profile has a complete global config, while these repo-managed
# assets remain shared between profiles.
OPENCODE_V1_SHARED_ENTRIES = (
    "tui.json",
    "commands",
    "agents",
    "plugins",
    "skills",
)

CLAUDE_ENTRIES = (
    "settings.json",
    "keybindings.json",
    "statusline-command.sh",
    "commands",
    "agents",
    "skills",
    "themes",
    "hooks",
)

HERDR_ENTRIES = ("config.toml",)

DOTFILES_ENTRIES = (
    "starship.toml",
    "ghostty",
    "bashrc.d",
)


def script_name() -> str:
    return Path(sys.argv[0]).name


class HelpFormatter(argparse.RawTextHelpFormatter):
    def format_help(self) -> str:
        return super().format_help().replace("usage:", "Usage:", 1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=script_name(),
        usage="%(prog)s [OPTIONS]",
        description=(
            "Link repo-managed config into ~/.config. By default, OpenCode config is selected."
        ),
        epilog=(
            "Behavior:\n"
            "  - Default target is OpenCode config when no target flag is provided.\n"
            "  - Existing matching symlinks are reported as already linked.\n"
            "  - Use --force to replace existing files, directories, or mismatched symlinks."
        ),
        formatter_class=HelpFormatter,
        add_help=False,
    )
    options = parser.add_argument_group("Options")
    options.add_argument("-o", "--opencode", action="store_true", help="Link OpenCode config")
    options.add_argument("-c", "--claude", action="store_true", help="Link Claude Code config")
    options.add_argument("--herdr", action="store_true", help="Link Herdr config")
    options.add_argument("-d", "--dotfiles", action="store_true", help="Link dotfiles config")
    options.add_argument("-a", "--all", action="store_true", help="Link OpenCode, Claude Code, Herdr, and dotfiles config")
    options.add_argument("--force", action="store_true", help="Replace existing files/directories/symlinks")
    options.add_argument("--help", action="store_true", help="Show this help text")
    return parser


@dataclass
class Options:
    force: bool = False
    link_opencode: bool = False
    link_claude: bool = False
    link_herdr: bool = False
    link_dotfiles: bool = False

    def select_default(self) -> None:
        if not self.link_opencode and not self.link_claude and not self.link_herdr and not self.link_dotfiles:
            self.link_opencode = True


@dataclass
class Summary:
    worked: list[tuple[str, str]] = field(default_factory=list)
    errored: list[str] = field(default_factory=list)

    RESET = "\033[0m"
    BOLD = "\033[1m"
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    RED = "\033[31m"

    @staticmethod
    def join_items(items: list[str]) -> str:
        return ", ".join(items) if items else "none"

    @classmethod
    def colored_item(cls, kind: str, text: str) -> str:
        color = cls.BLUE if kind == "already linked" else cls.GREEN
        return f"{color}{text}{cls.RESET}"

    @classmethod
    def line(cls, emoji: str, color: str, label: str, items: list[str]) -> str:
        return f"{emoji} {color}{label}:{cls.RESET} {cls.join_items(items)}"

    @classmethod
    def worked_header(cls) -> str:
        return (
            f"{cls.GREEN}newly linked{cls.RESET} / "
            f"{cls.BLUE}already linked{cls.RESET}"
        )

    def print(self) -> None:
        info("")
        info(f"{self.BOLD}{self.CYAN}🔗 Link summary{self.RESET}")
        info(f"✅ {self.GREEN}Worked:{self.RESET} {self.worked_header()}")
        for kind, item in self.worked:
            info(f"  - {self.colored_item(kind, item)}")
        info(self.line("❌", self.RED, "Errored", self.errored))
        if not self.errored:
            info("🎉 All selected config symlinks are correct.")


def parse_args(argv: list[str]) -> Options | int:
    parser = build_parser()
    known_options = {option for action in parser._actions for option in action.option_strings}
    for arg in argv:
        if arg in ("-h", "--help"):
            parser.print_help(sys.stdout)
            return 0
        if arg not in known_options:
            parser.print_help(sys.stderr)
            return fail(f"Unknown option: {arg}")

    parsed = parser.parse_args(argv)
    options = Options(force=parsed.force)
    if parsed.all:
        options.link_opencode = True
        options.link_claude = True
        options.link_herdr = True
        options.link_dotfiles = True
    options.link_opencode = options.link_opencode or parsed.opencode
    options.link_claude = options.link_claude or parsed.claude
    options.link_herdr = options.link_herdr or parsed.herdr
    options.link_dotfiles = options.link_dotfiles or parsed.dotfiles
    options.select_default()
    return options


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def config_home() -> Path:
    raw = os.environ.get("XDG_CONFIG_HOME")
    home = Path(raw).expanduser() if raw else Path.home() / ".config"
    if home.name in {
        "opencode-v1-home",
        "opencode-v1-work",
        "opencode-v1-test",
        "opencode-v2-home",
        "opencode-v2-work",
        "opencode-v2-test",
    }:
        return home.parent
    return home


def xdg_home(variable: str, default: Path) -> Path:
    """Return an unprofiled XDG base directory."""
    home = Path(os.environ.get(variable, str(default))).expanduser()
    if home.name in {
        "opencode-v1-home",
        "opencode-v1-work",
        "opencode-v1-test",
        "opencode-v2-home",
        "opencode-v2-work",
        "opencode-v2-test",
    }:
        return home.parent
    return home


def profile_xdg_root(variable: str, default: Path, profile: str) -> Path:
    """Return a V2 profile root without nesting an existing profile suffix."""
    root = Path(os.environ.get(variable, str(default))).expanduser()
    if root.name in {
        "opencode-v1-home",
        "opencode-v1-work",
        "opencode-v1-test",
        "opencode-v2-home",
        "opencode-v2-work",
        "opencode-v2-test",
    }:
        root = root.parent
    return root / f"opencode-v2-{profile}"


def configure_v2_services(summary: Summary) -> None:
    """Write fixed, profile-local service endpoints through the V2 CLI."""
    executable = shutil.which("opencode2")
    if not executable:
        info("skipped V2 service configuration: opencode2 is not on PATH")
        return

    defaults = {
        "XDG_CONFIG_HOME": Path.home() / ".config",
        "XDG_DATA_HOME": Path.home() / ".local" / "share",
        "XDG_STATE_HOME": Path.home() / ".local" / "state",
        "XDG_CACHE_HOME": Path.home() / ".cache",
    }
    for profile, port in OPENCODE_V2_SERVICE_PORTS.items():
        environment = os.environ.copy()
        environment.update(
            {
                variable: str(profile_xdg_root(variable, default, profile))
                for variable, default in defaults.items()
            }
        )
        label = f"opencode-v2-{profile}/service"
        for key, value in (("hostname", "127.0.0.1"), ("port", str(port))):
            result = subprocess.run(
                [executable, "service", "set", key, value],
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode:
                detail = result.stderr.strip() or result.stdout.strip() or "command failed"
                record_error(summary, label, f"could not set {key}: {detail}")
                break
        else:
            info(f"configured: {label} -> 127.0.0.1:{port}")
            summary.worked.append(("newly linked", label))


def record_error(summary: Summary, label: str, message: str) -> None:
    fail(message)
    summary.errored.append(f"{label} ({message})")


def remove_existing(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    for child in path.iterdir():
        if child.is_dir() and not child.is_symlink():
            remove_existing(child)
        else:
            child.unlink()
    path.rmdir()


def link_entries(
    summary: Summary,
    *,
    label: str,
    source_dir: Path,
    target_dir: Path,
    entries: tuple[str, ...],
    force: bool,
) -> None:
    if not source_dir.is_dir():
        record_error(summary, label, f"missing source directory: {source_dir}")
        return

    target_dir.mkdir(parents=True, exist_ok=True)

    for entry in entries:
        src = source_dir / entry
        dst = target_dir / entry
        item_label = f"{label}/{entry}"

        if not src.exists():
            record_error(summary, item_label, f"missing source: {src}")
            continue

        if dst.is_symlink():
            current = dst.resolve(strict=False)
            if current == src:
                info(f"ok: {dst} -> {src}")
                summary.worked.append(("already linked", item_label))
                continue
            if not force:
                record_error(
                    summary,
                    item_label,
                    f"{dst} is already a symlink to {os.readlink(dst)} (use --force to replace)",
                )
                continue
            dst.unlink()
        elif dst.exists():
            if not force:
                record_error(
                    summary,
                    item_label,
                    f"{dst} already exists and is not a symlink (use --force to replace)",
                )
                continue
            remove_existing(dst)

        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.symlink_to(src)
        except OSError:
            record_error(summary, item_label, f"failed to link {dst} -> {src}")
            continue

        info(f"linked: {dst} -> {src}")
        summary.worked.append(("newly linked", item_label))


def install_desktop_entries(summary: Summary, *, root: Path, force: bool) -> None:
    """Install profile launchers and their icons into the user's XDG data tree."""
    config = config_home()
    data = xdg_home("XDG_DATA_HOME", Path.home() / ".local" / "share")
    state = xdg_home("XDG_STATE_HOME", Path.home() / ".local" / "state")
    cache = xdg_home("XDG_CACHE_HOME", Path.home() / ".cache")
    source_dir = root / "desktop"
    applications = data / "applications"
    replacements = {
        "@XDG_CONFIG_HOME@": str(config),
        "@XDG_DATA_HOME@": str(data),
        "@XDG_STATE_HOME@": str(state),
        "@XDG_CACHE_HOME@": str(cache),
        "@ICON_HOME@": str(data / "icons" / "hicolor" / "scalable" / "apps"),
    }

    for template_name in OPENCODE_DESKTOP_ENTRIES:
        src = source_dir / template_name
        name = template_name.removesuffix(".in")
        dst = applications / name
        label = f"opencode-desktop/{name}"
        if not src.is_file():
            record_error(summary, label, f"missing source: {src}")
            continue
        content = src.read_text()
        for token, value in replacements.items():
            content = content.replace(token, value)
        if dst.exists() or dst.is_symlink():
            if dst.is_file() and not dst.is_symlink() and dst.read_text() == content:
                summary.worked.append(("already linked", label))
                continue
            if not force:
                record_error(summary, label, f"{dst} already exists (use --force to replace)")
                continue
            remove_existing(dst)
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(content)
        info(f"installed: {dst}")
        summary.worked.append(("newly linked", label))

    link_entries(
        summary,
        label="opencode-desktop-icons",
        source_dir=source_dir / "icons",
        target_dir=data / "icons" / "hicolor" / "scalable" / "apps",
        entries=("opencode-home.png", "opencode-work.png"),
        force=force,
    )
    # These were the first, generic profile icons. Remove only the symlinks we
    # previously managed; never remove a user's own icon file.
    for name in ("opencode-home.svg", "opencode-work.svg"):
        legacy = data / "icons" / "hicolor" / "scalable" / "apps" / name
        source = source_dir / "icons" / name
        if legacy.is_symlink() and legacy.resolve(strict=False) == source:
            legacy.unlink()
            info(f"removed obsolete icon: {legacy}")


def main(argv: list[str]) -> int:
    configure_logging()

    parsed = parse_args(argv)
    if isinstance(parsed, int):
        return parsed

    summary = Summary()
    root = repo_root()
    home = config_home()

    if parsed.link_opencode:
        for profile in OPENCODE_V2_PROFILES:
            target_dir = home / f"opencode-v2-{profile}" / "opencode"
            source_dir = root / "opencode" / "v2" / profile
            link_entries(
                summary,
                label=f"opencode-v2-{profile}",
                source_dir=source_dir,
                target_dir=target_dir,
                entries=("opencode.json",),
                force=parsed.force,
            )
            if (source_dir / "plugins").is_dir():
                link_entries(
                    summary,
                    label=f"opencode-v2-{profile}",
                    source_dir=source_dir,
                    target_dir=target_dir,
                    entries=("plugins",),
                    force=parsed.force,
                )
            link_entries(
                summary,
                label=f"opencode-v2-{profile}",
                source_dir=root / "opencode" / "v2" / "shared",
                target_dir=target_dir,
                entries=OPENCODE_V2_SHARED_ENTRIES,
                force=parsed.force,
            )
            link_entries(
                summary,
                label=f"opencode-v2-{profile}",
                source_dir=root / "opencode" / "v2",
                target_dir=target_dir,
                entries=("shared",),
                force=parsed.force,
            )
        for profile in OPENCODE_V1_PROFILES:
            target_dir = home / f"opencode-v1-{profile}" / "opencode"
            link_entries(
                summary,
                label=f"opencode-v1-{profile}",
                source_dir=root / "opencode" / "v1" / profile,
                target_dir=target_dir,
                entries=("opencode.json",),
                force=parsed.force,
            )
            link_entries(
                summary,
                label=f"opencode-v1-{profile}",
                source_dir=root / "opencode" / "v1" / "shared",
                target_dir=target_dir,
                entries=OPENCODE_V1_SHARED_ENTRIES,
                force=parsed.force,
            )
        install_desktop_entries(summary, root=root, force=parsed.force)
        if not summary.errored:
            configure_v2_services(summary)

    if parsed.link_claude:
        link_entries(
            summary,
            label="claude",
            source_dir=root / "claude",
            target_dir=Path.home() / ".claude",
            entries=CLAUDE_ENTRIES,
            force=parsed.force,
        )

    if parsed.link_herdr:
        link_entries(
            summary,
            label="herdr",
            source_dir=root / "herdr",
            target_dir=config_home() / "herdr",
            entries=HERDR_ENTRIES,
            force=parsed.force,
        )

    if parsed.link_dotfiles:
        link_entries(
            summary,
            label="dotfiles",
            source_dir=root / "dotfiles",
            target_dir=home,
            entries=DOTFILES_ENTRIES,
            force=parsed.force,
        )

    summary.print()
    return 1 if summary.errored else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
