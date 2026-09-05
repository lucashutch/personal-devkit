import assert from "node:assert/strict"
import test from "node:test"

import {
  createHerdrTuiPanePlugin,
  createPaneSync,
  createTabRenamer,
  selectedRootSession,
  stateFromSessionStatus,
} from "./herdr-tui-pane/tui.js"

function harness({ rootOf = (id) => id } = {}) {
  const calls = []
  const sync = createPaneSync({
    reportSession: async (sessionID) => calls.push(["session", sessionID]),
    reportState: async (state, sessionID) => calls.push(["state", state, sessionID]),
    renameTab: async (title) => calls.push(["rename", title]),
    rootOf,
  })
  return { calls, ...sync }
}

function context(route, sessions = {}) {
  return {
    ui: { router: { current: () => route } },
    data: { session: { get: (id) => sessions[id], root: (id) => sessions[id]?.parentID ?? id } },
  }
}

test("failed execution recovers and two pending requests unblock separately", async () => {
  const { calls, syncSelection, handleEvent } = harness()
  await syncSelection({ sessionID: "root" })
  const event = (type, requestID) => handleEvent({ type, data: { sessionID: "root", requestID } })
  await event("session.execution.failed")
  await event("session.execution.started")
  await event("session.execution.succeeded")
  assert.deepEqual(calls.filter(([kind]) => kind === "state").map((call) => call[1]), ["blocked", "working", "idle"])
  await event("permission.asked", "a")
  await event("permission.asked", "b")
  await event("permission.replied", "a")
  assert.equal(calls.at(-1)[1], "blocked")
  await event("permission.replied", "b")
  assert.equal(calls.at(-1)[1], "working")
})

test("failed identity reports back off and settle after recovery", async () => {
  let attempts = 0
  const { syncSelection } = createPaneSync({
    reportSession: async () => { if (++attempts < 4) throw new Error("offline") },
    reportState: async () => {}, renameTab: async () => {}, rootOf: (id) => id,
  })
  const delays = []
  for (let index = 0; index < 6; index++) delays.push(await syncSelection({ sessionID: "root" }))
  assert.deepEqual(delays, [100, 400, 1000, undefined, undefined, undefined])
  assert.equal(attempts, 4)
})

test("late tab lookup cannot rename a deselected or disposed session", async () => {
  let release
  let current = true
  const calls = []
  const rename = createTabRenamer(async (method) => {
    calls.push(method)
    if (method === "pane.get") return new Promise((resolve) => { release = resolve })
  }, null)
  const pending = rename("Old title", () => current)
  current = false
  release({ result: { pane: { tab_id: "tab" } } })
  await pending
  assert.deepEqual(calls, ["pane.get"])
})

test("protocol errors invalidate cached tab identity", async () => {
  const calls = []
  const rename = createTabRenamer(async (method, params) => {
    calls.push([method, params.tab_id])
    if (method === "pane.get") return { result: { pane: { tab_id: "new" } } }
    return params.tab_id === "old" ? { error: "not found" } : { result: {} }
  }, "old")
  await assert.rejects(rename("Title"), /not found/)
  await rename("Title")
  assert.deepEqual(calls, [["tab.rename", "old"], ["pane.get", undefined], ["tab.rename", "new"]])
})

test("only a root session route owns the pane", () => {
  const sessions = {
    root: { id: "root", title: "Root" },
    child: { id: "child", parentID: "root", title: "Child" },
  }
  assert.deepEqual(selectedRootSession(context({ type: "session", sessionID: "root" }, sessions)), {
    sessionID: "root",
    title: "Root",
  })
  assert.deepEqual(selectedRootSession(context({ type: "session", sessionID: "child" }, sessions)), {
    sessionID: "root",
    title: "Root",
  })
  assert.equal(selectedRootSession(context({ type: "session", sessionID: "gone" }, sessions)), undefined)
  assert.equal(selectedRootSession(context({ type: "home" }, sessions)), undefined)
})

test("successful selection reports settle and coalesce", async () => {
  const { calls, syncSelection } = harness()

  // Retries settle at a bounded one-second backoff so a late Herdr startup is
  // eventually discovered.
  const delays = []
  for (let index = 0; index < 5; index++) {
    delays.push(await syncSelection({ sessionID: "root", title: "Root" }))
  }

  assert.deepEqual(delays, [undefined, undefined, undefined, undefined, undefined])
  assert.deepEqual(calls.filter(([kind]) => kind === "session").length, 1)
  assert.deepEqual(calls.filter(([kind]) => kind === "rename"), [["rename", "Root"]])

  assert.equal(await syncSelection({ sessionID: "root", title: "Root" }), undefined)
})

test("a late or changed title renames the tab without a new selection", async () => {
  const { calls, syncSelection } = harness()

  await syncSelection({ sessionID: "root", title: undefined })
  await syncSelection({ sessionID: "root", title: "Generated title" })
  await syncSelection({ sessionID: "root", title: "Generated title" })
  await syncSelection({ sessionID: "root", title: "Renamed by hand" })

  assert.deepEqual(calls.filter(([kind]) => kind === "rename"), [
    ["rename", "Generated title"],
    ["rename", "Renamed by hand"],
  ])
})

test("a second root session renames its own tab", async () => {
  // The bug this port fixes: a single server-side instance latched the first
  // session and silently dropped every later one.
  const { calls, syncSelection } = harness()

  await syncSelection({ sessionID: "first", title: "First" })
  await syncSelection({ sessionID: "second", title: "Second" })

  assert.deepEqual(calls, [
    ["rename", "First"],
    ["session", "first"],
    ["rename", "Second"],
    ["session", "second"],
  ])
})

test("state is reported for the selected session and its subagents", async () => {
  const roots = { root: "root", child: "root", stranger: "stranger" }
  const { calls, syncSelection, handleEvent } = harness({
    rootOf: (id) => roots[id],
  })
  await syncSelection({ sessionID: "root", title: "Root" })
  calls.length = 0

  await handleEvent({ type: "session.input.admitted", data: { sessionID: "root" } })
  await handleEvent({ type: "session.tool.called", data: { sessionID: "child" } })
  await handleEvent({ type: "permission.asked", data: { sessionID: "child" } })
  await handleEvent({ type: "permission.replied", data: { sessionID: "child" } })
  await handleEvent({ type: "session.status", data: { sessionID: "root", status: { type: "busy" } } })
  await handleEvent({ type: "session.idle", data: { sessionID: "root" } })
  await handleEvent({ type: "session.text.delta", data: { sessionID: "root" } })

  assert.deepEqual(calls, [
    ["state", "working", "root"],
    ["state", "blocked", "root"],
    ["state", "working", "root"],
  ])
})

test("a finished V2 turn returns the pane to idle", async () => {
  // V2 has no session.idle or session.status; only session.execution.* ends a turn.
  const { calls, syncSelection, handleEvent } = harness()
  await syncSelection({ sessionID: "root", title: "Root" })
  calls.length = 0

  await handleEvent({ type: "session.execution.started", data: { sessionID: "root" } })
  await handleEvent({ type: "session.execution.succeeded", data: { sessionID: "root" } })
  await handleEvent({ type: "session.execution.started", data: { sessionID: "root" } })
  await handleEvent({ type: "session.execution.interrupted", data: { sessionID: "root" } })

  assert.deepEqual(calls, [
    ["state", "working", "root"],
    ["state", "idle", "root"],
    ["state", "working", "root"],
    ["state", "idle", "root"],
  ])
})

test("an idle child does not hide a working sibling", async () => {
  const roots = { root: "root", one: "root", two: "root" }
  const { calls, syncSelection, handleEvent } = harness({ rootOf: (id) => roots[id] })
  await syncSelection({ sessionID: "root", title: "Root" })
  calls.length = 0
  await handleEvent({ type: "session.execution.started", data: { sessionID: "one" } })
  await handleEvent({ type: "session.execution.started", data: { sessionID: "two" } })
  await handleEvent({ type: "session.execution.succeeded", data: { sessionID: "two" } })
  assert.deepEqual(calls, [["state", "working", "root"]])
  await handleEvent({ type: "session.execution.succeeded", data: { sessionID: "one" } })
  assert.deepEqual(calls.at(-1), ["state", "idle", "root"])
})

test("blocked wins over working until the blocked child resumes", async () => {
  const { calls, syncSelection, handleEvent } = harness({ rootOf: () => "root" })
  await syncSelection({ sessionID: "root", title: "Root" })
  calls.length = 0
  await handleEvent({ type: "session.execution.started", data: { sessionID: "one" } })
  await handleEvent({ type: "permission.asked", data: { sessionID: "two" } })
  await handleEvent({ type: "session.execution.succeeded", data: { sessionID: "one" } })
  await handleEvent({ type: "permission.replied", data: { sessionID: "two" } })
  assert.deepEqual(calls.map((call) => call[1]), ["working", "blocked", "working"])
})

test("another pane's session never touches this pane", async () => {
  // The other half of the bug: the shared service broadcasts every session's
  // events to every TUI, so the pane must filter by its own selection.
  const roots = { root: "root", stranger: "stranger" }
  const { calls, syncSelection, handleEvent } = harness({
    rootOf: (id) => roots[id],
  })
  await syncSelection({ sessionID: "root", title: "Root" })
  calls.length = 0

  await handleEvent({ type: "session.input.admitted", data: { sessionID: "stranger" } })
  await handleEvent({ type: "session.idle", data: { sessionID: "stranger" } })
  await handleEvent({ type: "session.idle", data: {} })

  assert.deepEqual(calls, [])
})

test("events before any selection are ignored", async () => {
  const { calls, handleEvent } = harness()
  await handleEvent({ type: "session.idle", data: { sessionID: "root" } })
  assert.deepEqual(calls, [])
})

test("session status strings and objects map to pane states", () => {
  assert.equal(stateFromSessionStatus("busy"), "working")
  assert.equal(stateFromSessionStatus({ type: "retry" }), "working")
  assert.equal(stateFromSessionStatus({ type: "idle" }), "idle")
  assert.equal(stateFromSessionStatus({ type: "wat" }), undefined)
  assert.equal(stateFromSessionStatus(undefined), undefined)
})

test("the tab renamer resolves a missing tab id from the pane", async () => {
  const sent = []
  const send = async (method, params) => {
    sent.push([method, params])
    return { result: { pane: { tab_id: "wJ:t9" } } }
  }
  // null, not undefined: a default parameter would fall back to HERDR_TAB_ID.
  const rename = createTabRenamer(send, null)

  await rename("  ")
  await rename("Untitled")
  await rename("Real title")
  await rename("Another title")

  assert.deepEqual(sent, [
    ["pane.get", { pane_id: process.env.HERDR_PANE_ID }],
    ["tab.rename", { tab_id: "wJ:t9", label: "Real title" }],
    // The resolved tab id is reused rather than looked up again.
    ["tab.rename", { tab_id: "wJ:t9", label: "Another title" }],
  ])
})

test("an explicit tab id is used as-is", async () => {
  const sent = []
  const rename = createTabRenamer(async (method, params) => sent.push([method, params]), "wJ:t8")
  await rename("Title")
  assert.deepEqual(sent, [["tab.rename", { tab_id: "wJ:t8", label: "Title" }]])
})

test("the plugin stays inert outside a Herdr pane", () => {
  const plugin = createHerdrTuiPanePlugin(async () => {})
  assert.equal(plugin.id, "herdr.tui-pane")
  const saved = { ...process.env }
  for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID"]) delete process.env[key]
  try {
    assert.equal(plugin.setup(context({ type: "session", sessionID: "root" })), undefined)
  } finally {
    Object.assign(process.env, saved)
  }
})

test("the plugin tracks the route, listens for events and disposes both", async () => {
  const sent = []
  const plugin = createHerdrTuiPanePlugin(async (method, params) => {
    sent.push([method, params.agent_session_id ?? params.label])
    return undefined
  })
  const saved = { ...process.env }
  process.env.HERDR_ENV = "1"
  process.env.HERDR_SOCKET_PATH = "/tmp/herdr-test.sock"
  process.env.HERDR_PANE_ID = "wJ:p9"
  process.env.HERDR_TAB_ID = "wJ:t9"
  let emit
  let listening = true
  let watching = true
  const ctx = {
    ui: { router: { current: () => ({ type: "session", sessionID: "root" }) } },
    data: {
      session: { get: () => ({ id: "root", title: "Root" }), root: () => "root" },
      on: () => () => {
        watching = false
      },
      listen: (handler) => {
        emit = handler
        return () => {
          listening = false
        }
      },
    },
  }
  try {
    const dispose = plugin.setup(ctx)
    emit({ details: { type: "session.idle", data: { sessionID: "root" } } })
    await new Promise((resolve) => setTimeout(resolve, 250))
    dispose()
    assert.equal(listening, false)
    assert.equal(watching, false)
    assert.ok(
      sent.some(([method]) => method === "tab.rename"),
      "expected a tab rename",
    )
    assert.ok(
      sent.some(([method]) => method === "pane.report_agent"),
      "expected a state report",
    )
    const settled = sent.length
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(sent.length, settled, "the retry ladder continued after dispose")
  } finally {
    for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "HERDR_TAB_ID"]) {
      delete process.env[key]
    }
    Object.assign(process.env, saved)
  }
})
