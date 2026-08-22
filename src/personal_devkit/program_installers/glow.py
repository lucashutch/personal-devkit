"""glow installer."""

from __future__ import annotations

from .common import STATUS_SKIPPED, should_skip_tool
from .github_release import install_release_tarball

ARCHITECTURES = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "arm64", "arm64": "arm64"}


def install_glow(options: object) -> int:
    if should_skip_tool("glow", reinstall=options.reinstall):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    return install_release_tarball(
        repo="charmbracelet/glow",
        binary="glow",
        asset_for=lambda version, architecture: f"glow_{version}_Linux_{architecture}.tar.gz",
        architectures=ARCHITECTURES,
    )
