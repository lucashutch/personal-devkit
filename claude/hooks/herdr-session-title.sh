#!/bin/sh
# Keep HerdR tab labels in sync with the Claude Code session.
#
# Claude Code has no AI-generated session title (its transcripts carry no
# summary entry until compaction), so the session's first human prompt is used,
# which is also what `/resume` lists. The label is therefore stable for the
# life of a session and safe to resend on every prompt.
#
# This is a companion to the herdr-managed herdr-agent-state.sh; keep it in a
# separate file so reinstalling the Herdr integration does not overwrite it.

set -eu

[ "${HERDR_ENV:-}" = "1" ] || exit 0
[ -n "${HERDR_SOCKET_PATH:-}" ] || exit 0
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

hook_input_file="$(mktemp "${TMPDIR:-/tmp}/herdr-claude-title.XXXXXX")" || exit 0
trap 'rm -f "$hook_input_file"' EXIT HUP INT TERM
cat >"$hook_input_file" 2>/dev/null || true

HERDR_HOOK_INPUT_FILE="$hook_input_file" python3 - <<'PY' || exit 0
import json
import os
import random
import socket
import time

SOURCE = "herdr:claude-session-title"
MAX_LABEL = 48

pane_id = os.environ.get("HERDR_PANE_ID")
socket_path = os.environ.get("HERDR_SOCKET_PATH")
if not pane_id or not socket_path:
    raise SystemExit(0)

try:
    with open(os.environ["HERDR_HOOK_INPUT_FILE"], encoding="utf-8") as handle:
        hook_input = json.loads(handle.read() or "{}")
except Exception:
    hook_input = {}
if not isinstance(hook_input, dict):
    raise SystemExit(0)

# Subagent hook payloads carry an agent_id; only the main session names the tab.
if hook_input.get("agent_id"):
    raise SystemExit(0)


def first_human_prompt(path):
    """Returns the first typed prompt in a transcript, ignoring tool results."""
    if not isinstance(path, str) or not path:
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                if entry.get("type") != "user" or entry.get("isSidechain"):
                    continue
                content = entry.get("message", {}).get("content")
                if isinstance(content, str) and content.strip():
                    return content
    except Exception:
        return None
    return None


def label_for(text):
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())
    if not text or text.startswith("/") or text.startswith("<"):
        return None
    if len(text) <= MAX_LABEL:
        return text
    clipped = text[:MAX_LABEL]
    space = clipped.rfind(" ")
    if space > MAX_LABEL // 2:
        clipped = clipped[:space]
    return clipped.rstrip(" ,.;:-") + "…"


label = label_for(first_human_prompt(hook_input.get("transcript_path")))
if not label:
    # The first prompt of a session is not in the transcript yet at
    # UserPromptSubmit time, so fall back to the incoming prompt.
    label = label_for(hook_input.get("prompt"))
if not label:
    raise SystemExit(0)


def request(method, params):
    message = {
        "id": f"{SOURCE}:{int(time.time() * 1000)}:{random.randrange(1_000_000):06d}",
        "method": method,
        "params": {
            "pane_id": pane_id,
            "source": SOURCE,
            "seq": time.time_ns(),
            **params,
        },
    }
    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(0.5)
        client.connect(socket_path)
        client.sendall((json.dumps(message) + "\n").encode())
        response = b""
        try:
            while b"\n" not in response:
                chunk = client.recv(4096)
                if not chunk:
                    break
                response += chunk
        except Exception:
            pass
        client.close()
        return json.loads(response.decode() or "{}")
    except Exception:
        return {}


tab_id = request("pane.get", {}).get("result", {}).get("pane", {}).get("tab_id")
if tab_id:
    request("tab.rename", {"tab_id": tab_id, "label": label})
PY
