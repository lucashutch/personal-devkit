#!/usr/bin/env python3
"""Install personal development tools on Linux."""

from __future__ import annotations

import argparse
import platform
import sys
from dataclasses import dataclass, field
from pathlib import Path

from program_installers.common import (
    STATUS_SKIPPED,
    configure_logging,
    fail,
    info,
    prepend_existing_fzf_path,
)
from program_installers.fzf import install_fzf
from program_installers.npm import install_npm
from program_installers.opencode import install_opencode
from program_installers.opencode_desktop import install_opencode_desktop
from program_installers.starship import install_starship
from program_installers.vscode import install_vscode
from program_installers.wslu import install_wslu


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
            "Install personal dev tools on Linux. By default, all supported tools are selected.\n"
            "This installer installs tools only; it does not link or modify dotfiles/config."
        ),
        epilog=(
            "Behavior:\n"
            "  - Linux only; exits without changes on other operating systems.\n"
            "  - Idempotent by default; tools already found on PATH are skipped.\n"
            "  - Tool installers run noninteractively where supported."
        ),
        formatter_class=HelpFormatter,
        add_help=False,
    )
    options = parser.add_argument_group("Options")
    options.add_argument("--all", action="store_true", help="Select all tools (default when no tool flag is provided)")
    options.add_argument("--fzf", action="store_true", help="Select fzf")
    options.add_argument("--starship", action="store_true", help="Select starship")
    options.add_argument("--npm", action="store_true", help="Select npm and npx")
    options.add_argument("--opencode", action="store_true", help="Select OpenCode CLI and Desktop")
    options.add_argument("--vscode", action="store_true", help="Select Visual Studio Code")
    options.add_argument("--wslu", action="store_true", help="Select wslu (WSL only)")
    options.add_argument("--reinstall", action="store_true", help="Do not skip tools that are already available on PATH")
    options.add_argument("-h", "--help", action="store_true", help="Show this help text")
    return parser


def require_linux() -> int:
    if platform.system() != "Linux":
        return fail(f"{script_name()} supports Linux only.")
    return 0


@dataclass
class Options:
    reinstall: bool = False
    install_fzf: bool = False
    install_starship: bool = False
    install_npm: bool = False
    install_opencode: bool = False
    install_vscode: bool = False
    install_wslu: bool = False

    def select_all_tools(self) -> None:
        self.install_fzf = True
        self.install_starship = True
        self.install_npm = True
        self.install_opencode = True
        self.install_vscode = True
        self.install_wslu = True


@dataclass
class Summary:
    installed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)

    RESET = "\033[0m"
    BOLD = "\033[1m"
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    RED = "\033[31m"

    @staticmethod
    def join_tools(tools: list[str]) -> str:
        return ", ".join(tools) if tools else "none"

    @classmethod
    def line(cls, emoji: str, color: str, label: str, tools: list[str]) -> str:
        return f"{emoji} {color}{label}:{cls.RESET} {cls.join_tools(tools)}"

    def print(self) -> None:
        info("")
        info(f"{self.BOLD}{self.CYAN}📦 Installation summary{self.RESET}")
        info(self.line("✅", self.GREEN, "Installed", self.installed))
        info(self.line("⏭️", self.YELLOW, "Skipped", self.skipped))
        info(self.line("❌", self.RED, "Failed", self.failed))


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
    options = Options(reinstall=parsed.reinstall)
    if parsed.all:
        options.select_all_tools()
    options.install_fzf = options.install_fzf or parsed.fzf
    options.install_starship = options.install_starship or parsed.starship
    options.install_npm = options.install_npm or parsed.npm
    options.install_opencode = options.install_opencode or parsed.opencode
    options.install_vscode = options.install_vscode or parsed.vscode
    options.install_wslu = options.install_wslu or parsed.wslu

    selected_any = parsed.all or parsed.fzf or parsed.starship or parsed.npm or parsed.opencode or parsed.vscode or parsed.wslu
    if not selected_any:
        options.select_all_tools()
    return options


def run_tool(summary: Summary, tool: str, installer: object, options: Options) -> int:
    rc = installer(options)  # type: ignore[operator]
    if rc == 0:
        summary.installed.append(tool)
    elif rc == STATUS_SKIPPED:
        summary.skipped.append(tool)
    else:
        summary.failed.append(tool)
    return rc


def main(argv: list[str]) -> int:
    configure_logging()
    prepend_existing_fzf_path()

    parsed = parse_args(argv)
    if isinstance(parsed, int):
        return parsed

    linux_rc = require_linux()
    if linux_rc != 0:
        return linux_rc

    summary = Summary()
    if parsed.install_fzf:
        run_tool(summary, "fzf", install_fzf, parsed)
    if parsed.install_starship:
        run_tool(summary, "starship", install_starship, parsed)
    npm_rc = STATUS_SKIPPED
    if parsed.install_npm or parsed.install_opencode:
        npm_rc = run_tool(summary, "npm", install_npm, parsed)
    if parsed.install_opencode:
        if npm_rc in (0, STATUS_SKIPPED):
            run_tool(summary, "opencode CLI", install_opencode, parsed)
        else:
            summary.failed.append("opencode CLI")
        run_tool(summary, "OpenCode Desktop", install_opencode_desktop, parsed)
    if parsed.install_vscode:
        run_tool(summary, "vscode", install_vscode, parsed)
    if parsed.install_wslu:
        run_tool(summary, "wslu", install_wslu, parsed)

    summary.print()
    return 1 if summary.failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
