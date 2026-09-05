import json
import os
import subprocess
import re
import shutil
import socket
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]


def run_status(payload, **env):
    return subprocess.run(
        ["bash", str(ROOT / "claude/statusline-command.sh")],
        input=json.dumps(payload), text=True, capture_output=True,
        env={**os.environ, "CLAUDE_STATUSLINE_GIT_CACHE_SECONDS": "0", **env},
        check=False,
    )


def test_statusline_without_rate_limits_succeeds_and_sanitizes():
    result = run_status({
        "workspace": {"current_dir": "/tmp/bad\npath"},
        "model": {"display_name": "Opus\033[31m"},
        "effort": {"level": "low"},
        "context_window": {"used_percentage": 20, "total_input_tokens": 12000},
    })
    assert result.returncode == 0
    assert "Opus [31m" in result.stdout
    assert "20% (12k)" in result.stdout
    assert " \033[00;36m 20% (12k)\033[00m" in result.stdout


def test_statusline_malformed_input_and_narrow_path():
    bad = subprocess.run(["bash", str(ROOT / "claude/statusline-command.sh")], input="{", text=True, capture_output=True)
    assert bad.returncode == 0
    assert "invalid input" in bad.stdout
    narrow = run_status({"cwd": "/one/" + "very-long-directory-name-" * 3}, COLUMNS="30")
    assert "…" in narrow.stdout


def test_statusline_detached_head_uses_short_sha(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "Test"], check=True)
    (tmp_path / "x").write_text("x")
    subprocess.run(["git", "-C", str(tmp_path), "add", "x"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-qm", "x"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "checkout", "-q", "--detach"], check=True)
    sha = subprocess.check_output(["git", "-C", str(tmp_path), "rev-parse", "--short", "HEAD"], text=True).strip()
    assert f"({sha})" in run_status({"cwd": str(tmp_path)}).stdout


def test_settings_keep_explicit_risk_and_effort_choices():
    settings = json.loads((ROOT / "claude/settings.json").read_text())
    assert settings["permissions"]["defaultMode"] == "bypassPermissions"
    assert settings["skipDangerousModePermissionPrompt"] is True
    assert settings["effortLevel"] == "low"
    assert "CLAUDE_CONFIG_DIR" in settings["statusLine"]["command"]


def test_title_child_isolated_and_theme_has_no_background_override():
    hook = (ROOT / "claude/hooks/herdr-session-title.sh").read_text()
    for flag in ("--tools", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"):
        assert flag in hook
    theme = json.loads((ROOT / "claude/themes/one-dark.json").read_text())
    assert "background" not in theme["overrides"]


def test_title_generator_executes_isolated_and_retries_partial_transcript(tmp_path):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text('{"type":"user"}')  # deliberately incomplete JSONL record
    capture = tmp_path / "argv"
    fake = tmp_path / "claude"
    fake.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >"{capture}"\nprintf "Useful Title\\n"\n')
    fake.chmod(0o755)
    session = "test-session"
    env = {
        **os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "TMPDIR": str(tmp_path),
        "CLAUDE_CONFIG_DIR": str(tmp_path / "config"), "HERDR_ENV": "1",
        "HERDR_SOCKET_PATH": str(tmp_path / "missing.sock"), "HERDR_PANE_ID": "pane",
        "HERDR_TITLE_SESSION": session, "HERDR_TITLE_TRANSCRIPT": str(transcript),
        "HERDR_TITLE_TEXT": "Fix the parser", "HERDR_TITLE_ACTION": "generate",
    }
    result = subprocess.run(["sh", str(ROOT / "claude/hooks/herdr-session-title.sh"), "generate"], env=env)
    assert result.returncode == 0
    argv = capture.read_text()
    assert "--setting-sources\n\n" in argv
    assert "--tools\n\n" in argv
    assert transcript.read_text() == '{"type":"user"}'
    assert not (tmp_path / f"herdr-claude-title-{session}").exists()


@pytest.mark.parametrize("cache_seconds", ["0", "60"])
def test_statusline_branch_in_control_character_path(tmp_path, cache_seconds):
    repo = tmp_path / "repo\twith\nlines"
    subprocess.run(["git", "init", "-q", "-b", "fixture-branch", str(repo)], check=True)
    env = {"XDG_CACHE_HOME": str(tmp_path / "cache"), "CLAUDE_STATUSLINE_GIT_CACHE_SECONDS": cache_seconds}
    for model in ("First", "Second"):
        result = run_status({"cwd": str(repo), "model": {"display_name": model}}, **env)
        assert result.returncode == 0
        assert "(fixture-branch)" in result.stdout
        assert model in result.stdout
        assert "repo with lines" in result.stdout
        assert "\n" not in result.stdout and "\t" not in result.stdout
    if cache_seconds != "0":
        cached = next((tmp_path / "cache/claude/statusline").glob("git-v2-*"))
        assert cached.read_bytes().split(b"\0")[1] == b"fixture-branch"


@pytest.mark.parametrize("missing_jq", [False, True])
def test_statusline_fallback_sanitizes_path(tmp_path, missing_jq):
    cwd = tmp_path / "bad\npath\t\033"
    cwd.mkdir()
    env = {**os.environ, "CLAUDE_STATUSLINE_GIT_CACHE_SECONDS": "0"}
    if missing_jq:
        bins = tmp_path / "bin"
        bins.mkdir()
        for name in ("cat", "git", "tr", "basename", "dirname"):
            (bins / name).symlink_to(shutil.which(name))
        env["PATH"] = str(bins)
    result = subprocess.run([shutil.which("bash"), str(ROOT / "claude/statusline-command.sh")],
                            input="{", text=True, capture_output=True, cwd=cwd, env=env)
    plain = re.sub(r"\x1b\[[0-9;]*m", "", result.stdout)
    assert result.returncode == 0
    assert ("jq missing" if missing_jq else "invalid input") in plain
    assert not any(ord(char) < 32 or ord(char) == 127 for char in plain)


@pytest.fixture
def title_fixture(tmp_path):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text('{"type":"user","message":{"content":"Fix parser"}}\n')
    config = tmp_path / "config"
    (config / "sessions").mkdir(parents=True)
    fake = tmp_path / "claude"
    fake.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
mode = os.environ.get('FIXTURE_MODE')
if mode == 'fail':
    sys.exit(1)
if mode == 'custom':
    with open(os.environ['HERDR_TITLE_TRANSCRIPT'], 'a') as handle:
        handle.write(json.dumps({'type': 'custom-title', 'customTitle': 'Manual', 'sessionId': 'session'}) + '\\n')
if mode == 'explicit':
    (Path(os.environ['CLAUDE_CONFIG_DIR']) / 'sessions/live.json').write_text(json.dumps({'sessionId': 'session', 'nameSource': 'user', 'name': 'Manual'}))
print('Generated Title')
""")
    fake.chmod(0o755)
    # All control traffic stays on this fixture's local socket.
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    address = str(tmp_path / "control.sock")
    server.bind(address)
    server.listen()
    server.settimeout(0.05)
    messages = []
    pane = {"tab_id": "tab", "agent_session_id": "session"}
    stop = threading.Event()

    def serve():
        while not stop.is_set():
            try:
                client, _ = server.accept()
            except socket.timeout:
                continue
            with client:
                data = b""
                while b"\n" not in data:
                    data += client.recv(4096)
                message = json.loads(data)
                messages.append(message)
                client.sendall((json.dumps({"result": {"pane": pane}}) + "\n").encode())

    thread = threading.Thread(target=serve)
    thread.start()
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "TMPDIR": str(tmp_path),
           "CLAUDE_CONFIG_DIR": str(config), "HERDR_ENV": "1", "HERDR_SOCKET_PATH": address,
           "HERDR_PANE_ID": "pane", "HERDR_TITLE_SESSION": "session",
           "HERDR_TITLE_TRANSCRIPT": str(transcript), "HERDR_TITLE_TEXT": "Fix parser"}

    def run(mode="", action="generate"):
        return subprocess.run(["sh", str(ROOT / "claude/hooks/herdr-session-title.sh"), action],
                              env={**env, "FIXTURE_MODE": mode}, capture_output=True, text=True,
                              input=json.dumps({"session_id": "session", "transcript_path": str(transcript),
                                                "hook_event_name": "UserPromptSubmit"}), timeout=10)

    yield run, transcript, messages, pane, tmp_path / "herdr-claude-title-session"
    stop.set()
    thread.join(timeout=2)
    server.close()


@pytest.mark.parametrize("mode", ["custom", "explicit"])
def test_late_manual_title_prevents_generated_rename(title_fixture, mode):
    run, transcript, messages, _, _ = title_fixture
    assert run(mode).returncode == 0
    assert '"aiTitle":"Generated Title"' in transcript.read_text()
    assert not any(message["method"] == "tab.rename" for message in messages)


@pytest.mark.parametrize("session", ["other-session", None, "session"])
def test_late_title_requires_exact_current_session(title_fixture, session):
    run, _, messages, pane, _ = title_fixture
    pane["agent_session_id"] = session
    assert run().returncode == 0
    labels = [message["params"]["label"] for message in messages if message["method"] == "tab.rename"]
    assert labels == (["Generated Title"] if session == "session" else [])


def test_failed_generation_retries_on_later_prompt(title_fixture):
    run, transcript, messages, _, marker = title_fixture
    marker.touch()
    assert run("fail").returncode == 0
    assert not marker.exists()
    assert "ai-title" not in transcript.read_text()
    assert run(action="title").returncode == 0
    wait_for_generated_title(transcript, messages)


def wait_for_generated_title(transcript, messages):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if any(message["method"] == "tab.rename" and message["params"]["label"] == "Generated Title"
               for message in messages):
            assert transcript.read_text().count('"type":"ai-title"') == 1
            return
        time.sleep(0.02)
    pytest.fail("stub generation did not finish")


def test_stale_generation_claim_is_retried(title_fixture):
    run, transcript, messages, _, marker = title_fixture
    marker.touch()
    assert run(action="title").returncode == 0
    assert "ai-title" not in transcript.read_text()
    os.utime(marker, (time.time() - 180, time.time() - 180))
    assert run(action="title").returncode == 0
    wait_for_generated_title(transcript, messages)
