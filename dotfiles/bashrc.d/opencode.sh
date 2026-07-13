# OpenCode - Home account
och() {
  XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-v1-home" \
  XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-v1-home" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

# OpenCode - Work account
ocw() {
  XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-v1-work" \
  XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-v1-work" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

# OpenCode - Test account (prompt-capture proxy, experimental providers)
oct() {
  XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-v1-test" \
  XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-v1-test" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

alias opencode=ocw

# OpenCode V2 uses the standard global config and data locations.
opencode2() {
  command opencode "$@"
}

# Tokscale usage for OpenCode V1 account data.
tokh() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v1-home" \
  command npx tokscale@latest "$@"
}

tokw() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v1-work" \
  command npx tokscale@latest "$@"
}
