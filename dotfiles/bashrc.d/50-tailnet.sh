# Quickly switch between Tailscale tailnets.
tailnet() {
  case "$1" in
    home)
      echo "Switching to HOME Tailnet (${TAILNET_HOME_ACCOUNT})..."
      sudo tailscale switch ${TAILNET_HOME_ACCOUNT}
      ;;
    work)
      echo "Switching to WORK Tailnet (${TAILNET_WORK_ACCOUNT})..."
      sudo tailscale switch ${TAILNET_WORK_ACCOUNT}
      ;;
    *)
      echo "Usage: tailnet [home|work]"
      sudo tailscale switch --list
      ;;
  esac
}
