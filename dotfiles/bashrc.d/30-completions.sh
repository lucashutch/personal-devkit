# Optional completions installed by external developer tools.
CELLX_BUILD_COMPLETION="$HOME/.cache/cellx_build.bash-completion"
if [ -r "$CELLX_BUILD_COMPLETION" ]; then
  . "$CELLX_BUILD_COMPLETION"
fi

NRFUTIL_COMPLETION="$HOME/.nrfutil/share/nrfutil-completion/scripts/bash/setup.bash"
if [ -r "$NRFUTIL_COMPLETION" ]; then
  . "$NRFUTIL_COMPLETION"
fi

# OpenCode generates its completion script from the installed CLI.  Keep
# this conditional so shells remain usable before the CLI is installed.
if [ -n "$(type -P opencode2 2>/dev/null)" ]; then
  eval "$(opencode2 --completions bash 2>/dev/null)"
  # `opencode`, `oc`, and `oct` are shell wrappers, while the generated
  # script only registers the executable name.
  complete -F _opencode2 opencode oc oct opencode2 oc2 o2t
fi
