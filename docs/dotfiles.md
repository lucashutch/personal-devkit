# Dotfiles and Bash helpers

The `dotfiles` linker group manages Starship, Ghostty, Bash snippets, and `.asoundrc`:

```sh
scripts/link-config.py --dotfiles
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

`tailnet home` and `tailnet work` refuse to switch unless their corresponding account variable is set.

## OpenCode wrappers

| Helper | Purpose |
| --- | --- |
| `opencode`, `oc` | Default OpenCode V1 profile |
| `oct` | Isolated V1 test profile |
| `opencode2`, `oc2` | Default OpenCode V2 profile |
| `o2t` | Isolated V2 test profile |

See [OpenCode profiles](opencode.md) for profile locations and setup details.
