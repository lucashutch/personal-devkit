"""opencode installer."""

from __future__ import annotations

from .common import STATUS_SKIPPED, should_skip_tool
from .node import npm_global_install

# OpenCode 2 moved off the `@opencode-ai` scope and off the beta channel; the
# package still ships an `opencode2` bin alias, which nothing here relies on.
PACKAGE = "@opencode/cli"
BINARY = "opencode"


def install_opencode(options: object) -> int:
    if should_skip_tool(BINARY, reinstall=options.reinstall, display_name="opencode"):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    return npm_global_install(PACKAGE, BINARY, "OpenCode")
