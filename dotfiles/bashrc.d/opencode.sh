# OpenCode profile helpers.
#
# The default profile uses the standard XDG namespaces. The isolated test
# profile gets its own XDG config, data, state, and cache namespace, so it
# keeps separate credentials, sessions, and other state. Profile selection is
# a shell concern only: these are plain functions, and any caller that is not
# an interactive shell (systemd units, other tools) sets the XDG namespace
# itself rather than relying on them.

# Remove an existing profile suffix before selecting the test profile. This
# lets the wrapper be called from a shell that exported one of these XDG roots
# without producing paths such as opencode-test/opencode-test.
_opencode_profile_root() {
  local root="$1" profile="$2"
  case "$root" in
    */opencode-test | */opencode-v1-test | */opencode-v2 | */opencode-v2-test | */opencode)
      root="${root%/*}"
      ;;
  esac
  printf '%s/%s' "$root" "$profile"
}

_opencode_test() {
  XDG_CONFIG_HOME="$(_opencode_profile_root "${XDG_CONFIG_HOME:-$HOME/.config}" "opencode-test")" \
    XDG_DATA_HOME="$(_opencode_profile_root "${XDG_DATA_HOME:-$HOME/.local/share}" "opencode-test")" \
    XDG_STATE_HOME="$(_opencode_profile_root "${XDG_STATE_HOME:-$HOME/.local/state}" "opencode-test")" \
    XDG_CACHE_HOME="$(_opencode_profile_root "${XDG_CACHE_HOME:-$HOME/.cache}" "opencode-test")" \
    GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}" \
    command opencode2 "$@"
}

# OpenCode profiles. The default wrapper de-nests a profile namespace exported
# by a test shell, then runs with the standard XDG namespaces.
_opencode_strip() {
  case "$1" in
    */opencode-test | */opencode-v1-test | */opencode-v2 | */opencode-v2-test | */opencode)
      printf '%s' "${1%/*}" ;;
    *)
      printf '%s' "$1" ;;
  esac
}

opencode() {
  local config="${XDG_CONFIG_HOME:-$HOME/.config}"
  local data="${XDG_DATA_HOME:-$HOME/.local/share}"
  local state="${XDG_STATE_HOME:-$HOME/.local/state}"
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}"
  local stripped_config stripped_data stripped_state stripped_cache
  stripped_config="$(_opencode_strip "$config")"
  stripped_data="$(_opencode_strip "$data")"
  stripped_state="$(_opencode_strip "$state")"
  stripped_cache="$(_opencode_strip "$cache")"
  if [ "$stripped_config" != "$config" ] || [ "$stripped_data" != "$data" ] \
    || [ "$stripped_state" != "$state" ] || [ "$stripped_cache" != "$cache" ]; then
    XDG_CONFIG_HOME="$stripped_config" XDG_DATA_HOME="$stripped_data" \
      XDG_STATE_HOME="$stripped_state" XDG_CACHE_HOME="$stripped_cache" \
      GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}" \
      command opencode2 "$@"
  else
    GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}" \
      command opencode2 "$@"
  fi
}
oc() { OPENCODE_EXPERIMENTAL_OPENAI_RESPONSES_WEBSOCKET=1 opencode "$@"; }
oct() { _opencode_test "$@"; }

# Legacy aliases from the V2 namespace migration.
opencode2() { opencode "$@"; }
oc2() { opencode "$@"; }
o2t() { oct "$@"; }
