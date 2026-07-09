#!/usr/bin/env python3
"""Link repo-managed config into ~/.config."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from program_installers.common import configure_logging, fail, info


OPENCODE_ENTRIES = (
    "home.json",
    "work.json",
    "opencode.json",
    "tui.json",
    "commands",
    "plugins",
    "agents",
    "skills",
)

CLAUDE_ENTRIES = (
    "settings.json",
    "keybindings.json",
    "statusline-command.sh",
    "commands",
    "agents",
    "skills",
)

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
    options.add_argument("-d", "--dotfiles", action="store_true", help="Link dotfiles config")
    options.add_argument("-a", "--all", action="store_true", help="Link OpenCode, Claude Code, and dotfiles config")
    options.add_argument("--force", action="store_true", help="Replace existing files/directories/symlinks")
    options.add_argument("-h", "--help", action="store_true", help="Show this help text")
    return parser


@dataclass
class Options:
    force: bool = False
    link_opencode: bool = False
    link_claude: bool = False
    link_dotfiles: bool = False

    def select_default(self) -> None:
        if not self.link_opencode and not self.link_claude and not self.link_dotfiles:
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
        options.link_dotfiles = True
    options.link_opencode = options.link_opencode or parsed.opencode
    options.link_claude = options.link_claude or parsed.claude
    options.link_dotfiles = options.link_dotfiles or parsed.dotfiles
    options.select_default()
    return options


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def config_home() -> Path:
    raw = os.environ.get("XDG_CONFIG_HOME")
    return Path(raw).expanduser() if raw else Path.home() / ".config"


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


def main(argv: list[str]) -> int:
    configure_logging()

    parsed = parse_args(argv)
    if isinstance(parsed, int):
        return parsed

    summary = Summary()
    root = repo_root()
    home = config_home()

    if parsed.link_opencode:
        link_entries(
            summary,
            label="opencode",
            source_dir=root / "opencode",
            target_dir=home / "opencode",
            entries=OPENCODE_ENTRIES,
            force=parsed.force,
        )

    if parsed.link_claude:
        link_entries(
            summary,
            label="claude",
            source_dir=root / "claude",
            target_dir=Path.home() / ".claude",
            entries=CLAUDE_ENTRIES,
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
