import assert from "node:assert/strict"
import test from "node:test"

import {
  createHerdrTuiPanePlugin,
  createPaneSync,
  createTabRenamer,
  selectedRootSession,
  stateFromSessionStatus,
} from "./herdr-tui-pane.js"

function harness({ rootOf = (id) => id, clock = () => 0 } = {}) {
  const calls = []
  const sync = createPaneSync({
    reportSession: async (sessionID) => calls.push(["session", sessionID]),
    reportState: async (state, sessionID) => calls.push(["state", state, sessionID]),
    renameTab: async (title) => calls.push(["rename", title]),
    rootOf,
    now: clock,
  })
  return { calls, ...sync }
}

function context(route, sessions = {}) {
  return {
    ui: { router: { current: () => route } },
    data: { session: { get: (id) => sessions[id] } },
  }
}

test("only a root session route owns the pane", () => {
  const sessions = {
    root: { id: "root", title: "Root" },
    child: { id: "child", parentID: "root", title: "Child" },
  }
  assert.deepEqual(selectedRootSession(context({ type: "session", sessionID: "root" }, sessions)), {
    sessionID: "root",
    title: "Root",
  })
  assert.equal(selectedRootSession(context({ type: "session", sessionID: "child" }, sessions)), undefined)
  assert.equal(selectedRootSession(context({ type: "session", sessionID: "gone" }, sessions)), undefined)
  assert.equal(selectedRootSession(context({ type: "home" }, sessions)), undefined)
})

test("the selection is reported on a retry ladder and the tab renamed once", async () => {
  let clock = 0
  const { calls, syncSelection } = harness({ clock: () => clock })

  for (let poll = 0; poll < 4; poll += 1) await syncSelection({ sessionID: "root", title: "Root" })
  assert.deepEqual(calls, [["rename", "Root"], ["session", "root"]])

  clock = 100
  await syncSelection({ sessionID: "root", title: "Root" })
  clock = 500
  await syncSelection({ sessionID: "root", title: "Root" })
  clock = 1_500
  await syncSelection({ sessionID: "root", title: "Root" })
  clock = 100_000
  await syncSelection({ sessionID: "root", title: "Root" })

  assert.deepEqual(calls.filter(([kind]) => kind === "session").length, 4)
  assert.deepEqual(calls.filter(([kind]) => kind === "rename"), [["rename", "Root"]])
})

test("a late or changed title renames the tab without a new selection", async () => {
  const { calls, syncSelection } = harness({ clock: () => 100_000 })

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
  const { calls, syncSelection } = harness({ clock: () => 100_000 })

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
    clock: () => 100_000,
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
    ["state", "working", "root"],
    ["state", "blocked", "root"],
    ["state", "working", "root"],
    ["state", "working", "root"],
    ["state", "idle", "root"],
  ])
})

test("another pane's session never touches this pane", async () => {
  // The other half of the bug: the shared service broadcasts every session's
  // events to every TUI, so the pane must filter by its own selection.
  const roots = { root: "root", stranger: "stranger" }
  const { calls, syncSelection, handleEvent } = harness({
    rootOf: (id) => roots[id],
    clock: () => 100_000,
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

test("the plugin polls the route, listens for events and disposes both", async () => {
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
  const ctx = {
    ui: { router: { current: () => ({ type: "session", sessionID: "root" }) } },
    data: {
      session: { get: () => ({ id: "root", title: "Root" }), root: () => "root" },
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
    assert.equal(sent.length, settled, "polling continued after dispose")
  } finally {
    for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "HERDR_TAB_ID"]) {
      delete process.env[key]
    }
    Object.assign(process.env, saved)
  }
})
