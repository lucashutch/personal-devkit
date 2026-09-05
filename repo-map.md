# Repo Map
Purpose: Personal, repo-managed OpenCode/Claude configuration, shell dotfiles, and installer/linking utilities.
Stack: TypeScript/TSX OpenCode plugins, JSON configuration, Python 3.11+, Bash
Verified: 2026-09-05 against tracked paths and `pyproject.toml`.

## Layout
- `opencode/{default,test}/` — OpenCode global configs.
- `agentic_common/skills/` — repository-managed skills linked into both hosts; OpenCode supplies its own `opencode` and `report` skills.
- `opencode/cli.json`, `opencode/agents/`, `opencode/lib/`, `opencode/plugins/` — common sources linked into both profiles.
- `opencode/plugins/herdr-tui-pane/tui.js` — Herdr integration, a TUI plugin because the shared service cannot know its pane.
- `claude/` — Claude Code settings, agents, hooks, themes, and statusline.
- `CLAUDE.md` — symlink to `AGENTS.md`; both hosts read the same repository instructions.
- `herdr/` — Herdr configuration.
- `dotfiles/` — Bash snippets, Ghostty configuration, and Starship theme.
- `src/personal_devkit/` — Python implementation of installers, linking, and session migration.
- `scripts/` — compatibility entry points and Python tests under `scripts/tests/`.
- `links.yaml` — declarative source-to-destination mappings consumed by the linker.

## Entry points
- `scripts/install.py` — installs the toolkit's supported command-line tools.
- `scripts/link-config.py` — validates and applies `links.yaml`, then runs repository-specific OpenCode setup actions.
- `opencode/plugins/*` — server/TUI packages explicitly registered in profile configs and `cli.json`.
- `opencode/{default,test}/opencode.json` — global configs.

## Commands
- Install tools: `scripts/install.py --help`
- Link config: `scripts/link-config.py --help`
- Install Python dependencies: `uv sync` (or run scripts ad hoc with `uv run scripts/link-config.py`)
- Python syntax check: `python3 -m compileall -q scripts`
- Tests: `uv run pytest`
- Plugin tests: `node --test opencode/plugins/*.test.mjs`
- Lint: `uv run ruff check scripts src`

## Conventions & gotchas
- Edit repository sources, never linked files under `~/.config/opencode*` or `~/.claude`.
- Wrappers are `opencode`/`oc` (default) and `oct` (isolated test); legacy `opencode2`/`oc2`/`o2t` remain as aliases. Only the test service endpoint is configured, and never committed.
- Skills live once in `agentic_common/skills/` and must stay platform-neutral: describe actions rather than naming host-specific tools.
- OpenCode slash-command adapters are intentionally not managed. Claude exposes skills as commands directly.
- Agents have two source copies with incompatible frontmatter (Claude `tools:`, OpenCode `permissions:` list). Keep their bodies identical except Claude's `subagent_type` rule in `General`.
- The retired V1 database backup lives at `~/.local/share/opencode-v1/opencode/opencode.db` and is included in tokscale settings for history.
