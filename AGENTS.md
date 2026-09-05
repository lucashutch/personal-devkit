# Configuration sources

- Treat this repository as the authoritative source for the OpenCode and Claude Code configuration that it manages.
- Do not edit raw configuration files in `~/.config/opencode`, `~/.claude`, or other linked target locations. Update their repository-managed source files here instead, unless editing the target is absolutely necessary.
- Match the surrounding code's naming, structure, idioms, formatting, and comment density.
- Use comments only for non-obvious constraints; do not narrate code or justify a change to reviewers.
- Before destructive or outward-facing actions, confirm authorization and inspect existing targets before overwriting or deleting them.

# Git workflow

- Unless explicitly stated otherwise, commit changes directly to `main`.

# Prompt sources

- Repository-managed skills live once under `agentic_common/skills/` and are linked to both hosts. Edit that copy; never reintroduce a per-host copy. OpenCode supplies its own `opencode` and `report` skills; do not vendor them here.
- Keep everything under `agentic_common/` platform-neutral. Do not name a host-specific tool (`bash` vs `shell`, `question` vs `AskUserQuestion`, `skill` vs `Skill`); describe the action instead, because the same file is loaded by Claude Code and OpenCode V2.
- Agent definitions have two source copies with incompatible frontmatter. When editing an agent under `claude/agents/` or `opencode/agents/`, apply the same body change to both copies in the same commit.
- Agent bodies are byte-identical by design, except Claude's `subagent_type` rule in `General`. Do not add wording variants; if a change is genuinely host-specific, say so in the commit message.
