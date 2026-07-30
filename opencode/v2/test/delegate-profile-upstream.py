#!/usr/bin/env python3
"""Deterministic OpenAI-compatible upstream for the delegate-profile capture test."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import time


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        print(format % args, flush=True)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        size = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(size))
        model = body.get("model", "unknown")
        messages = body.get("messages", [])
        tools = body.get("tools", [])
        has_subagent = any(tool.get("function", {}).get("name") == "subagent" for tool in tools)
        has_tool_result = any(message.get("role") == "tool" for message in messages)

        if model == "gpt-5.6-sol":
            chunks = self.text_chunks(model, "PROBE_CHILD_OK")
        elif has_tool_result:
            chunks = self.text_chunks(model, "PROBE_PARENT_OK")
        elif has_subagent:
            arguments = json.dumps(
                {
                    "agent": "WebResearcher",
                    "description": "Profile routing probe",
                    "prompt": "Reply with exactly PROBE_CHILD_OK",
                    "background": False,
                    "model_profile": "deep",
                },
                separators=(",", ":"),
            )
            chunks = self.tool_chunks(model, arguments)
        else:
            chunks = self.text_chunks(model, "Profile routing probe")

        data = "".join(
            f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n" for chunk in chunks
        ) + "data: [DONE]\n\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data.encode())

    @staticmethod
    def base(model: str) -> dict[str, object]:
        return {
            "id": f"chatcmpl-{int(time.time())}",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
        }

    @classmethod
    def text_chunks(cls, model: str, text: str) -> list[dict[str, object]]:
        base = cls.base(model)
        return [
            {
                **base,
                "choices": [
                    {"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}
                ],
            },
            {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
        ]

    @classmethod
    def tool_chunks(cls, model: str, arguments: str) -> list[dict[str, object]]:
        base = cls.base(model)
        return [
            {
                **base,
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "role": "assistant",
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_delegate_profile_probe",
                                    "type": "function",
                                    "function": {"name": "subagent", "arguments": arguments},
                                }
                            ],
                        },
                        "finish_reason": None,
                    }
                ],
            },
            {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
        ]


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 1235), Handler).serve_forever()
