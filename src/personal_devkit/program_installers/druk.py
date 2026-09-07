"""druk installer."""

from __future__ import annotations

from .common import STATUS_SKIPPED, should_skip_tool
from .node import npm_global_install


def install_druk(options: object) -> int:
    if should_skip_tool("druk", reinstall=options.reinstall):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    return npm_global_install("druk", "druk", "druk")
