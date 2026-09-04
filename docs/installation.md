# Installing tools

`pdkinstall` is a noninteractive, idempotent Linux-only Python 3.11+ installer. It installs tools but does not link configuration or change managed dotfiles.

```sh
uv run pdkinstall --help
uv run pdkinstall                    # default tools, excluding optional desktop apps
uv run pdkinstall --opencode --claude
uv run pdkinstall --node
uv run pdkinstall --all --reinstall
```

Supported selections are `--fzf`, `--starship`, `--node`, `--bun`, `--opencode`, `--claude`, `--codex`, `--tokscale`, `--ghui`, `--glow`, `--glowm`, `--herdr`, `--opencode-desktop`, and `--vscode`. With no selection, the default command-line tools are selected and the optional desktop apps are excluded. Use `--opencode-desktop` or `--vscode` to install one desktop app, or `--all` to include both with every other tool. `--reinstall` installs selected tools even when they are already on `PATH`.

Node.js LTS is installed from the official `nodejs.org` tarball under `~/.local/share/node` and linked into `~/.local/bin`. Bun, Claude Code, and Herdr use their official upstream installers. glow and glowm are pulled from their GitHub release tarballs into `~/.local/bin`; both installs are rejected if the release publishes no SHA-256 digest.

After installation, link the desired configuration with the [linker](linking.md). `scripts/install.py` remains a compatibility wrapper.
