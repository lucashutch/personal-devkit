unalias sb 2>/dev/null
sb() {
  printf '%s\n' 'source "$HOME/.bashrc"'
  source "$HOME/.bashrc"
}
