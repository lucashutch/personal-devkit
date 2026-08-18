# Shared PATH helpers and developer tool locations.
path_prepend() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1:$PATH" ;;
  esac
}

# bun
export BUN_INSTALL="$HOME/.bun"
path_prepend "$BUN_INSTALL/bin"

# Language and local tool installations.
path_prepend "$HOME/.cargo/bin"
path_prepend "/opt/gcc-arm/bin"
path_prepend "/opt/pi/arm-linux-gnueabihf/bin"
path_prepend "/opt/gcc-arm-13_2_1/bin"
path_prepend "$HOME/go/bin"
path_prepend "$HOME/.lmstudio/bin"
path_prepend "$HOME/.npm-global/bin"

# Managed Node.js LTS and other locally linked binaries; keep last so it wins.
path_prepend "$HOME/.local/bin"
