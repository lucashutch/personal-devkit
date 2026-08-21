# Linking configuration

`scripts/link-config.py` validates and links repository-managed sources to their configured destinations. It needs PyYAML.

Use [uv](https://docs.astral.sh/uv/) without setting up an environment:

```sh
uv run scripts/link-config.py --all
```

Or create the project environment once, then invoke the script directly:

```sh
uv sync
scripts/link-config.py --opencode
scripts/link-config.py --claude
scripts/link-config.py --herdr
scripts/link-config.py --dotfiles
```

With no target option, the linker selects OpenCode. `--all` selects every group.

## Safe operation

The linker validates the complete selected plan before making changes. Use `--check` to verify links, `--dry-run` to preview work, and `--unlink` to remove only links that still point directly at their declared source.

```sh
scripts/link-config.py --all --check
scripts/link-config.py --all --dry-run
scripts/link-config.py --dotfiles --unlink
```

`--force` may replace files, symlinks, and empty directories. It never replaces a non-empty real directory. Without it, conflicts are reported and the command exits non-zero.

## Manifest

[`links.yaml`](../links.yaml) declares groups of repository-relative sources and their absolute destinations. Destinations may use `$HOME`, `$CONFIG_HOME`, `$DATA_HOME`, `$STATE_HOME`, and `$CACHE_HOME`.

Directory entries can use `include` and `exclude` globs. Patterns support `*`, `**`, and `?`; exclusions win. A directory without filters is linked as one directory. Set `optional: true` for a source that may not exist. `--manifest PATH` checks a custom manifest whose sources remain relative to this repository.
