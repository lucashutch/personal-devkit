#!/usr/bin/env bash

input=$(cat)

# Cache only the git lookups (toplevel + branch), keyed by directory. The line
# itself is always re-rendered so model/context/rate values stay live.
# CLAUDE_STATUSLINE_GIT_CACHE_SECONDS=0 disables caching entirely.
git_cache_seconds=${CLAUDE_STATUSLINE_GIT_CACHE_SECONDS:-5}
git_cache_dir=${XDG_CACHE_HOME:-$HOME/.cache}/claude/statusline

# Echo "<toplevel>\t<branch>" for a directory, using a short-lived cache.
git_info() {
    local dir=$1 key cache_file now mtime data
    if ! [[ $git_cache_seconds =~ ^[0-9]+$ ]] || [ "$git_cache_seconds" -eq 0 ]; then
        printf '%s\t%s' \
            "$(git -C "$dir" --no-optional-locks rev-parse --show-toplevel 2>/dev/null)" \
            "$(git -C "$dir" --no-optional-locks branch --show-current 2>/dev/null)"
        return
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        key=$(printf '%s' "$dir" | sha256sum | cut -d' ' -f1)
    else
        key=$(printf '%s' "$dir" | cksum | tr -d ' ')
    fi
    cache_file=$git_cache_dir/git-$key
    if [ -f "$cache_file" ]; then
        mtime=$(stat -c %Y "$cache_file" 2>/dev/null || printf 0)
        now=$(date +%s)
        if [ $((now - mtime)) -lt "$git_cache_seconds" ]; then
            cat "$cache_file"
            return
        fi
    fi

    data=$(printf '%s\t%s' \
        "$(git -C "$dir" --no-optional-locks rev-parse --show-toplevel 2>/dev/null)" \
        "$(git -C "$dir" --no-optional-locks branch --show-current 2>/dev/null)")
    mkdir -p "$git_cache_dir" 2>/dev/null &&
        printf '%s' "$data" >"$cache_file.$$" 2>/dev/null &&
        mv "$cache_file.$$" "$cache_file" 2>/dev/null
    printf '%s' "$data"
}

# Show the full cwd inside a git repo.
# Outside a git repo: show ~ for $HOME, else "parent/base" (last two segments).
compact_path() {
    local p=$1
    local toplevel=$2
    if [ -n "$toplevel" ]; then
        printf '%s' "$p"
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
        printf '%s/%s' "$parent" "$base"
    fi
}

fallback_path() {
    local dir=$1 top
    IFS=$'\t' read -r top _ <<<"$(git_info "$dir")"
    compact_path "$dir" "$top"
}

if ! command -v jq >/dev/null 2>&1; then
    printf '\033[01;34m%s\033[00m' "$(fallback_path "$PWD")"
    printf ' \033[00;31mstatusline: jq missing\033[00m'
    exit 0
fi

# Extract all status data in one jq invocation to keep frequent refreshes cheap.
mapfile -t fields < <(
    jq -r '(
        .workspace.current_dir // .cwd // "",
        .model.display_name // "",
        .effort.level // "",
        .context_window.used_percentage // "",
        .context_window.total_input_tokens // "",
        .rate_limits.five_hour.used_percentage // "",
        .rate_limits.five_hour.resets_at // "",
        .rate_limits.seven_day.used_percentage // ""
    )' <<<"$input" 2>/dev/null
)

if [ "${#fields[@]}" -ne 8 ]; then
    printf '\033[01;34m%s\033[00m' "$(fallback_path "$PWD")"
    printf ' \033[00;31mstatusline: invalid input\033[00m'
    exit 0
fi

cwd=${fields[0]:-$PWD}
model=${fields[1]}
effort=${fields[2]}
used=${fields[3]}
total_tokens=${fields[4]}
five_pct=${fields[5]}
five_reset=${fields[6]}
week_pct=${fields[7]}

# Git toplevel/branch (avoid optional locks and fail quietly outside a repo).
IFS=$'\t' read -r toplevel branch <<<"$(git_info "$cwd")"

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
        reset_str=$(date -d "@$five_reset" +'%I:%M%P' 2>/dev/null || true)
        reset_str=${reset_str#0}
        [ -n "$reset_str" ] && rate_str+=" (${reset_str})"
    fi
fi
if [[ $week_pct =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    [ -n "$rate_str" ] && rate_str+=" "
    rate_str+="7d:$(printf '%.0f' "$week_pct")%"
fi

render_statusline() {
    printf '\033[01;34m%s\033[00m' "$(compact_path "$cwd" "$toplevel")"
    [ -n "$branch" ] && printf ' \033[02;36m(%s)\033[00m' "$branch"
    [ -n "$model" ] && printf ' \033[00;33m%s\033[00m' "$model"
    [ -n "$effort" ] && printf ' \033[00;35mthinking:%s\033[00m' "$effort"
    [ -n "$ctx_str" ] && printf ' \033[00;36m%s\033[00m' "$ctx_str"
    [ -n "$rate_str" ] && printf ' \033[02;36m%s\033[00m' "$rate_str"
}

render_statusline
