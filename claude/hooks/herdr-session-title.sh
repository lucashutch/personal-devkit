#!/bin/sh
# Keep HerdR tab labels in sync with the Claude Code session.
#
# Claude Code no longer generates session titles: it understands an "ai-title"
# transcript entry and stopped writing them around 2.1.220, so sessions fall
# back to their first prompt everywhere. This hook fills that gap by generating
# the title itself, and stores it the way Claude does rather than in a private
# cache, so `/resume` and the session pickers show it too.
#
# The generation half is a workaround; see ai-title-workaround.md next to this
# file for the evidence, how to check whether Claude does it again, and how to
# revert.
#
# Titles live in the transcript as one of the entries Claude already reads:
#
#   {"type":"custom-title","customTitle":...,"sessionId":...}   /rename
#   {"type":"ai-title","aiTitle":...,"sessionId":...}           generated
#
# The label follows Claude's own precedence (customTitle, then the explicit
# `claude -n` session name, then aiTitle, then the first typed prompt), so a
# manual /rename always wins over anything generated here.
#
# Generation runs once per session, in the background off the first prompt that
# is worth summarising, and renames the tab itself when it finishes, so no hook
# ever blocks on it. The tab therefore shows the raw prompt only for the few
# seconds the generating call takes.
#
# This is a companion to the herdr-managed herdr-agent-state.sh; keep it in a
# separate file so reinstalling the Herdr integration does not overwrite it.

set -eu

[ "${HERDR_ENV:-}" = "1" ] || exit 0
[ -n "${HERDR_SOCKET_PATH:-}" ] || exit 0
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

action="${1:-title}"
hook_input_file=""
if [ "$action" = "title" ]; then
  hook_input_file="$(mktemp "${TMPDIR:-/tmp}/herdr-claude-title.XXXXXX")" || exit 0
  trap 'rm -f "$hook_input_file"' EXIT HUP INT TERM
  cat >"$hook_input_file" 2>/dev/null || true
fi

HERDR_TITLE_ACTION="$action" HERDR_TITLE_SELF="$0" \
  HERDR_HOOK_INPUT_FILE="$hook_input_file" python3 - <<'PY' || exit 0
import json
import os
import random
import socket
import subprocess
import time
from pathlib import Path

SOURCE = "herdr:claude-session-title"
MAX_LABEL = 48
GENERATE_TIMEOUT = 90
PROMPT = (
    "Summarise this coding-session request as a tab title of at most 5 words. "
    "Use title case, no trailing punctuation, no quotes. Reply with the title only.\n\n"
)

action = os.environ.get("HERDR_TITLE_ACTION", "title")
pane_id = os.environ.get("HERDR_PANE_ID")
socket_path = os.environ.get("HERDR_SOCKET_PATH")
if not pane_id or not socket_path:
    raise SystemExit(0)

config_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def request(method, params):
    """Sends one Herdr control request and returns the decoded reply."""
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


def rename_tab(label):
    tab_id = request("pane.get", {}).get("result", {}).get("pane", {}).get("tab_id")
    if tab_id:
        request("tab.rename", {"tab_id": tab_id, "label": label})


def clean(text):
    """Normalises arbitrary text into a tab label, or returns None."""
    if not isinstance(text, str):
        return None
    text = " ".join(text.split()).strip('"')
    if not text or text.startswith("/") or text.startswith("<"):
        return None
    if len(text) <= MAX_LABEL:
        return text
    clipped = text[:MAX_LABEL]
    space = clipped.rfind(" ")
    if space > MAX_LABEL // 2:
        clipped = clipped[:space]
    return clipped.rstrip(" ,.;:-") + "…"


def stored_titles(path, session_id):
    """Returns (customTitle, aiTitle) for a session from its transcript."""
    custom = ai = None
    if not isinstance(path, str) or not path or not session_id:
        return (None, None)
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                # Cheap prefilter: both entry types contain `-title"`.
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
    except Exception:
        return (custom, ai)
    return (custom, ai)


def store_ai_title(path, session_id, title):
    """Appends an ai-title entry, the same record Claude reads for titles."""
    if not isinstance(path, str) or not path or not session_id:
        return
    entry = json.dumps(
        {"type": "ai-title", "aiTitle": title, "sessionId": session_id},
        separators=(",", ":"),
    )
    try:
        # A single append of one line: O_APPEND keeps it from interleaving with
        # the session's own writes. Only lead with a newline if the transcript
        # was left mid-line, which would otherwise corrupt the last entry.
        with open(path, "r+", encoding="utf-8") as handle:
            handle.seek(0, os.SEEK_END)
            if handle.tell():
                handle.seek(handle.tell() - 1)
                entry = ("" if handle.read(1) == "\n" else "\n") + entry
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(entry + "\n")
    except Exception:
        pass


def explicit_name(session_id):
    """Returns the session name only when the user set it.

    nameSource is one of "user" (`claude -n`, /rename), "auto" (a name Claude
    picked for a background job) or "derived" (from the cwd); only "user" is
    worth preferring over a generated title.
    """
    if not session_id:
        return None
    try:
        entries = sorted((config_dir / "sessions").glob("*.json"))
    except Exception:
        return None
    for entry in entries:
        try:
            record = json.loads(entry.read_text(encoding="utf-8"))
        except Exception:
            continue
        if record.get("sessionId") != session_id:
            continue
        if record.get("nameSource") != "user":
            return None
        return clean(record.get("name"))
    return None


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


if action == "generate":
    # Runs detached from the hook: ask a cheap model for a title, cache it, and
    # rename the tab. HERDR_ENV is cleared for the child so the nested session
    # cannot rename this tab or recurse into another generation.
    session_id = os.environ.get("HERDR_TITLE_SESSION", "")
    transcript = os.environ.get("HERDR_TITLE_TRANSCRIPT", "")
    text = os.environ.get("HERDR_TITLE_TEXT", "")
    if not session_id or not text.strip():
        raise SystemExit(0)
    environment = {k: v for k, v in os.environ.items() if k != "HERDR_ENV"}
    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku"],
            input=PROMPT + text[:2000],
            capture_output=True,
            text=True,
            timeout=GENERATE_TIMEOUT,
            env=environment,
        )
    except Exception:
        raise SystemExit(0)
    title = clean(result.stdout) if result.returncode == 0 else None
    if not title or "\n" in result.stdout.strip():
        raise SystemExit(0)
    store_ai_title(transcript, session_id, title)
    # A /rename during generation must not be overwritten by this late arrival.
    if stored_titles(transcript, session_id)[0] is None:
        rename_tab(title)
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

session_id = hook_input.get("session_id")
session_id = session_id if isinstance(session_id, str) else ""
transcript = hook_input.get("transcript_path")
transcript = transcript if isinstance(transcript, str) else ""

prompt = first_human_prompt(transcript)
if prompt is None:
    # The first prompt of a session is not in the transcript yet at
    # UserPromptSubmit time, so fall back to the incoming prompt.
    raw = hook_input.get("prompt")
    prompt = raw if isinstance(raw, str) else None

custom, ai = stored_titles(transcript, session_id)
name = explicit_name(session_id)
fallback = clean(prompt)

label = custom or name or ai or fallback
if label:
    rename_tab(label)

# Generate a real title from the first prompt worth summarising. Slash commands
# and the like are skipped by clean(), so a later prompt gets the chance.
if session_id and transcript and fallback and not (custom or name or ai):
    try:
        subprocess.Popen(
            ["sh", os.environ["HERDR_TITLE_SELF"], "generate"],
            env={
                **os.environ,
                "HERDR_TITLE_SESSION": session_id,
                "HERDR_TITLE_TRANSCRIPT": transcript,
                "HERDR_TITLE_TEXT": prompt,
            },
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception:
        pass
PY
