# Installing tools

`pdkinstall` is a noninteractive, idempotent Linux-only Python 3.11+ installer. It installs tools but does not link configuration or change managed dotfiles.

```sh
uv run pdkinstall --help
uv run pdkinstall                    # all supported tools
uv run pdkinstall --opencode --claude
uv run pdkinstall --node
uv run pdkinstall --all --reinstall
```

Supported selections are `--fzf`, `--starship`, `--node`, `--bun`, `--opencode`, `--claude`, `--codex`, `--tokscale`, `--ghui`, `--herdr`, and `--vscode`. With no selection, or with `--all`, every supported tool is selected. `--reinstall` installs selected tools even when they are already on `PATH`.

Node.js LTS is installed from the official `nodejs.org` tarball under `~/.local/share/node` and linked into `~/.local/bin`. Bun, Claude Code, and Herdr use their official upstream installers.

After installation, link the desired configuration with the [linker](linking.md). `scripts/install.py` remains a compatibility wrapper.
