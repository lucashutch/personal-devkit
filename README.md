# my-scratchpad

Personal config and workflow scratchpad.

## Included

- `opencode/` — OpenCode agents, commands, plugins, and config
- `dotfiles/` — terminal and shell config managed from this repo
- `scripts/link-config.sh` — symlinks repo-managed config into `~/.config`

## Linking config

```sh
scripts/link-config.sh --help
scripts/link-config.sh --opencode
scripts/link-config.sh --dotfiles
scripts/link-config.sh --all
```

Use `--force` to replace existing files/directories/symlinks at the target paths.
Without `--force`, the script reports every item that worked or errored and exits non-zero if anything failed.

By default, running the script with no target option links OpenCode config only.

## Bash config

Managed bash snippets live in:

```sh
dotfiles/bashrc.d/
```

Add this block to `~/.bashrc` so those snippets are loaded:

```sh
# Managed personal shell config
if [ -d "$HOME/.config/bashrc.d" ]; then
  for f in "$HOME/.config/bashrc.d/"*.sh; do
    [ -r "$f" ] && . "$f"
  done
fi
```

Then link dotfiles:

```sh
scripts/link-config.sh --dotfiles
```

Current bash snippets include OpenCode account helpers:

- `och` — OpenCode home account
- `ocw` — OpenCode work account
- `opencode` alias defaults to `ocw`

## Dotfiles

- `dotfiles/starship.toml`
- `dotfiles/ghostty/config`
- `dotfiles/ghostty/themes/vscode-dark`
- `dotfiles/bashrc.d/opencode.sh`

## OpenCode

OpenCode config is linked into `~/.config/opencode`, including:

- account configs: `home.json`, `work.json`
- UI/config files: `opencode.json`, `tui.json`
- `agents/`
- `commands/`
- `plugins/`

## Notes

- `.vscode/`, `.ruff_cache/`, and other local caches are ignored via `.gitignore`
