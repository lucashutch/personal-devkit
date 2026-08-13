# personal-devkit

Personal developer toolkit for OpenCode workflows, terminal configuration, shell helpers, and repo-managed dotfiles.

Feel free to fork this repo or open PRs to fine-tune the prompts and tool descriptions for your own workflow.

## Included

- `agentic_common/` — platform-neutral skills (shared by Claude Code and every OpenCode profile) and slash commands (OpenCode only; see below)
- `opencode/` — OpenCode agents, plugins, and config
- `claude/` — Claude Code settings, keybindings, statusline, and agents
- `herdr/` — Herdr configuration
- `dotfiles/` — terminal and shell config managed from this repo
- `links.yaml` — declares repo-managed source-to-destination mappings
- `scripts/link-config.py` — validates and applies the mappings, plus repository-specific setup actions


## Tool installer

`scripts/install.py` is the Linux-only Python 3.11+ entrypoint for installing default developer tools used by this repo: `fzf`, `starship`, `npm`/`npx`, OpenCode CLI and Desktop, Herdr, and Visual Studio Code. Herdr is installed with its official installer from `herdr.dev`. The installer installs tools only; it does not call `scripts/link-config.py`, link files into `~/.config`, or modify repo-managed dotfiles.

The Herdr OpenCode integration plugin is managed at `opencode/v1/shared/plugins/herdr-agent-state.js` and is linked into every V1 profile by `scripts/link-config.py --opencode`. It reports OpenCode lifecycle state and session identity when OpenCode runs inside Herdr. The plugin is generated from Herdr's official integration installer; update it with `herdr integration install opencode` when Herdr publishes a newer integration version, then copy the generated plugin into that repository path.

The Herdr Claude integration is likewise managed in `claude/hooks/herdr-agent-state.sh` and the Herdr hook entries in `claude/settings.json`. Run `scripts/link-config.py --claude` to link both into `~/.claude`.

```sh
scripts/install.py --help
scripts/install.py              # default: install all supported tools, including Visual Studio Code
scripts/install.py --fzf
scripts/install.py --npm
scripts/install.py --vscode
scripts/install.py --starship --opencode
scripts/install.py --herdr
scripts/install.py --all --reinstall  # all supported tools, including Visual Studio Code
```

CLI flags:

- `--all` — select all supported tools. This is the default when no per-tool flag is provided.
- `--fzf` — select `fzf` only, unless combined with other tool flags.
- `--starship` — select `starship` only, unless combined with other tool flags.
- `--npm` — select npm and its bundled `npx` command only, unless combined with other tool flags.
- `--opencode` — select OpenCode CLI and Desktop, unless combined with other tool flags.
- `--herdr` — select Herdr, unless combined with other tool flags.
- `--vscode` — select Visual Studio Code only, unless combined with other tool flags.
- `--reinstall` — do not skip a selected tool that is already present on `PATH`.
- `-h`, `--help` — print usage text.

The installer is intended to be noninteractive and idempotent. Reruns skip selected tools that are already available on `PATH` unless `--reinstall` is passed. On non-Linux systems, the script exits before making changes.

## Linking config

The linker needs PyYAML. With [uv](https://docs.astral.sh/uv/) you can run it without installing anything (inline script metadata resolves the dependency):

```sh
uv run scripts/link-config.py --all
```

Or set up the project environment once and use the script directly:

```sh
uv sync
```

```sh
scripts/link-config.py --help
scripts/link-config.py --opencode
scripts/link-config.py --claude
scripts/link-config.py --herdr
scripts/link-config.py --dotfiles
scripts/link-config.py --all
```

Use `--force` to replace existing files, symlinks, or empty directories at the target paths.
Without `--force`, the script reports every item that worked or errored and exits non-zero if anything failed.

By default, running the script with no target option links OpenCode config only.
Herdr config is linked from `herdr/config.toml` to `~/.config/herdr/config.toml`.

The linker validates the complete selected plan before changing anything. Its
additional operating modes are:

```sh
scripts/link-config.py --all --check     # verify without changing files
scripts/link-config.py --all --dry-run   # show links and actions that would run
scripts/link-config.py --dotfiles --unlink
```

`--unlink` removes only symlinks whose immediate target is still the declared
source. It leaves generated desktop files and unmanaged objects untouched.
`--force` can replace files, symlinks, and empty directories, but never a
non-empty real directory.

### Link manifest

Each `links.yaml` entry maps one repository-relative source to one or more
absolute destinations. Destinations may use `$HOME`, `$CONFIG_HOME`,
`$DATA_HOME`, `$STATE_HOME`, and `$CACHE_HOME`; the XDG values are normalized
so running the linker from an OpenCode profile does not nest profile roots.

```yaml
version: 1
groups:
  herdr:
  - source: herdr/config.toml
    destinations:
    - $CONFIG_HOME/herdr/config.toml
```

Directory entries can select contents recursively with `include` and `exclude`
globs. Relative paths are preserved, patterns without `/` match at any depth,
and exclusions take precedence. Patterns support `*` within one path segment,
`**` across path segments, and `?` for one non-separator character; character
classes such as `[abc]` are not supported. A subdirectory is linked as one
directory only when an include such as `**` or `docs/**` structurally selects
its complete subtree and there are no exclusions. Other filtered directories
are created normally and contain links to their selected files.

```yaml
- source: examples/config
  destinations:
  - $CONFIG_HOME/example
  include:
  - "**/*.md"
  exclude:
  - draft.md
  - "archive/**"
```

Without `include` or `exclude`, a directory source is linked as one directory.
Use `optional: true` for a source that may not exist. A custom manifest can be
checked with `--manifest PATH`; its source paths are still relative to this
repository.

## Bash config

Managed bash snippets live in:

```sh
dotfiles/bashrc.d/
```

Add this block to `~/.bashrc` so those snippets are loaded:

```sh
# Managed personal shell config
if [ -d "$HOME/.config/bashrc.d" ]; then
  for f in "$HOME/.config/bashrc.d/"*.sh; do
    [ -r "$f" ] && . "$f"
  done
fi
```

Then link dotfiles:

```sh
 scripts/link-config.py --dotfiles
```

This also links `dotfiles/.asoundrc` to `~/.asoundrc`, routing ALSA clients
through PulseAudio so notification sounds work with WSLg.

Current bash snippets include:

- PATH setup for Bun, Cargo, Go, npm, pi-node, LM Studio, and ARM toolchains
- lazy-loaded `nvm`
- `venv` activation and completion for environments in `~/.venvs`
- optional CellX Build and nrfutil completions
- workstation aliases, including Ghostty updates and GPU selection
- `tailnet` switching for home and work Tailscale accounts
- OpenCode helpers:

- `opencode`, short alias `oc` — OpenCode V1 on the default XDG namespace
- `oct` — isolated OpenCode V1 test profile (prompt-capture proxy, experimental providers)
- `opencode2`, short alias `oc2` — OpenCode V2 in its own `opencode-v2` namespace
- `o2t` — isolated OpenCode V2 test profile (service on `127.0.0.1:4099`)

### Tailscale switching

`tailnet home` and `tailnet work` read their accounts from
`TAILNET_HOME_ACCOUNT` and `TAILNET_WORK_ACCOUNT` and refuse to switch when the
requested one is unset. Accounts are personal data, so this repository never
carries them. `~/.config/bashrc.d` is a symlink into this repository, so private
values go in `~/.bashrc.local`, which `05-local-env.sh` sources when readable:

```sh
cat > "$HOME/.bashrc.local" <<'EOF'
export TAILNET_HOME_ACCOUNT="you@example.com"
export TAILNET_WORK_ACCOUNT="you@example.org"
EOF
chmod 600 "$HOME/.bashrc.local"
```

The helper calls `tailscale` without `sudo`, which needs the local user granted
operator rights once per machine:

```sh
sudo tailscale set --operator="$USER"
```

Verify with `tailscale debug prefs | grep OperatorUser`. Without it, every
`tailscale` call fails on permissions rather than falling back to `sudo`.

The helpers in `dotfiles/bashrc.d/opencode.sh` are plain shell functions that
run the real binary. `opencode` sets no XDG override, so V1 uses
`~/.config/opencode` and `~/.local/share/opencode` and any external tool that
reads the default OpenCode locations sees the same sessions and credentials.
Each V1 window is its own standalone process.

`opencode2` exists because V1 and V2 both read
`$XDG_CONFIG_HOME/opencode/opencode.json` but their config schemas are
incompatible. It exports the `opencode-v2` XDG roots, so V2 keeps its own
config, credentials, sessions, database, service registration, logs, and cache
while V1 keeps the default namespace. The test wrappers use `opencode-v1-test`
and `opencode-v2-test` roots and exist only to run experimental config against
throwaway state.

Profile selection is deliberately shell-only. Callers that are not interactive
shells set the namespace themselves. Because V1 now uses the default namespace,
external session resume works for it: Herdr builds its resume argv from a
hardcoded per-agent table and rejects non-official agent sources, so it can
only ever find the default namespace's sessions. Resume from outside a wrapper
still does not work for `opencode2` or the test profiles.

## Dotfiles

- `dotfiles/starship.toml`
- `dotfiles/ghostty/config`
- `dotfiles/ghostty/themes/vscode-dark`
- `dotfiles/bashrc.d/` — modular Bash PATH setup, helpers, completions, aliases,
  and OpenCode commands

## OpenCode

There is one default profile per OpenCode generation plus one throwaway test
profile each:

| Helper | `XDG_CONFIG_HOME` | Global config |
| --- | --- | --- |
| `opencode`, `oc` | `~/.config` (default) | `~/.config/opencode/opencode.json` |
| `oct` | `~/.config/opencode-v1-test` | `opencode/opencode.json` |
| `opencode2`, `oc2` | `~/.config/opencode-v2` | `opencode/opencode.json` |
| `o2t` | `~/.config/opencode-v2-test` | `opencode/opencode.json` |

Each non-default wrapper sets all XDG config, data, state, and cache roots,
isolating its config, credentials, sessions, database, service registration,
logs, and cache while retaining the normal persistent V2 server within that
profile. Project `opencode.json(c)` files still layer over the selected global
config; they do not isolate credentials or sessions.

The wrappers set `GH_CONFIG_DIR` to the normal shared GitHub CLI config
directory, so `gh` keeps one login across OpenCode profiles.

Run `scripts/link-config.py --opencode` first. It links the V1 default config
into `~/.config/opencode/` and the V2 default config into
`~/.config/opencode-v2/opencode/`, with shared CLI settings, agents, the Herdr
lifecycle integration, and the Herdr session-title plugin sourced from
`opencode/v{1,2}/shared/`, then runs `npm install --no-package-lock` in
`opencode/v2/` to install the current `next` TUI plugin dependencies. It never
links runtime-generated `service.json` or other credentials/state files.

The V2 default profile deliberately keeps OpenCode's built-in service endpoint.
Only the V2 test profile gets an explicit local endpoint, which
`scripts/link-config.py --opencode` configures when `opencode2` is on `PATH`;
rerunning it reapplies the same values safely. If the binary is not installed
yet, it reports that service configuration was skipped. To configure manually:

```sh
o2t service set hostname 127.0.0.1
o2t service set port 4099
o2t service restart  # use start instead if it has never run
```

Check isolation with `opencode2 service status` and `o2t service status`. After
upgrading `@opencode-ai/cli@next`, verify `opencode2 service --help`, each
profile's `service get`, and restart each service. Quit and restart OpenCode
after changing its repo-managed configuration.

The V1 default config sources live in `opencode/v1/default/`, and the V2 ones in
`opencode/v2/default/`. Both are the union of the retired home and work account
configs, and both carry the shared repo-managed TUI, agent, command, plugin, and
skill files. See [the profile migration guide](opencode/v1/MIGRATION.md) when
setting up another computer or migrating from the old per-account profiles.

V1 CLI TUI launches are standalone: each `opencode` or `oct` window starts its
own process, and every V1 command keeps its normal upstream behavior.

`scripts/link-config.py --opencode` also installs one OpenCode desktop launcher
under the XDG data directory. It uses the default XDG roots and the stock icon,
and locally hides the packaged OpenCode desktop entry it replaces.

## Notes

- `.vscode/`, `.ruff_cache/`, and other local caches are ignored via `.gitignore`
