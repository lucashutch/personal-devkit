import pytest

from personal_devkit import install
from personal_devkit.install import parse_args


def test_default_selection_excludes_desktop_apps() -> None:
    options = parse_args([])

    assert options.install_opencode
    assert not options.install_opencode_desktop
    assert not options.install_vscode


def test_all_selection_includes_desktop_apps() -> None:
    options = parse_args(["--all"])

    assert options.install_opencode_desktop
    assert options.install_vscode


@pytest.mark.parametrize("flag, attribute", [
    ("--vscode", "install_vscode"),
    ("--opencode-desktop", "install_opencode_desktop"),
    ("--druk", "install_druk"),
])
def test_explicit_selection_excludes_default_tools(flag: str, attribute: str) -> None:
    options = parse_args([flag])

    assert getattr(options, attribute)
    assert not options.install_opencode


def test_npm_tool_does_not_reinstall_node(monkeypatch: pytest.MonkeyPatch) -> None:
    """--reinstall of an npm-backed tool must not replace the global node_modules."""
    seen: list[bool] = []
    monkeypatch.setattr(install, "install_node", lambda options: seen.append(options.reinstall) or 0)
    monkeypatch.setattr(install, "install_tokscale", lambda options: 0)
    monkeypatch.setattr(install, "warn_orphaned_node_links", list)

    install.main(["--tokscale", "--reinstall"])

    assert seen == [False]


def test_selecting_node_still_honours_reinstall(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[bool] = []
    monkeypatch.setattr(install, "install_node", lambda options: seen.append(options.reinstall) or 0)
    monkeypatch.setattr(install, "warn_orphaned_node_links", list)

    install.main(["--node", "--reinstall"])

    assert seen == [True]
