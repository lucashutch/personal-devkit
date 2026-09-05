# Linking configuration

`pdklink` validates and links repository-managed sources to their configured destinations. It needs PyYAML.

Use [uv](https://docs.astral.sh/uv/) without setting up an environment:

```sh
uv run pdklink --all
```

Or create the project environment once, then invoke the script directly:

```sh
uv sync
pdklink --opencode
pdklink --claude
pdklink --herdr
pdklink --dotfiles
```

With no target option, the linker selects OpenCode. `--all` selects every group.

## Safe operation

The linker validates the complete selected plan before making changes. Use `--check` to verify links, `--dry-run` to preview work, and `--unlink` to remove only links that still point directly at their declared source.

```sh
pdklink --all --check
pdklink --all --dry-run
pdklink --dotfiles --unlink
```

`--force` may replace files, symlinks, and empty directories. It never replaces a non-empty real directory. Without it, conflicts are reported and the command exits non-zero.

## Migrating an existing machine after the OpenCode layout change

Pulling this revision does not repair links into the former `opencode/shared/` directory. Its agents, plugins, library, and CLI settings now live directly under `opencode/`.

1. Confirm the checkout path, custom XDG roots, and `CLAUDE_CONFIG_DIR`. Inspect existing destinations and preserve local configuration, credentials, sessions, and databases. Record the installed OpenCode CLI and plugin SDK versions.
2. From the updated checkout, preview the groups used on this machine:
   ```sh
   uv run pdklink --opencode --claude --dotfiles --dry-run
   ```
   Old links may conflict. Inspect their immediate targets with `readlink`, then preview replacements:
   ```sh
   uv run pdklink --opencode --claude --dotfiles --force --dry-run
   ```
   Do not use `--force` until every replacement is confirmed as repository-managed. Back up local overrides and resolve real-directory conflicts separately.
3. Inspect both OpenCode config roots, normally `~/.config/opencode` and `~/.config/opencode-test/opencode`. Remove obsolete `shared` and `commands` symlinks only when their immediate targets are this checkout's former `opencode/shared` and `agentic_common/commands`, respectively. Check dangling links too. Do not delete real directories or unrelated links. The new manifest's `--unlink` and `--check` do not cover these removed destinations.
4. Check for separately copied WebResearcher agents, `fix-reviews`/`pr-triage` skills, or old command adapters. Directory-linked copies disappear with their source files; local copies need inspection before removal.
5. Review linker side effects before applying: the OpenCode group installs the current floating SDK beta and its peers, and configures the test service on port `4099`. It does not guarantee SDK/CLI version compatibility. Once replacements and side effects are approved, apply the reviewed plan:
   ```sh
   uv run pdklink --opencode --claude --dotfiles --force
   ```
6. Restart affected OpenCode services after approval and reopen their TUIs. Start a fresh Claude session and reload the shell for helper changes. Validate:
   ```sh
   uv run pdklink --opencode --claude --dotfiles --check
   node --test opencode/plugins/*.test.mjs
   uv run pytest scripts/tests
   ```
   Smoke-test sidebar loading and delegation; use `inherit` when resuming a child. Provider-backed smoke tests require approval for any quota or cost.

The alias-free delegation implementation was tested with CLI beta-19135 and SDK beta-19129. Check compatibility on other versions rather than upgrading automatically. See [delegate validation notes](../opencode/DELEGATE-PROFILES.md).

## Manifest

[`links.yaml`](../links.yaml) declares groups of repository-relative sources and their absolute destinations. Destinations may use `$HOME`, `$CONFIG_HOME`, `$DATA_HOME`, `$STATE_HOME`, `$CACHE_HOME`, and `$CLAUDE_CONFIG_DIR`. The last follows the environment variable when set and otherwise defaults to `~/.claude`.

Directory entries can use `include` and `exclude` globs. Patterns support `*`, `**`, and `?`; exclusions win. A directory without filters is linked as one directory. Set `optional: true` for a source that may not exist. `--manifest PATH` checks a custom manifest whose sources remain relative to this repository.

Use `uv run pdklink` from a checkout, or install the checkout with `uv tool install .` to make `pdklink` available on `PATH`. The command locates the checkout from the current directory. `scripts/link-config.py` remains a compatibility wrapper.
