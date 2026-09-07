import json
import os
import re
import shutil
import subprocess
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
    bad = subprocess.run(
        ["bash", str(ROOT / "claude/statusline-command.sh")],
        input="{",
        text=True,
        capture_output=True,
        check=False,
    )
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


def test_theme_has_no_background_override():
    theme = json.loads((ROOT / "claude/themes/one-dark.json").read_text())
    assert "background" not in theme["overrides"]


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
                            input="{", text=True, capture_output=True, cwd=cwd, env=env,
                            check=False)
    plain = re.sub(r"\x1b\[[0-9;]*m", "", result.stdout)
    assert result.returncode == 0
    assert ("jq missing" if missing_jq else "invalid input") in plain
    assert not any(ord(char) < 32 or ord(char) == 127 for char in plain)
