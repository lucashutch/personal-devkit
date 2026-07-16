# Activate a named virtual environment from ~/.venvs.
venv() {
  local name="$1"
  if [ -z "$name" ]; then
    echo "Usage: venv <environment>"
    return 1
  fi

  local path="$HOME/.venvs/$name/bin/activate"
  if [ ! -f "$path" ]; then
    echo "No venv found at: $path"
    return 1
  fi

  source "$path"
}

_venv_complete() {
  COMPREPLY=( $(compgen -d -- "$HOME/.venvs/${COMP_WORDS[COMP_CWORD]}") )
}
complete -F _venv_complete venv
