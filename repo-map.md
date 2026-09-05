# Repo Map
Purpose: Personal, repo-managed OpenCode/Claude configuration, shell dotfiles, and installer/linking utilities.
Stack: TypeScript/TSX OpenCode plugins, JSON configuration, Python 3.11+, Bash

## Layout
- `opencode/{default,test}/` — OpenCode global configs.
- `agentic_common/skills/` — the single copy of every skill, linked into Claude Code and all OpenCode profiles.
- `agentic_common/commands/` — the single copy of every slash command, linked into OpenCode profiles only.
- `opencode/shared/` — CLI settings and agents linked into every profile.
- `opencode/shared/plugins/herdr-tui-pane.js` — Herdr integration, a TUI plugin because the shared service cannot know its pane.
- `claude/` — Claude Code settings, agents, hooks, themes, and statusline.
- `CLAUDE.md` — symlink to `AGENTS.md`; both hosts read the same repository instructions.
- `herdr/` — Herdr configuration.
- `dotfiles/` — Bash snippets, Ghostty configuration, and Starship theme.
- `scripts/` — Python installers/linker/session-database migrator plus TypeScript schema maintenance utility.
- `links.yaml` — declarative source-to-destination mappings consumed by the linker.

## Entry points
- `scripts/install.py` — installs the toolkit's supported command-line tools.
- `scripts/link-config.py` — validates and applies `links.yaml`, then runs repository-specific OpenCode setup actions.
- `opencode/shared/plugins/*` — auto-loaded OpenCode plugin modules.
- `opencode/{default,test}/opencode.json` — global configs.

## Commands
- Install tools: `scripts/install.py --help`
- Link config: `scripts/link-config.py --help`
- Install Python dependencies: `uv sync` (or run scripts ad hoc with `uv run scripts/link-config.py`)
- Python syntax check: `python3 -m compileall -q scripts`
- Tests: `uv run pytest`
- Lint: `uv run ruff check scripts`

## Conventions & gotchas
- Edit repository sources, never linked files under `~/.config/opencode*` or `~/.claude`.
- Wrappers are `opencode`/`oc` (default) and `oct` (isolated test); legacy `opencode2`/`oc2`/`o2t` remain as aliases. Only the test service endpoint is configured, and never committed.
- Skills live once in `agentic_common/skills/` and must stay platform-neutral: never name a host-specific tool (`bash` vs `shell`, `question` vs `AskUserQuestion`), because the same file is loaded by Claude Code and OpenCode. The same rule applies to `agentic_common/commands/`.
- Commands are linked into OpenCode profiles only. They exist to expose a skill as a slash command, and Claude Code already surfaces every skill as one, so linking them into `~/.claude` would produce duplicate `/ship`, `/start`, and so on.
- Agents cannot be shared: frontmatter uses three incompatible schemas (Claude `tools:`, OpenCode `permissions:` list). Keep the bodies identical by hand; the only intended body difference is Claude's `subagent_type` rule in `General`.
- The retired V1 database backup lives at `~/.local/share/opencode-v1/opencode/opencode.db` and is included in tokscale settings for history.
