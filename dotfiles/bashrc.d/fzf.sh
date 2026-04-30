# FZF prompt
# Login shells source ~/.bashrc from ~/.profile before ~/.profile adds
# ~/.local/bin to PATH. Make sure locally installed fzf is discoverable when
# this snippet runs during terminal startup.
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

if command -v fzf >/dev/null 2>&1; then
  eval "$(fzf --bash)"
fi
