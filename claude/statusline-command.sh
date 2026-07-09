#!/usr/bin/env bash
input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd')
user=$(whoami)
host=$(hostname -s)
model=$(echo "$input" | jq -r '.model.display_name // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
total_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')

# Build progress bar (10 chars wide)
if [ -n "$used" ]; then
    filled=$(printf '%.0f' "$(echo "$used / 10" | bc -l)")
    [ "$filled" -gt 10 ] && filled=10
    empty=$((10 - filled))
    bar=""
    for i in $(seq 1 "$filled"); do bar="${bar}#"; done
    for i in $(seq 1 "$empty"); do bar="${bar}-"; done
    if [ -n "$total_tokens" ] && [ "$total_tokens" -gt 0 ] 2>/dev/null; then
        tokens_k=$(printf '%.0fk' "$(echo "$total_tokens / 1000" | bc -l)")
        token_str=" (${tokens_k})"
    else
        token_str=""
    fi
    ctx_str=" [${bar}] $(printf '%.0f' "$used")%${token_str}"
else
    ctx_str=""
fi

printf '\033[01;32m%s@%s\033[00m:\033[01;34m%s\033[00m' "$user" "$host" "$cwd"
[ -n "$model" ] && printf ' \033[00;33m%s\033[00m' "$model"
[ -n "$effort" ] && printf ' \033[00;35mthinking:%s\033[00m' "$effort"
[ -n "$ctx_str" ] && printf ' \033[00;36m%s\033[00m' "$ctx_str"
