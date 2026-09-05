#!/usr/bin/env bash

input=$(cat)

# Cache only the git lookups (toplevel + branch), keyed by directory. The line
# itself is always re-rendered so model/context/rate values stay live.
# CLAUDE_STATUSLINE_GIT_CACHE_SECONDS=0 disables caching entirely.
git_cache_seconds=${CLAUDE_STATUSLINE_GIT_CACHE_SECONDS:-5}
git_cache_dir=${XDG_CACHE_HOME:-$HOME/.cache}/claude/statusline

git_branch() {
    local dir=$1 branch
    branch=$(git -C "$dir" --no-optional-locks branch --show-current 2>/dev/null || true)
    [ -n "$branch" ] || branch=$(git -C "$dir" --no-optional-locks rev-parse --short HEAD 2>/dev/null || true)
    printf '%s' "$branch"
}

# Emit NUL-delimited fields so tabs and newlines in paths survive caching.
write_git_info() {
    printf '%s\0%s\0' \
        "$(git -C "$1" --no-optional-locks rev-parse --show-toplevel 2>/dev/null)" \
        "$(git_branch "$1")"
}

git_info() {
    local dir=$1 key cache_file now mtime
    if ! [[ $git_cache_seconds =~ ^[0-9]+$ ]] || [ "$git_cache_seconds" -eq 0 ]; then
        write_git_info "$dir"
        return
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        key=$(printf '%s' "$dir" | sha256sum | cut -d' ' -f1)
    else
        key=$(printf '%s' "$dir" | cksum | tr -d ' ')
    fi
    cache_file=$git_cache_dir/git-v2-$key
    if [ -f "$cache_file" ]; then
        mtime=$(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file" 2>/dev/null || printf 0)
        now=$(date +%s)
        if [ $((now - mtime)) -lt "$git_cache_seconds" ]; then
            cat "$cache_file"
            return
        fi
    fi

    if mkdir -p "$git_cache_dir" 2>/dev/null &&
        write_git_info "$dir" >"$cache_file.$$" 2>/dev/null; then
        cat "$cache_file.$$"
        mv "$cache_file.$$" "$cache_file" 2>/dev/null
    else
        write_git_info "$dir"
    fi
}

# Show the full cwd inside a git repo.
# Outside a git repo: show ~ for $HOME, else "parent/base" (last two segments).
compact_path() {
    local p=$1
    local toplevel=$2
    if [ -n "$toplevel" ]; then
        truncate_path "$p"
        return
    fi

    if [ "$p" = "$HOME" ]; then
        printf '~'
        return
    fi
    case "$p" in
        "$HOME"/*)
            p="~/${p#"$HOME"/}"
            ;;
    esac
    local base parent
    base=$(basename "$p")
    parent=$(dirname "$p")
    parent=$(basename "$parent")
    if [ "$parent" = "/" ] || [ "$parent" = "." ] || [ "$parent" = "~" ]; then
        printf '%s' "$p"
    else
        truncate_path "$parent/$base"
    fi
}

truncate_path() {
    local p=$1 width=${COLUMNS:-0} keep
    [[ $width =~ ^[0-9]+$ ]] || width=0
    keep=$((width / 3)); [ "$keep" -ge 24 ] || keep=24
    if [ "$width" -gt 0 ] && [ ${#p} -gt "$keep" ]; then
        printf '…%s' "${p: -$((keep - 1))}"
    else
        printf '%s' "$p"
    fi
}

sanitize() { printf '%s' "$1" | tr '\000-\037\177' ' '; }

fallback_path() {
    local dir=$1 top
    IFS= read -r -d '' top < <(git_info "$dir")
    compact_path "$(sanitize "$dir")" "$top"
}

if ! command -v jq >/dev/null 2>&1; then
    printf '\033[01;34m%s\033[00m' "$(fallback_path "$PWD")"
    printf ' \033[00;31mstatusline: jq missing\033[00m'
    exit 0
fi

# Extract all status data in one jq invocation to keep frequent refreshes cheap.
fields=()
while IFS= read -r -d '' field; do fields+=("$field"); done < <(
    jq -j '(
        .workspace.current_dir // .cwd // "",
        .model.display_name // "",
        .effort.level // "",
        .context_window.used_percentage // "",
        .context_window.total_input_tokens // "",
        .rate_limits.five_hour.used_percentage // "",
        .rate_limits.five_hour.resets_at // "",
        .rate_limits.seven_day.used_percentage // "",
        .rate_limits.seven_day.resets_at // "",
        .rate_limits.spend_limit.used_percentage // ""
    ) | tostring, "\u0000"' <<<"$input" 2>/dev/null
)

if [ "${#fields[@]}" -ne 10 ]; then
    printf '\033[01;34m%s\033[00m' "$(fallback_path "$PWD")"
    printf ' \033[00;31mstatusline: invalid input\033[00m'
    exit 0
fi

cwd=${fields[0]:-$PWD}
model=$(sanitize "${fields[1]}")
effort=$(sanitize "${fields[2]}")
used=${fields[3]}
total_tokens=${fields[4]}
five_pct=${fields[5]}
five_reset=${fields[6]}
week_pct=${fields[7]}
week_reset=${fields[8]}
spend_pct=${fields[9]}

# Git toplevel/branch (avoid optional locks and fail quietly outside a repo).
{
    IFS= read -r -d '' toplevel
    IFS= read -r -d '' branch
} < <(git_info "$cwd")
display_cwd=$(sanitize "$cwd")
branch=$(sanitize "$branch")

# Context usage, shown as a plain percentage (no bar).
if [[ $used =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    used_rounded=$(printf '%.0f' "$used")

    token_str=""
    if [[ $total_tokens =~ ^[0-9]+$ ]] && [ "$total_tokens" -gt 0 ]; then
        tokens_k=$(((total_tokens + 500) / 1000))
        token_str=" (${tokens_k}k)"
    fi
    ctx_str=" ${used_rounded}%${token_str}"
else
    ctx_str=""
fi

# Claude.ai subscription rate-limit usage, when supplied by Claude Code.
rate_str=""
if [[ $five_pct =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    rate_str="5h:$(printf '%.0f' "$five_pct")%"
    if [[ $five_reset =~ ^[0-9]+$ ]]; then
        reset_str=$(date -d "@$five_reset" +'%I:%M%p' 2>/dev/null || date -r "$five_reset" +'%I:%M%p' 2>/dev/null || true)
        reset_str=$(printf '%s' "$reset_str" | tr '[:upper:]' '[:lower:]')
        reset_str=${reset_str#0}
        [ -n "$reset_str" ] && rate_str+=" (${reset_str})"
    fi
fi
if [[ $week_pct =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    [ -n "$rate_str" ] && rate_str+=" "
    rate_str+="7d:$(printf '%.0f' "$week_pct")%"
    if [[ $week_reset =~ ^[0-9]+$ ]]; then
        reset_str=$(date -d "@$week_reset" +'%a %I:%M%p' 2>/dev/null || date -r "$week_reset" +'%a %I:%M%p' 2>/dev/null || true)
        reset_str=$(printf '%s' "$reset_str" | tr '[:upper:]' '[:lower:]')
        reset_str=${reset_str/ 0/ }
        [ -n "$reset_str" ] && rate_str+=" (${reset_str})"
    fi
fi
if [[ $spend_pct =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    [ -n "$rate_str" ] && rate_str+=" "
    rate_str+="spend:$(printf '%.0f' "$spend_pct")%"
fi

warning=false
for pct in "$used" "$five_pct" "$week_pct" "$spend_pct"; do
    [[ $pct =~ ^[0-9]+([.][0-9]+)?$ ]] && [ "${pct%.*}" -ge 80 ] && warning=true
done

render_statusline() {
    printf '\033[01;34m%s\033[00m' "$(compact_path "$display_cwd" "$toplevel")"
    [ -n "$branch" ] && printf ' \033[02;36m(%s)\033[00m' "$branch"
    [ -n "$model" ] && printf ' \033[00;33m%s\033[00m' "$model"
    [ -n "$effort" ] && printf ' \033[00;35mthinking:%s\033[00m' "$effort"
    if [ "$warning" = true ]; then color='\033[00;33m'; else color='\033[00;36m'; fi
    [ -n "$ctx_str" ] && printf ' %b%s\033[00m' "$color" "$ctx_str"
    [ -n "$rate_str" ] && printf ' %b%s\033[00m' "$color" "$rate_str"
}

render_statusline
exit 0
