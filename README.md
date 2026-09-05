# personal-devkit

Personal developer toolkit for OpenCode and Claude Code workflows, terminal configuration, shell helpers, and repo-managed dotfiles.

Fork it or open a PR to adapt the prompts and tool descriptions to your own workflow.

## What's here

- `agentic_common/` — platform-neutral skills and writing instructions shared by Claude Code and OpenCode
- `opencode/` — OpenCode profiles, agents, and plugins
- `claude/` — Claude Code settings, keybindings, statusline, and agents
- `herdr/` — Herdr configuration
- `dotfiles/` — Bash, Ghostty, Starship, and ALSA configuration
- `links.yaml` — source-to-destination mappings managed by the linker
- `src/personal_devkit/` — installer, linker, and migration implementations
- `scripts/` — compatibility entry points and Python tests

## Quick start

On Linux, install the default tool set:

```sh
uv run pdkinstall
```

Link all managed configuration. The linker requires PyYAML; [uv](https://docs.astral.sh/uv/) runs it without a separate setup step:

```sh
uv run pdklink --all
```

To inspect changes before applying them:

```sh
uv run pdklink --all --dry-run
uv run pdklink --all --check
```

## Documentation

- [Installing tools](docs/installation.md)
- [Linking configuration](docs/linking.md)
- [Dotfiles and Bash helpers](docs/dotfiles.md)
- [OpenCode profiles and integrations](docs/opencode.md)
- [OpenCode extension compatibility](opencode/README.md)

## Notes

- Run `uv run pdklink --help` or `uv run pdkinstall --help` for the complete CLI reference. The scripts in `scripts/` remain compatibility wrappers.
- Repository-managed sources belong here, not in their linked locations under `~/.config` or `~/.claude`.
