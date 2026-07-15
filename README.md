# personal-devkit

Personal developer toolkit for OpenCode workflows, terminal configuration, shell helpers, and repo-managed dotfiles.

Feel free to fork this repo or open PRs to fine-tune the prompts and tool descriptions for your own workflow.

## Included

- `opencode/` — OpenCode agents, commands, plugins, and config
- `claude/` — Claude Code settings, keybindings, statusline, agents, skills, and commands
- `dotfiles/` — terminal and shell config managed from this repo
- `scripts/link-config.py` — symlinks repo-managed config into `~/.config` (and `~/.claude`)


## Tool installer

`scripts/install.py` is the Linux-only Python 3.11+ entrypoint for installing default developer tools used by this repo: `fzf`, `starship`, `npm`/`npx`, OpenCode CLI and Desktop, and Visual Studio Code. It installs fzf from upstream GitHub into `~/.fzf` and links it into `~/.local/bin` so shell integration stays closer to the current fzf release than distro packages. It installs npm from the system apt repository and installs Visual Studio Code from Microsoft's official apt repository. Selecting OpenCode also installs its npm prerequisite and the official OpenCode Desktop DEB for the host's amd64 or arm64 architecture. The installer installs tools only; it does not call `scripts/link-config.py`, link files into `~/.config`, or modify repo-managed dotfiles.

```sh
scripts/install.py --help
scripts/install.py              # default: install all supported tools, including Visual Studio Code
scripts/install.py --fzf
scripts/install.py --npm
scripts/install.py --vscode
scripts/install.py --starship --opencode
scripts/install.py --all --reinstall  # all supported tools, including Visual Studio Code
```

CLI flags:

- `--all` — select all supported tools. This is the default when no per-tool flag is provided.
- `--fzf` — select `fzf` only, unless combined with other tool flags.
- `--starship` — select `starship` only, unless combined with other tool flags.
- `--npm` — select npm and its bundled `npx` command only, unless combined with other tool flags.
- `--opencode` — select OpenCode CLI and Desktop, unless combined with other tool flags.
- `--vscode` — select Visual Studio Code only, unless combined with other tool flags.
- `--reinstall` — do not skip a selected tool that is already present on `PATH`.
- `-h`, `--help` — print usage text.

The installer is intended to be noninteractive and idempotent. Reruns skip selected tools that are already available on `PATH` unless `--reinstall` is passed. On non-Linux systems, the script exits before making changes.

## Linking config

```sh
 scripts/link-config.py --help
 scripts/link-config.py --opencode
 scripts/link-config.py --claude
 scripts/link-config.py --dotfiles
 scripts/link-config.py --all
```

Use `--force` to replace existing files/directories/symlinks at the target paths.
Without `--force`, the script reports every item that worked or errored and exits non-zero if anything failed.

By default, running the script with no target option links OpenCode config only.

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

Current bash snippets include OpenCode account helpers:

- `och` — OpenCode home account
- `ocw` — OpenCode work account
- `oct` — OpenCode test account (prompt-capture proxy, experimental providers)
- `opencode` alias defaults to `ocw`
- `o2h` — OpenCode V2 home profile (service on `127.0.0.1:4098`)
- `o2w` — OpenCode V2 work profile (service on `127.0.0.1:4097`)
- `o2t` — OpenCode V2 test profile (service on `127.0.0.1:4099`)
- `tokh` — Tokscale using the home OpenCode V1 data
- `tokw` — Tokscale using the work OpenCode V1 data

The V1 helpers use separate XDG config, data, state, and cache trees. This
keeps each account's complete V1 global config, credentials, sessions, and
other state isolated from the other V1 accounts and from the future V2 global
config.

## Dotfiles

- `dotfiles/starship.toml`
- `dotfiles/ghostty/config`
- `dotfiles/ghostty/themes/vscode-dark`
- `dotfiles/bashrc.d/opencode.sh`

## OpenCode

V2 home, work, and test profiles are selected with `o2h`, `o2w`, and `o2t`.
Each wrapper sets all XDG config, data, state, and cache roots, isolating its
config, credentials, sessions, database, service registration, logs, and cache
while retaining the normal persistent V2 server within that profile. Project
`opencode.json(c)` files still layer over the selected global profile; they do
not isolate credentials or sessions.

Run `scripts/link-config.py --opencode` first. It links profile config to
`~/.config/opencode-v2-{home,work,test}/opencode/`, with shared CLI settings
and agents sourced from `opencode/v2/shared/`. It never links runtime-generated
`service.json` or other credentials/state files. Use the profile wrappers;
bare `opencode2` is intentionally not configured by this repository.

`scripts/link-config.py --opencode` configures these local-only endpoints when
`opencode2` is on `PATH`; rerunning it reapplies the same values safely. If the
binary is not installed yet, it reports that service configuration was skipped.
To configure manually, then authenticate separately in each profile:

```sh
o2h service set hostname 127.0.0.1
o2h service set port 4098
o2w service set hostname 127.0.0.1
o2w service set port 4097
o2t service set hostname 127.0.0.1
o2t service set port 4099
o2h service restart  # use start instead if it has never run
o2w service restart
o2t service restart
```

Check isolation with `o2h service status`, `o2w service status`, and `o2t
service status`. After upgrading `@opencode-ai/cli@next`, verify `opencode2
service --help`, each profile's `service get`, and restart each service. Quit
and restart OpenCode after changing its repo-managed configuration.

V1 account profiles are linked separately:

- `~/.config/opencode-v1-home/opencode/`
- `~/.config/opencode-v1-work/opencode/`
- `~/.config/opencode-v1-test/opencode/`

Each profile has a complete V1 `opencode.json` plus shared repo-managed TUI,
agent, command, plugin, and skill files. The profile sources live under
`opencode/v1/`. See [the V1 profile migration guide](opencode/v1/MIGRATION.md)
when setting up another computer or preserving existing V1 authentication and
session history.

The same command also installs Home and Work desktop launchers under the XDG
data directory. They use the V1 XDG roots above, have green and orange icons,
and locally hide the stock OpenCode desktop entry.

## Notes

- `.vscode/`, `.ruff_cache/`, and other local caches are ignored via `.gitignore`
