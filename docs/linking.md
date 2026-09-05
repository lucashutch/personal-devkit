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

## Manifest

[`links.yaml`](../links.yaml) declares groups of repository-relative sources and their absolute destinations. Destinations may use `$HOME`, `$CONFIG_HOME`, `$DATA_HOME`, `$STATE_HOME`, `$CACHE_HOME`, and `$CLAUDE_CONFIG_DIR`. The last follows the environment variable when set and otherwise defaults to `~/.claude`.

Directory entries can use `include` and `exclude` globs. Patterns support `*`, `**`, and `?`; exclusions win. A directory without filters is linked as one directory. Set `optional: true` for a source that may not exist. `--manifest PATH` checks a custom manifest whose sources remain relative to this repository.

Use `uv run pdklink` from a checkout, or install the checkout with `uv tool install .` to make `pdklink` available on `PATH`. The command locates the checkout from the current directory. `scripts/link-config.py` remains a compatibility wrapper.
