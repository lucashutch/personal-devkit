#!/usr/bin/env bash
# Title each herdr tab from its first pane:
#   agent pane   -> the agent session name (the title the agent sets on its terminal,
#                   or the Claude Code transcript title while a resumed session is quiet)
#   other pane   -> the foreground program, or the directory name at a prompt

set -u

HERDR=${HERDR_BIN_PATH:-herdr}
POLL_SECONDS=${AUTO_TITLE_POLL_SECONDS:-2}
# The sidebar is 30 columns wide (herdr/config.toml), so a longer title is cut.
MAX_LENGTH=${AUTO_TITLE_MAX_LENGTH:-28}
# herdr can start this script before its socket is ready. Retry every 10 s
# after the first 5 failures, and give up after about 5 minutes.
MAX_FAILURES=35

declare -A applied
failures=0

# jq counts characters, not bytes, so the cut does not depend on the locale.
CUT='def cut: if length > $max then .[0:$max - 1] + "…" else . end;'

# Print the program running in the foreground of a pane, if it is not the shell.
foreground_program() {
  "$HERDR" pane process-info --pane "$1" 2>/dev/null </dev/null |
    jq -r --argjson max "$MAX_LENGTH" "$CUT"'
      .result.process_info as $p
      | ($p.foreground_processes // [])
      | map(select(.pid != $p.shell_pid))
      | (.[0].name // empty)
      | cut'
}

# Print the last title Claude Code saved for a session. A resumed session sets
# no terminal title until its first turn, so read the transcript instead.
transcript_title() {
  local file
  for file in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"$1".jsonl; do
    [[ -f $file ]] || continue
    tail -c 262144 "$file" |
      jq -R -r 'fromjson? | select(.type == "custom-title" or .type == "ai-title")
        | (.customTitle // .aiTitle // empty)' |
      tail -n 1 |
      jq -R -r --argjson max "$MAX_LENGTH" "$CUT"'select(. != "") | gsub("[[:cntrl:]]"; " ") | cut'
    return
  done
}

while :; do
  if ! panes=$("$HERDR" pane list 2>/dev/null) || [[ -z $panes ]]; then
    ((++failures >= MAX_FAILURES)) && exit 1
    # Tab ids can change if herdr restarted, so apply every title again.
    applied=()
    if ((failures >= 5)); then sleep 10; else sleep "$POLL_SECONDS"; fi
    continue
  fi
  failures=0

  # One jq pass for every tab. Each line holds the first pane of a tab in
  # `pane list` order, as six fields separated by the ASCII unit separator:
  # tab id, pane id, agent terminal title, directory name, Claude Code session
  # id, agent name. The last two are empty for a non-agent pane.
  while IFS=$'\x1f' read -r tab_id pane_id title dir_name session_id agent; do
    if [[ -z $title && -n $agent ]]; then
      [[ -n $session_id ]] && title=$(transcript_title "$session_id")
      [[ -z $title ]] && title=$agent
    fi
    if [[ -z $title ]]; then
      title=$(foreground_program "$pane_id")
      [[ -z $title ]] && title=$dir_name
    fi
    [[ -z $title || ${applied[$tab_id]:-} == "$title" ]] && continue
    if "$HERDR" tab rename "$tab_id" "$title" </dev/null >/dev/null 2>&1; then
      applied[$tab_id]=$title
    fi
  done < <(jq -r --argjson max "$MAX_LENGTH" "$CUT"'
    .result.panes
    | unique_by(.tab_id)[]
    | [ .tab_id,
        .pane_id,
        ((if .agent then .terminal_title_stripped else null end // "")
         | gsub("[[:cntrl:]]"; " ") | cut),
        ((.foreground_cwd // .cwd // "") | split("/") | last | cut),
        (if .agent == "claude" then .agent_session.value // "" else "" end),
        (.agent // "")
      ]
    | join("\u001f")' <<<"$panes")

  sleep "$POLL_SECONDS"
done
