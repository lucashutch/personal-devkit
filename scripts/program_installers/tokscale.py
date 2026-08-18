"""tokscale installer."""

from __future__ import annotations

from program_installers.common import STATUS_SKIPPED, should_skip_tool
from program_installers.node import npm_global_install


def install_tokscale(options: object) -> int:
    if should_skip_tool("tokscale", reinstall=options.reinstall):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    return npm_global_install("tokscale", "tokscale", "tokscale")
