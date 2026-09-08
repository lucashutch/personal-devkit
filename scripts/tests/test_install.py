import pytest

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
