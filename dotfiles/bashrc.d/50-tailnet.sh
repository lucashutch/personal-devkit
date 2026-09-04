# Quickly switch between Tailscale tailnets and toggle the exit node.
# Accounts are personal data, so they come from the environment. Set
# TAILNET_HOME_ACCOUNT and TAILNET_WORK_ACCOUNT outside this repository.
# TAILNET_EXIT_NODE optionally overrides the default exit node.
# Running without sudo needs `sudo tailscale set --operator="$USER"` per machine.
tailnet() {
  local target account
  case "$1" in
    home) target="HOME" account="$TAILNET_HOME_ACCOUNT" ;;
    work) target="WORK" account="$TAILNET_WORK_ACCOUNT" ;;
    exit)
      case "$2" in
        on)
          echo "Enabling exit node (${TAILNET_EXIT_NODE:-lucasfilms})..."
          tailscale set --exit-node="${TAILNET_EXIT_NODE:-lucasfilms}"
          return $?
          ;;
        off)
          echo "Disabling exit node..."
          tailscale set --exit-node=
          return $?
          ;;
      esac
      echo "Usage: tailnet exit [on|off]"
      return 0
      ;;
    *)
      echo "Usage: tailnet [home|work|exit]"
      tailscale switch --list
      return 0
      ;;
  esac

  if [ -z "$account" ]; then
    echo "tailnet: TAILNET_${target}_ACCOUNT is not set." >&2
    echo "tailnet: export it in a local, unmanaged shell file before switching." >&2
    return 1
  fi

  echo "Switching to $target Tailnet ($account)..."
  tailscale switch "$account"
}

_tailnet() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "home work exit" -- "$cur"))
  elif [ "$COMP_CWORD" -eq 2 ] && [ "$prev" = "exit" ]; then
    COMPREPLY=($(compgen -W "on off" -- "$cur"))
  fi
}

complete -F _tailnet tailnet
