# Configuration sources

- Treat this repository as the authoritative source for the OpenCode and Claude Code configuration that it manages.
- Do not edit raw configuration files in `~/.config/opencode`, `~/.claude`, or other linked target locations. Update their repository-managed source files here instead, unless editing the target is absolutely necessary.
- Match the surrounding code's naming, structure, idioms, formatting, and comment density.
- Use comments only for non-obvious constraints; do not narrate code or justify a change to reviewers.
- Before destructive or outward-facing actions, confirm authorization and inspect existing targets before overwriting or deleting them.

# Git workflow

- Unless explicitly stated otherwise, commit changes directly to `main`.

# Prompt sources

- Skills and commands live once under `agentic_common/` and are linked to every host. Edit that copy; never reintroduce a per-host copy.
- Keep everything under `agentic_common/` platform-neutral. Do not name a host-specific tool (`bash` vs `shell`, `question` vs `AskUserQuestion`, `skill` vs `Skill`); describe the action instead, because the same file is loaded by Claude Code and OpenCode V1 and V2.
- Agent definitions cannot be shared: their frontmatter uses three incompatible schemas. When editing an agent under `claude/agents/` or `opencode/v*/shared/agents/`, apply the same body change to all three copies in the same commit.
- Agent bodies are byte-identical by design, except Claude's `subagent_type` rule in `General`. Do not add wording variants; if a change is genuinely host-specific, say so in the commit message.
