# OpenCode profile shim directory. `bin/opencode` and its `bin/opencode2`
# symlink select the profile XDG namespace, and resolve `--session <id>` to
# whichever profile and generation own that session, so external resume
# (Herdr) finds sessions from any profile.
case ":$PATH:" in
  *":$HOME/.config/bashrc.d/bin:"*) ;;
  *) PATH="$HOME/.config/bashrc.d/bin:$PATH" ;;
esac
export PATH

och() { OPENCODE_PROFILE=home command opencode "$@"; }
ocw() { OPENCODE_PROFILE=work command opencode "$@"; }
oct() { OPENCODE_PROFILE=test command opencode "$@"; }

# OpenCode V2 profiles. They retain V2's normal persistent-service behavior,
# but each profile has an isolated config, data, state, and cache namespace.
o2h() { OPENCODE_PROFILE=home command opencode2 "$@"; }
o2w() { OPENCODE_PROFILE=work command opencode2 "$@"; }
o2t() { OPENCODE_PROFILE=test command opencode2 "$@"; }

# Tokscale usage for OpenCode V1 account data.
tokh() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v1-home" \
  command npx tokscale@latest --client opencode "$@"
}

tokw() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v1-work" \
  command npx tokscale@latest --client opencode --client claude "$@"
}
