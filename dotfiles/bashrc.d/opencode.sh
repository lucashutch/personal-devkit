# OpenCode profile helpers.
#
# Each profile gets its own XDG config, data, state, and cache namespace, so
# accounts keep separate credentials, sessions, and other state. Profile
# selection is a shell concern only: these are plain functions, and any caller
# that is not an interactive shell (systemd units, other tools) sets the XDG
# namespace itself rather than relying on them.

_opencode_v1_port() {
  case "$1" in
    home) printf '%s\n' 4195 ;;
    work) printf '%s\n' 4196 ;;
    test) printf '%s\n' 4197 ;;
  esac
}

# V1 profiles share one server per profile, so several TUI clients can attach to
# the same sessions. `attach` has a narrower argument surface than the default
# TUI, so subcommands and unsupported TUI flags stay on the standalone path.
_opencode_v1_attachable_tui() {
  local command="${1:-}" arg
  case "$command" in
    acp | agent | attach | completion | db | debug | export | github | import | mcp | models | plugin | providers | pr | run | serve | session | stats | uninstall | upgrade | web)
      return 1
      ;;
  esac

  for arg in "$@"; do
    case "$arg" in
      --auto | --auto=* | --command | --command=* | --file | --file=* | --format | --format=* | --model | --model=* | --port | --port=* | --hostname | --hostname=* | --mdns | --mdns-domain | --mdns-domain=* | --cors | --cors=* | --prompt | --prompt=* | --pure | --share | --share=* | --title | --title=* | --variant | --variant=* | --thinking | --interactive)
        return 1
        ;;
    esac
  done
  return 0
}

# Translates default-TUI arguments into `attach` arguments, reporting failure so
# the caller can fall back to the standalone path.
_opencode_v1_attach_args() {
  local directory=""
  _opencode_attach_args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir)
        [ "$#" -ge 2 ] || return 2
        directory="$2"
        shift 2
        ;;
      --dir=*)
        directory="${1#--dir=}"
        shift
        ;;
      --session | -s | --log-level | -p | --password | -u | --username)
        [ "$#" -ge 2 ] || return 2
        _opencode_attach_args+=("$1" "$2")
        shift 2
        ;;
      --session=* | --log-level=* | --password=* | --username=* | --continue | -c | --fork | --print-logs)
        _opencode_attach_args+=("$1")
        shift
        ;;
      -*)
        return 2
        ;;
      *)
        if [ -z "$directory" ]; then
          directory="$1"
        else
          return 2
        fi
        shift
        ;;
    esac
  done
  _opencode_attach_args+=(--dir "${directory:-$PWD}")
}

_opencode_v1() {
  local profile="$1"
  shift
  local port
  port=$(_opencode_v1_port "$profile")

  # A subshell keeps the exported namespace out of the calling shell.
  (
    export XDG_CONFIG_HOME="$HOME/.config/opencode-v1-$profile"
    export XDG_DATA_HOME="$HOME/.local/share/opencode-v1-$profile"
    export XDG_STATE_HOME="$HOME/.local/state/opencode-v1-$profile"
    export XDG_CACHE_HOME="$HOME/.cache/opencode-v1-$profile"
    export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}"
    export OPENCODE_EXPERIMENTAL_WEBSOCKETS=true

    local _opencode_attach_args=()
    if _opencode_v1_attachable_tui "$@" && _opencode_v1_attach_args "$@"; then
      systemctl --user start "opencode-v1-$profile.service" || {
        printf 'opencode: could not start V1 %s service\n' "$profile" >&2
        exit 1
      }
      # `exec` runs an external program, so it bypasses the `opencode` alias and
      # these functions without needing `command`.
      exec opencode attach "http://127.0.0.1:$port" \
        "${_opencode_attach_args[@]}"
    fi

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
