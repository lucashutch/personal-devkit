# personal-devkit

Personal developer toolkit for OpenCode and Claude Code workflows, terminal configuration, shell helpers, and repo-managed dotfiles.

Fork it or open a PR to adapt the prompts and tool descriptions to your own workflow.

## What's here

- `agentic_common/` — platform-neutral skills shared by Claude Code and OpenCode, plus OpenCode commands
- `opencode/` — OpenCode V1 and V2 profiles, agents, and plugins
- `claude/` — Claude Code settings, keybindings, statusline, and agents
- `herdr/` — Herdr configuration
- `dotfiles/` — Bash, Ghostty, Starship, and ALSA configuration
- `links.yaml` — source-to-destination mappings managed by the linker
- `scripts/` — installers, linker, migrations, and their tests

## Quick start

On Linux, install the default tool set:

```sh
scripts/install.py
```

Link all managed configuration. The linker requires PyYAML; [uv](https://docs.astral.sh/uv/) runs it without a separate setup step:

```sh
uv run scripts/link-config.py --all
```

To inspect changes before applying them:

```sh
uv run scripts/link-config.py --all --dry-run
uv run scripts/link-config.py --all --check
```

## Documentation

- [Installing tools](docs/installation.md)
- [Linking configuration](docs/linking.md)
- [Dotfiles and Bash helpers](docs/dotfiles.md)
- [OpenCode profiles and integrations](docs/opencode.md)
- [OpenCode V1 profile migration](opencode/v1/MIGRATION.md)
- [OpenCode V2 extension compatibility](opencode/v2/README.md)

## Notes

- Run `scripts/link-config.py --help` or `scripts/install.py --help` for the complete CLI reference.
- Repository-managed sources belong here, not in their linked locations under `~/.config` or `~/.claude`.
