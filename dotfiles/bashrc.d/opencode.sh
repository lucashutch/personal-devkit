# OpenCode - Home account
och() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-home" \
  OPENCODE_CONFIG="$HOME/.config/opencode/home.json" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

# OpenCode - Work account
ocw() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-work" \
  OPENCODE_CONFIG="$HOME/.config/opencode/work.json" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

# OpenCode - Test account (prompt-capture proxy, experimental providers)
oct() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-test" \
  OPENCODE_CONFIG="$HOME/.config/opencode/test.json" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

alias opencode=ocw

# OpenCode v2 beta - Home account
o2h() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-home" \
  OPENCODE_CONFIG="$HOME/.config/opencode/home.json" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode2 "$@"
}

# OpenCode v2 beta - Work account
o2w() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-work" \
  OPENCODE_CONFIG="$HOME/.config/opencode/work.json" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode2 "$@"
}

# OpenCode v2 beta - Test account
o2t() {
  XDG_DATA_HOME="$HOME/.config/opencode/xdg-test" \
  OPENCODE_CONFIG="$HOME/.config/opencode/test.json" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode2 "$@"
}
