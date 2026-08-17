# OpenCode profile helpers.
#
# Each non-default profile gets its own XDG config, data, state, and cache
# namespace, so it keeps separate credentials, sessions, and other state.
# Profile selection is a shell concern only: these are plain functions, and any
# caller that is not an interactive shell (systemd units, other tools) sets the
# XDG namespace itself rather than relying on them.

# OpenCode V1 on the default XDG namespace.
oc() { command opencode "$@"; }

# Isolated OpenCode V1 test profile.
oct() {
  (
    export XDG_CONFIG_HOME="$HOME/.config/opencode-v1-test"
    export XDG_DATA_HOME="$HOME/.local/share/opencode-v1-test"
    export XDG_STATE_HOME="$HOME/.local/state/opencode-v1-test"
    export XDG_CACHE_HOME="$HOME/.cache/opencode-v1-test"
    export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}"

    exec opencode "$@"
  )
}

# Remove an existing profile suffix before selecting another profile. This lets
# a wrapper be called from a shell that exported one of these XDG roots without
# producing paths such as opencode-v2/opencode-v2-test.
_opencode_v2_profile_root() {
  local root="$1" profile="$2"
  case "$root" in
    */opencode-v1-test | */opencode-v2 | */opencode-v2-test)
      root="${root%/*}"
      ;;
  esac
  printf '%s/%s' "$root" "$profile"
}

_opencode_v2() {
  local profile="$1"
  shift
  XDG_CONFIG_HOME="$(_opencode_v2_profile_root "${XDG_CONFIG_HOME:-$HOME/.config}" "$profile")" \
    XDG_DATA_HOME="$(_opencode_v2_profile_root "${XDG_DATA_HOME:-$HOME/.local/share}" "$profile")" \
    XDG_STATE_HOME="$(_opencode_v2_profile_root "${XDG_STATE_HOME:-$HOME/.local/state}" "$profile")" \
    XDG_CACHE_HOME="$(_opencode_v2_profile_root "${XDG_CACHE_HOME:-$HOME/.cache}" "$profile")" \
    GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}" \
    command opencode2 "$@"
}

# OpenCode V2 profiles. They retain V2's normal persistent-service behavior in
# their own config, data, state, and cache namespace.
opencode2() { _opencode_v2 opencode-v2 "$@"; }
oc2() { opencode2 "$@"; }
o2t() { _opencode_v2 opencode-v2-test "$@"; }
