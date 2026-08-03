# OpenCode profile helpers.
#
# Each profile gets its own XDG config, data, state, and cache namespace, so
# accounts keep separate credentials, sessions, and other state. Profile
# selection is a shell concern only: these are plain functions, and any caller
# that is not an interactive shell (systemd units, other tools) sets the XDG
# namespace itself rather than relying on them.

_opencode_v1() {
  local profile="$1"
  shift

  # A subshell keeps the exported namespace out of the calling shell.
  (
    export XDG_CONFIG_HOME="$HOME/.config/opencode-v1-$profile"
    export XDG_DATA_HOME="$HOME/.local/share/opencode-v1-$profile"
    export XDG_STATE_HOME="$HOME/.local/state/opencode-v1-$profile"
    export XDG_CACHE_HOME="$HOME/.cache/opencode-v1-$profile"
    export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}"
    export OPENCODE_EXPERIMENTAL_WEBSOCKETS=true

    # `exec` runs an external program, so it bypasses the `opencode` alias and
    # these functions without needing `command`.
    exec opencode "$@"
  )
}

# OpenCode V1 accounts.
och() { _opencode_v1 home "$@"; }
ocw() { _opencode_v1 work "$@"; }
oct() { _opencode_v1 test "$@"; }

alias opencode=ocw

# Remove an existing profile suffix before selecting another profile. This lets
# a wrapper be called from a shell that exported one of these XDG roots without
# producing paths such as opencode-v2-home/opencode-v2-work.
_opencode_v2_profile_root() {
  local root="$1" profile="$2"
  case "$root" in
    */opencode-v1-home | */opencode-v1-work | */opencode-v1-test | \
      */opencode-v2-home | */opencode-v2-work | */opencode-v2-test)
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
    GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}" \
    command opencode2 "$@"
}

# OpenCode V2 profiles. They retain V2's normal persistent-service behavior,
# but each profile has an isolated config, data, state, and cache namespace.
o2h() { _opencode_v2 home "$@"; }
o2w() { _opencode_v2 work "$@"; }
o2t() { _opencode_v2 test "$@"; }

# Tokscale usage for OpenCode V1 account data.
tokh() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v1-home" \
    command npx tokscale@latest --client opencode "$@"
}

tokw() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v1-work" \
    command npx tokscale@latest --client opencode --client claude "$@"
}

# Tokscale usage for OpenCode V2 account data. V2 keeps sessions in
# opencode-next.db, while tokscale's opencode client only reads the V1
# storage/message tree, so these report nothing until tokscale learns to read
# the V2 database. They are kept separate from tokh/tokw because tokscale takes
# a single data root, so V1 and V2 cannot be scanned in one invocation.
tok2h() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v2-home" \
    command npx tokscale@latest --client opencode "$@"
}

tok2w() {
  XDG_DATA_HOME="$HOME/.local/share/opencode-v2-work" \
    command npx tokscale@latest --client opencode "$@"
}
