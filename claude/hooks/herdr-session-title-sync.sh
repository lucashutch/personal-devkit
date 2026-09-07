#!/bin/sh
# Sync Claude Code's native session title to the owning HerdR tab.

set -eu

[ "${HERDR_ENV:-}" = "1" ] || exit 0
[ -n "${HERDR_SOCKET_PATH:-}" ] || exit 0
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

hook_input_file="$(mktemp "${TMPDIR:-/tmp}/herdr-claude-title-sync.XXXXXX")" || exit 0
trap 'rm -f "$hook_input_file"' EXIT HUP INT TERM
cat >"$hook_input_file" 2>/dev/null || true

HERDR_HOOK_INPUT_FILE="$hook_input_file" python3 - <<'PY' || exit 0
import json
import os
import random
import socket
import time
from pathlib import Path

SOURCE = "herdr:claude-title-sync"
MAX_LABEL = 48


def clean(value):
    if not isinstance(value, str):
        return None
    value = " ".join(value.split()).strip('"')
    if not value:
        return None
    if len(value) <= MAX_LABEL:
        return value
    clipped = value[:MAX_LABEL]
    space = clipped.rfind(" ")
    if space > MAX_LABEL // 2:
        clipped = clipped[:space]
    return clipped.rstrip(" ,.;:-") + "…"


def request(method, params):
    message = {
        "id": f"{SOURCE}:{int(time.time() * 1000)}:{random.randrange(1_000_000):06d}",
        "method": method,
        "params": {
            "pane_id": os.environ["HERDR_PANE_ID"],
            "source": SOURCE,
            "seq": time.time_ns(),
            **params,
        },
    }
    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(0.5)
        client.connect(os.environ["HERDR_SOCKET_PATH"])
        client.sendall((json.dumps(message) + "\n").encode())
        response = b""
        while b"\n" not in response:
            chunk = client.recv(4096)
            if not chunk:
                break
            response += chunk
        client.close()
        return json.loads(response.decode() or "{}")
    except Exception:
        return {}


try:
    hook_input = json.loads(Path(os.environ["HERDR_HOOK_INPUT_FILE"]).read_text() or "{}")
except Exception:
    raise SystemExit(0)

if hook_input.get("agent_id"):
    raise SystemExit(0)
session_id = hook_input.get("session_id")
transcript = hook_input.get("transcript_path")
if not isinstance(session_id, str) or not isinstance(transcript, str):
    raise SystemExit(0)

custom = ai = None
try:
    with open(transcript, encoding="utf-8") as handle:
        for line in handle:
            if '-title"' not in line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if entry.get("sessionId") != session_id:
                continue
            if entry.get("type") == "custom-title":
                custom = clean(entry.get("customTitle")) or custom
            elif entry.get("type") == "ai-title":
                ai = clean(entry.get("aiTitle")) or ai
except OSError:
    raise SystemExit(0)

label = custom or ai
if not label:
    raise SystemExit(0)
pane = request("pane.get", {}).get("result", {}).get("pane", {})
reported_session = pane.get("agent_session_id")
if not reported_session and isinstance(pane.get("agent_session"), dict):
    reported_session = pane["agent_session"].get("value")
if reported_session == session_id and pane.get("tab_id"):
    request("tab.rename", {"tab_id": pane["tab_id"], "label": label})
PY
