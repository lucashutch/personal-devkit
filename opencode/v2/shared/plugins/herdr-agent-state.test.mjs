import assert from "node:assert/strict"
import test from "node:test"

import { createAgentStateHandler, createHerdrAgentStatePlugin } from "./herdr-agent-state.js"

function recorder() {
  const calls = []
  return {
    calls,
    send: {
      reportState: async (state, sessionID) => calls.push(["state", state, sessionID]),
      reportSession: async (sessionID, source) => calls.push(["session", sessionID, source]),
    },
  }
}

test("root session lifecycle reports working, blocked and idle", async () => {
  const { calls, send } = recorder()
  const handle = createAgentStateHandler(send)

  await handle({ type: "session.created", data: { sessionID: "root", title: "Root" } })
  await handle({ type: "session.input.admitted", data: { sessionID: "root", inputID: "in-1" } })
  await handle({ type: "session.tool.called", data: { sessionID: "root", id: "tool-1" } })
  await handle({ type: "permission.asked", data: { sessionID: "root", id: "perm-1" } })
  await handle({ type: "permission.replied", data: { sessionID: "root", requestID: "perm-1" } })
  await handle({ type: "session.execution.failed", data: { sessionID: "root", error: {} } })
  await handle({ type: "session.idle", data: { sessionID: "root" } })
  await handle({ type: "session.deleted", data: { sessionID: "root" } })

  assert.deepEqual(calls, [
    ["session", "root", "new"],
    ["state", "working", "root"],
    ["state", "working", "root"],
    ["state", "blocked", "root"],
    ["state", "working", "root"],
    ["state", "blocked", "root"],
    ["state", "idle", "root"],
  ])
})

test("subagent events never clobber the root session id", async () => {
  const { calls, send } = recorder()
  const handle = createAgentStateHandler(send)

  await handle({ type: "session.created", data: { sessionID: "root" } })
  await handle({ type: "session.created", data: { sessionID: "child", parentID: "root" } })
  await handle({ type: "session.tool.called", data: { sessionID: "child", id: "tool-1" } })
  await handle({ type: "permission.asked", data: { sessionID: "child", id: "perm-1" } })
  await handle({ type: "question.replied", data: { sessionID: "child", requestID: "q-1" } })
  await handle({ type: "session.idle", data: { sessionID: "child" } })

  assert.deepEqual(calls, [
    ["session", "root", "new"],
    ["state", "blocked", undefined],
    ["state", "working", undefined],
  ])
})

test("forked sessions are tracked as subagents", async () => {
  const { calls, send } = recorder()
  const handle = createAgentStateHandler(send)

  await handle({ type: "session.forked", data: { sessionID: "child", parentID: "root" } })
  await handle({ type: "question.asked", data: { sessionID: "child", id: "q-1" } })

  assert.deepEqual(calls, [["state", "blocked", undefined]])
})

test("session.status maps V2 status objects to pane states", async () => {
  const { calls, send } = recorder()
  const handle = createAgentStateHandler(send)

  await handle({ type: "session.status", data: { sessionID: "root", status: { type: "busy" } } })
  await handle({ type: "session.status", data: { sessionID: "root", status: { type: "retry" } } })
  await handle({ type: "session.status", data: { sessionID: "root", status: { type: "idle" } } })
  await handle({ type: "session.status", data: { sessionID: "root", status: { type: "wat" } } })

  assert.deepEqual(calls, [
    ["state", "working", "root"],
    ["state", "working", "root"],
    ["state", "idle", "root"],
    ["session", "root", undefined],
  ])
})

test("session rename reports the root session id only once", async () => {
  const { calls, send } = recorder()
  const handle = createAgentStateHandler(send)

  await handle({ type: "session.renamed", data: { sessionID: "root", title: "Root" } })
  await handle({ type: "session.renamed", data: { sessionID: "root", title: "Root again" } })

  assert.deepEqual(calls, [["session", "root", undefined]])
})

test("V2 plugin exposes a descriptor instead of the V1 hook object", () => {
  const plugin = createHerdrAgentStatePlugin({
    reportState: async () => {},
    reportSession: async () => {},
  })
  assert.equal(plugin.id, "herdr.agent-state")
  assert.equal(typeof plugin.setup, "function")
})
