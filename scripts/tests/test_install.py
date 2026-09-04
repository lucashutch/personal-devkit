from personal_devkit.install import Options, parse_args


def test_default_selection_excludes_vscode() -> None:
    options = parse_args([])

    assert isinstance(options, Options)
    assert options.install_opencode
    assert not options.install_vscode


def test_all_selection_includes_vscode() -> None:
    options = parse_args(["--all"])

    assert isinstance(options, Options)
    assert options.install_vscode


def test_vscode_can_be_selected_explicitly() -> None:
    options = parse_args(["--vscode"])

    assert isinstance(options, Options)
    assert options.install_vscode
    assert not options.install_opencode
