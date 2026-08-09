# ChatGPT web search for OpenCode V1

This plugin adapts the search protocol from
[`opencode-chatgpt-websearch`](https://github.com/neriousy/opencode-chatgpt-websearch)
to OpenCode V1's custom-tool API. It reads the active profile's OpenAI ChatGPT
OAuth credential and refreshes expired credentials through OpenCode before
calling the same Codex search endpoint.

The tool is named `chatgpt_websearch`. OpenCode V1 reserves `websearch` for its
built-in provider-gated tool, so a custom tool with that ID is hidden for most
model providers.

The home and work profile configs allow this tool. Each profile must connect
OpenAI with ChatGPT login separately because their XDG data roots are isolated.

The upstream protocol is experimental and may change without notice.
