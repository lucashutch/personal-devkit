# Quickly switch between Tailscale tailnets.
tailnet() {
  case "$1" in
    home)
      echo "Switching to HOME Tailnet (lucas.hutchinson@gmail.com)..."
      sudo tailscale switch lucas.hutchinson@gmail.com
      ;;
    work)
      echo "Switching to WORK Tailnet (lucas.hutchinson@myriota.com)..."
      sudo tailscale switch lucas.hutchinson@myriota.com
      ;;
    *)
      echo "Usage: tailnet [home|work]"
      sudo tailscale switch --list
      ;;
  esac
}
