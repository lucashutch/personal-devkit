#!/usr/bin/env bash
set -euo pipefail

force=false
link_opencode=false
link_dotfiles=false

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  -o, --opencode   Link OpenCode config (default if no target is selected)
  -d, --dotfiles   Link dotfiles config
  -a, --all        Link OpenCode config and dotfiles
      --force      Replace existing files/directories/symlinks
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      force=true
      ;;
    -o|--opencode)
      link_opencode=true
      ;;
    -d|--dotfiles)
      link_dotfiles=true
      ;;
    -a|--all)
      link_opencode=true
      link_dotfiles=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$link_opencode" == false && "$link_dotfiles" == false ]]; then
  link_opencode=true
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"

opencode_entries=(
  home.json
  work.json
  opencode.json
  tui.json
  commands
  plugins
  agents
)

dotfiles_entries=(
  starship.toml
  ghostty
  bashrc.d
)

worked=()
errored=()

link_entries() {
  local label="$1"
  local source_dir="$2"
  local target_dir="$3"
  shift 3

  if [[ ! -d "$source_dir" ]]; then
    msg="missing source directory: $source_dir"
    echo "error: $msg" >&2
    errored+=("$label ($msg)")
    return
  fi

  mkdir -p "$target_dir"

  local entry src dst current msg
  for entry in "$@"; do
    src="$source_dir/$entry"
    dst="$target_dir/$entry"

    if [[ ! -e "$src" ]]; then
      msg="missing source: $src"
      echo "error: $msg" >&2
      errored+=("$label/$entry ($msg)")
      continue
    fi

    if [[ -L "$dst" ]]; then
      current="$(readlink -- "$dst")"
      if [[ "$current" == "$src" ]]; then
        echo "ok: $dst -> $src"
        worked+=("$label/$entry (already linked)")
        continue
      fi

      if [[ "$force" == true ]]; then
        rm -- "$dst"
      else
        msg="$dst is already a symlink to $current (use --force to replace)"
        echo "error: $msg" >&2
        errored+=("$label/$entry ($msg)")
        continue
      fi
    elif [[ -e "$dst" ]]; then
      if [[ "$force" == true ]]; then
        rm -rf -- "$dst"
      else
        msg="$dst already exists and is not a symlink (use --force to replace)"
        echo "error: $msg" >&2
        errored+=("$label/$entry ($msg)")
        continue
      fi
    fi

    if ln -s -- "$src" "$dst"; then
      echo "linked: $dst -> $src"
      worked+=("$label/$entry (linked)")
    else
      msg="failed to link $dst -> $src"
      echo "error: $msg" >&2
      errored+=("$label/$entry ($msg)")
    fi
  done
}

if [[ "$link_opencode" == true ]]; then
  link_entries "opencode" "$repo_root/opencode" "$config_home/opencode" "${opencode_entries[@]}"
fi

if [[ "$link_dotfiles" == true ]]; then
  link_entries "dotfiles" "$repo_root/dotfiles" "$config_home" "${dotfiles_entries[@]}"
fi

echo
echo "Summary:"
if [[ ${#worked[@]} -gt 0 ]]; then
  echo "Worked:"
  printf '  - %s\n' "${worked[@]}"
else
  echo "Worked: none"
fi

if [[ ${#errored[@]} -gt 0 ]]; then
  echo "Errored:"
  printf '  - %s\n' "${errored[@]}"
  exit 1
else
  echo "Errored: none"
  echo "All selected config symlinks are correct."
fi
