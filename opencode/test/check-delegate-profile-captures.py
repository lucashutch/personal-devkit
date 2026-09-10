#!/usr/bin/env python3
"""Assert the captured V2 subagent schema and explicit model routing."""

import argparse
import json
from pathlib import Path


def requests(path: Path) -> list[dict[str, object]]:
    files = sorted(path.glob("*/request.raw.json"), key=lambda item: item.stat().st_mtime)
    if not files:
        raise AssertionError(f"no request.raw.json captures under {path}")
    return [json.loads(file.read_text()) for file in files]


def subagent(request: dict[str, object]) -> dict[str, object] | None:
    for tool in request.get("tools", []):
        function = tool.get("function", tool)
        if function.get("name") == "subagent":
            return function
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("capture_dir", type=Path)
    args = parser.parse_args()
    captured = requests(args.capture_dir)

    parent = next(
        request
        for request in captured
        if request.get("model") == "gpt-5.6-luna" and subagent(request) is not None
    )
    parameters = subagent(parent)["parameters"]
    assert parameters["properties"]["model"]["enum"] == ["luna", "sol", "astra", "muse", "glm", "inherit"]
    assert parameters["properties"]["effort"]["enum"] == ["low", "medium", "high"]
    assert "model_profile" not in parameters["properties"]
    assert not {"model", "effort"}.intersection(parameters.get("required", []))
    agent = parameters["properties"]["agent"]
    assert "Worker" in agent["enum"]
    assert "WebResearcher" not in agent["enum"]
    assert not {"fast", "standard", "deep"}.intersection(agent["enum"])
    assert "coding" in subagent(parent)["description"]

    child = next(request for request in captured if request.get("model") == "gpt-5.6-sol")
    messages = child["messages"]
    assert messages[0]["role"] == "system" and messages[0]["content"].startswith("# Worker")
    assert any("PROBE_CHILD_OK" in str(message.get("content")) for message in messages)

    resumed_parent = next(
        request
        for request in captured
        if request.get("model") == "gpt-5.6-luna"
        and any(message.get("role") == "tool" for message in request.get("messages", []))
    )
    assert any(
        message.get("role") == "tool" and "PROBE_CHILD_OK" in str(message.get("content"))
        for message in resumed_parent["messages"]
    )
    call = next(message for message in resumed_parent["messages"] if message.get("tool_calls"))
    arguments = json.loads(call["tool_calls"][0]["function"]["arguments"])
    assert arguments["agent"] == "Worker"
    assert arguments["model"] == "sol"
    assert arguments["effort"] == "high"
    print("delegate profile capture validation passed")


if __name__ == "__main__":
    main()
