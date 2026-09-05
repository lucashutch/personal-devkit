# Dotfiles and Bash helpers

The `dotfiles` linker group manages Starship, Ghostty, Bash snippets, and `.asoundrc`:

```sh
uv run pdklink --dotfiles
```

It links `dotfiles/bashrc.d/` to `~/.config/bashrc.d` and `dotfiles/.asoundrc` to `~/.asoundrc`. The ALSA configuration routes clients through PulseAudio for WSLg notification sounds.

Add this to `~/.bashrc` to load the managed snippets:

```sh
# Managed personal shell config
if [ -d "$HOME/.config/bashrc.d" ]; then
  for f in "$HOME/.config/bashrc.d/"*.sh; do
    [ -r "$f" ] && . "$f"
  done
fi
```

The snippets provide PATH setup, lazy `nvm`, virtual-environment helpers, optional completions, workstation aliases, Tailscale switching, and OpenCode wrappers.

## Private local settings

Keep private values outside this repository. `05-local-env.sh` loads `~/.bashrc.local` when it is readable. For Tailscale account switching:

```sh
cat > "$HOME/.bashrc.local" <<'EOF'
export TAILNET_HOME_ACCOUNT="you@example.com"
export TAILNET_WORK_ACCOUNT="you@example.org"
EOF
chmod 600 "$HOME/.bashrc.local"
sudo tailscale set --operator="$USER"
```

`tailnet home` and `tailnet work` refuse to switch unless their corresponding account variable is set. `tailnet exit on` routes through the `TAILNET_EXIT_NODE` exit node (`lucasfilms` by default), and `tailnet exit off` clears it.

## OpenCode wrappers

| Helper | Purpose |
| --- | --- |
| `opencode`, `oc` | Default OpenCode profile |
| `oct` | Isolated test profile |

See [OpenCode profiles](opencode.md) for profile locations and setup details.

## tokscale

`tok` runs tokscale after refreshing a snapshot of the OpenCode database at `~/.cache/tokscale/opencode-v2.db`.

tokscale reads OpenCode usage from a `message` table. The retired V1 backup at `~/.local/share/opencode-v1/opencode/opencode.db` still has one. The live database renamed the table to `session_message`, which leaves its usage invisible. The snapshot adds `message` and `session` views over the renamed tables, and `tok` points `scanner.opencodeDbPaths` at the snapshot plus the V1 backup.

The snapshot is a copy rather than a view on the live database, because OpenCode owns that file. Refreshing takes about 90ms, so `tok` does it on every launch. Sessions started while `tok` is open appear on the next run.

`tok` also sets `defaultClients` to OpenCode and Claude Code. Both settings are written into `~/.config/tokscale/settings.json` on each run, so plain `tokscale` behaves the same way. Everything else in that file is left alone.

A refresh failure prints an error and stops before launching tokscale, because a stale or missing path is otherwise ignored and would silently under-report. If OpenCode has never run, there is no database to snapshot and `tok` starts normally.
