# Configuration sources

- Treat this repository as the authoritative source for the OpenCode and Claude Code configuration that it manages.
- Do not edit raw configuration files in `~/.config/opencode`, `~/.claude`, or other linked target locations. Update their repository-managed source files here instead, unless editing the target is absolutely necessary.
- Match the surrounding code's naming, structure, idioms, formatting, and comment density.
- Use comments only for non-obvious constraints; do not narrate code or justify a change to reviewers.
- Do not add tests that merely repeat configuration values, pin prompt wording, or duplicate existing coverage; each test must catch a concrete behavioral regression or integration failure worth its maintenance cost.
- Before destructive or outward-facing actions, confirm authorization and inspect existing targets before overwriting or deleting them.
- `~/.bashrc` is not managed by the linker, so `dotfiles/bashrc.d/` snippets only load if it sources `~/.config/bashrc.d/*.sh`. When shell helpers such as `oc2` are missing, check for that loader first and add the snippet from `docs/dotfiles.md` after confirming with the user, keeping a backup of the original file.

# Git workflow

- Unless explicitly stated otherwise, commit changes directly to `main`.

# Prompt sources

- Repository-managed skills live once under `agentic_common/skills/` and are linked to both hosts. Edit that copy; never reintroduce a per-host copy. OpenCode supplies its own `opencode` and `report` skills; do not vendor them here.
- Keep everything under `agentic_common/` platform-neutral. Do not name a host-specific tool (`bash` vs `shell`, `question` vs `AskUserQuestion`, `skill` vs `Skill`); describe the action instead, because the same file is loaded by Claude Code and OpenCode V2.
- Claude Code uses its built-in agents. Repository-managed custom agents under `opencode/agents/` apply only to OpenCode.
