# Load machine-local environment. ~/.config/bashrc.d is a symlink into this
# repository, so private values must live outside it.
if [ -r "$HOME/.bashrc.local" ]; then
  . "$HOME/.bashrc.local"
fi
