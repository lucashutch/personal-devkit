"""Codex CLI installer."""

from __future__ import annotations

from .common import STATUS_SKIPPED, should_skip_tool
from .node import npm_global_install


def install_codex(options: object) -> int:
    if should_skip_tool("codex", reinstall=options.reinstall):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    return npm_global_install("@openai/codex", "codex", "Codex CLI")
