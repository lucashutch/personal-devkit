#!/usr/bin/env bash
set -euo pipefail

force=false
if [[ "${1:-}" == "--force" ]]; then
  force=true
  shift
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--force]" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
source_dir="$repo_root/opencode"
target_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

entries=(
  home.json
  work.json
  opencode.json
  tui.json
  commands
  plugins
  agents
)

[[ -d "$source_dir" ]] || { echo "Missing source directory: $source_dir" >&2; exit 1; }
mkdir -p "$target_dir"

for entry in "${entries[@]}"; do
  src="$source_dir/$entry"
  dst="$target_dir/$entry"

  [[ -e "$src" ]] || { echo "Missing source: $src" >&2; exit 1; }

  if [[ -L "$dst" ]]; then
    current="$(readlink -- "$dst")"
    if [[ "$current" == "$src" ]]; then
      echo "ok: $dst -> $src"
      continue
    fi

    if [[ "$force" == true ]]; then
      rm -- "$dst"
    else
      echo "error: $dst is already a symlink to $current (use --force to replace)" >&2
      exit 1
    fi
  elif [[ -e "$dst" ]]; then
    if [[ "$force" == true ]]; then
      rm -rf -- "$dst"
    else
      echo "error: $dst already exists and is not a symlink (use --force to replace)" >&2
      exit 1
    fi
  fi

  ln -s -- "$src" "$dst"
  echo "linked: $dst -> $src"
done

echo "All OpenCode config symlinks are correct."
