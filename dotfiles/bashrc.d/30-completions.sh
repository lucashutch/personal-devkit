# Optional completions installed by external developer tools.
CELLX_BUILD_COMPLETION="$HOME/.cache/cellx_build.bash-completion"
if [ -r "$CELLX_BUILD_COMPLETION" ]; then
  . "$CELLX_BUILD_COMPLETION"
fi

NRFUTIL_COMPLETION="$HOME/.nrfutil/share/nrfutil-completion/scripts/bash/setup.bash"
if [ -r "$NRFUTIL_COMPLETION" ]; then
  . "$NRFUTIL_COMPLETION"
fi
