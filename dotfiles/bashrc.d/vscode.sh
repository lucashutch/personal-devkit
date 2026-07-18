# Windows PATH import is deliberately disabled in /etc/wsl.conf. On WSL,
# expose only VS Code's launcher; native Linux shells must remain untouched.
if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
  _vscode_bin='/mnt/c/Program Files/Microsoft VS Code/bin'
  if [ -x "$_vscode_bin/code" ] && [[ ":$PATH:" != *":$_vscode_bin:"* ]]; then
    export PATH="$PATH:$_vscode_bin"
  fi
  unset _vscode_bin
fi
