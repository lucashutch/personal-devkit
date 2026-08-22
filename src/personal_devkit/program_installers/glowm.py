"""glowm installer."""

from __future__ import annotations

from .common import STATUS_SKIPPED, should_skip_tool
from .github_release import install_release_tarball

ARCHITECTURES = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}


def install_glowm(options: object) -> int:
    if should_skip_tool("glowm", reinstall=options.reinstall):  # type: ignore[attr-defined]
        return STATUS_SKIPPED
    return install_release_tarball(
        repo="atani/glowm",
        binary="glowm",
        asset_for=lambda version, architecture: f"glowm_{version}_linux_{architecture}.tar.gz",
        architectures=ARCHITECTURES,
    )
