# OpenCode - Home account
och() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-home" \
  OPENCODE_CONFIG="$HOME/.config/opencode/home.json" \
  command opencode "$@"
}

# OpenCode - Work account
ocw() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-work" \
  OPENCODE_CONFIG="$HOME/.config/opencode/work.json" \
  command opencode "$@"
}

alias opencode=ocw
