"""opencode installer."""

from __future__ import annotations

from .common import STATUS_SKIPPED, should_skip_tool
from .node import npm_global_install

# @opencode-ai/cli ships its bin as opencode2; the shell wrappers expose it as opencode/oc.
PACKAGE = "@opencode-ai/cli@beta"
BINARY = "opencode2"


def install_opencode(options: object) -> int:
    if should_skip_tool(BINARY, reinstall=options.reinstall, display_name="opencode"):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    return npm_global_install(PACKAGE, BINARY, "OpenCode V2 beta")
