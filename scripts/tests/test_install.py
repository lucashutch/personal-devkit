from personal_devkit.install import Options, parse_args


def test_default_selection_excludes_desktop_apps() -> None:
    options = parse_args([])

    assert isinstance(options, Options)
    assert options.install_opencode
    assert not options.install_opencode_desktop
    assert not options.install_vscode


def test_all_selection_includes_desktop_apps() -> None:
    options = parse_args(["--all"])

    assert isinstance(options, Options)
    assert options.install_opencode_desktop
    assert options.install_vscode


def test_vscode_can_be_selected_explicitly() -> None:
    options = parse_args(["--vscode"])

    assert isinstance(options, Options)
    assert options.install_vscode
    assert not options.install_opencode


def test_opencode_desktop_can_be_selected_without_cli() -> None:
    options = parse_args(["--opencode-desktop"])

    assert isinstance(options, Options)
    assert options.install_opencode_desktop
    assert not options.install_opencode


def test_druk_is_a_default_tool() -> None:
    options = parse_args([])

    assert isinstance(options, Options)
    assert options.install_druk


def test_druk_can_be_selected_explicitly() -> None:
    options = parse_args(["--druk"])

    assert isinstance(options, Options)
    assert options.install_druk
    assert not options.install_opencode
