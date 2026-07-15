# OpenCode - Home account
och() {
  XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-v1-home" \
  XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-v1-home" \
  XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/opencode-v1-home" \
  XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/opencode-v1-home" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

# OpenCode - Work account
ocw() {
  XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-v1-work" \
  XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-v1-work" \
  XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/opencode-v1-work" \
  XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/opencode-v1-work" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

# OpenCode - Test account (prompt-capture proxy, experimental providers)
oct() {
  XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-v1-test" \
  XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-v1-test" \
  XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/opencode-v1-test" \
  XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/opencode-v1-test" \
  OPENCODE_EXPERIMENTAL_WEBSOCKETS=true \
  command opencode "$@"
}

alias opencode=ocw

# Remove an existing V2 profile suffix before selecting another profile. This
# lets a wrapper be called from a shell that exported one of these XDG roots
# without producing paths such as opencode-v2-home/opencode-v2-work.
_opencode_v2_profile_root() {
  local root="$1" profile="$2"
  case "$root" in
    */opencode-v1-home|*/opencode-v1-work|*/opencode-v1-test|*/opencode-v2-home|*/opencode-v2-work|*/opencode-v2-test)
      root="${root%/*}"
      ;;
  esac
  printf '%s/opencode-v2-%s' "$root" "$profile"
}

_opencode_v2() {
  local profile="$1"
  shift
  XDG_CONFIG_HOME="$(_opencode_v2_profile_root "${XDG_CONFIG_HOME:-$HOME/.config}" "$profile")" \
  XDG_DATA_HOME="$(_opencode_v2_profile_root "${XDG_DATA_HOME:-$HOME/.local/share}" "$profile")" \
  XDG_STATE_HOME="$(_opencode_v2_profile_root "${XDG_STATE_HOME:-$HOME/.local/state}" "$profile")" \
  XDG_CACHE_HOME="$(_opencode_v2_profile_root "${XDG_CACHE_HOME:-$HOME/.cache}" "$profile")" \
  command opencode2 "$@"
}

# OpenCode V2 profiles. They retain V2's normal persistent-service behavior,
# but each profile has an isolated config, data, state, and cache namespace.
o2h() { _opencode_v2 home "$@"; }
o2w() { _opencode_v2 work "$@"; }
o2t() { _opencode_v2 test "$@"; }

# Bare OpenCode V2 retains the existing standard global namespace.
opencode2() {
  command opencode2 "$@"
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
