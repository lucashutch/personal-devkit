#!/usr/bin/env bash
# Title each herdr tab from its first pane:
#   agent pane   -> the agent session name
#   other pane   -> the foreground program, or the directory name at a prompt

set -u

HERDR=${HERDR_BIN_PATH:-herdr}
POLL_SECONDS=${AUTO_TITLE_POLL_SECONDS:-2}
# The sidebar is 30 columns wide (herdr/config.toml), so a longer title is cut.
MAX_LENGTH=${AUTO_TITLE_MAX_LENGTH:-28}

declare -A applied
failures=0

truncate_title() {
  local title=$1
  if ((${#title} > MAX_LENGTH)); then
    title="${title:0:MAX_LENGTH-1}…"
  fi
  printf '%s' "$title"
}

# Print the title for one pane, given as a JSON object on stdin.
pane_title() {
  local pane agent label cwd pane_id shell_pid name
  pane=$(cat)
  agent=$(jq -r '.agent // empty' <<<"$pane")
  label=$(jq -r '.label // empty' <<<"$pane")
  if [[ -n $agent && -n $label ]]; then
    printf '%s' "$label"
    return
  fi

  pane_id=$(jq -r '.pane_id' <<<"$pane")
  cwd=$(jq -r '.foreground_cwd // .cwd // empty' <<<"$pane")
  # A foreground process other than the shell itself means a command is running.
  name=$("$HERDR" pane process-info --pane "$pane_id" 2>/dev/null </dev/null |
    jq -r '.result.process_info as $p
      | ($p.foreground_processes // [])
      | map(select(.pid != $p.shell_pid))
      | .[0].name // empty')
  if [[ -n $name ]]; then
    printf '%s' "$name"
  elif [[ -n $cwd ]]; then
    printf '%s' "${cwd##*/}"
  fi
}

while :; do
  if ! panes=$("$HERDR" pane list 2>/dev/null) || [[ -z $panes ]]; then
    ((++failures >= 5)) && exit 0
    sleep "$POLL_SECONDS"
    continue
  fi
  failures=0

  # The first pane of each tab, in layout order.
  while IFS= read -r pane; do
    tab_id=$(jq -r '.tab_id' <<<"$pane")
    title=$(truncate_title "$(pane_title <<<"$pane")")
    [[ -z $title || ${applied[$tab_id]:-} == "$title" ]] && continue
    if "$HERDR" tab rename "$tab_id" "$title" </dev/null >/dev/null 2>&1; then
      applied[$tab_id]=$title
    fi
  done < <(jq -c '.result.panes | unique_by(.tab_id) | .[]' <<<"$panes")

  sleep "$POLL_SECONDS"
done
