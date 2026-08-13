# Quickly switch between Tailscale tailnets.
# Accounts are personal data, so they come from the environment. Set
# TAILNET_HOME_ACCOUNT and TAILNET_WORK_ACCOUNT outside this repository.
tailnet() {
  local target account
  case "$1" in
    home) target="HOME" account="$TAILNET_HOME_ACCOUNT" ;;
    work) target="WORK" account="$TAILNET_WORK_ACCOUNT" ;;
    *)
      echo "Usage: tailnet [home|work]"
      sudo tailscale switch --list
      return 0
      ;;
  esac

  if [ -z "$account" ]; then
    echo "tailnet: TAILNET_${target}_ACCOUNT is not set." >&2
    echo "tailnet: export it in a local, unmanaged shell file before switching." >&2
    return 1
  fi

  echo "Switching to $target Tailnet ($account)..."
  sudo tailscale switch "$account"
}
