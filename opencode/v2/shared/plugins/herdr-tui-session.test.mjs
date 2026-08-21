import assert from "node:assert/strict"
import test from "node:test"

import {
  createHerdrTuiSessionPlugin,
  createSelectionReporter,
  selectedRootSession,
} from "./herdr-tui-session.js"

function context(route, sessions = {}) {
  return {
    ui: { router: { current: () => route } },
    data: { session: { get: (id) => sessions[id] } },
  }
}

test("only a root session route counts as the pane's selection", () => {
  const sessions = { root: { id: "root" }, child: { id: "child", parentID: "root" } }
  assert.equal(selectedRootSession(context({ type: "session", sessionID: "root" }, sessions)), "root")
  assert.equal(selectedRootSession(context({ type: "session", sessionID: "child" }, sessions)), undefined)
  assert.equal(selectedRootSession(context({ type: "session", sessionID: "gone" }, sessions)), undefined)
  assert.equal(selectedRootSession(context({ type: "home" }, sessions)), undefined)
  assert.equal(selectedRootSession(context({ type: "plugin", id: "p", name: "n" }, sessions)), undefined)
})

test("a held selection is reported on the retry ladder and then stops", async () => {
  const reported = []
  let clock = 0
  const sync = createSelectionReporter(async (id) => reported.push([id, clock]), () => clock)

  // Four polls at the same instant: only the first passes the retry gate.
  for (let poll = 0; poll < 4; poll += 1) await sync("root")
  assert.deepEqual(reported, [["root", 0]])

  clock = 100
  await sync("root")
  clock = 500
  await sync("root")
  clock = 1_500
  await sync("root")
  clock = 100_000
  await sync("root")
  assert.deepEqual(reported, [
    ["root", 0],
    ["root", 100],
    ["root", 500],
    ["root", 1_500],
  ])
})

test("changing selection restarts the ladder and leaving it goes quiet", async () => {
  const reported = []
  let clock = 0
  const sync = createSelectionReporter(async (id) => reported.push(id), () => clock)

  await sync("root")
  clock = 100_000
  await sync("root")
  await sync("other")
  await sync(undefined)
  await sync(undefined)
  await sync("other")

  assert.deepEqual(reported, ["root", "root", "other", "other"])
})

test("a failing report does not stall later polls", async () => {
  const reported = []
  let clock = 0
  const sync = createSelectionReporter(async (id) => {
    reported.push(id)
    throw new Error("socket refused")
  }, () => clock)

  await sync("root")
  clock = 100
  await sync("root")

  assert.deepEqual(reported, ["root", "root"])
})

test("the plugin stays inert outside a Herdr pane", () => {
  const plugin = createHerdrTuiSessionPlugin(async () => {})
  assert.equal(plugin.id, "herdr.tui-session")
  const saved = { ...process.env }
  delete process.env.HERDR_ENV
  delete process.env.HERDR_SOCKET_PATH
  delete process.env.HERDR_PANE_ID
  try {
    assert.equal(plugin.setup(context({ type: "session", sessionID: "root" })), undefined)
  } finally {
    Object.assign(process.env, saved)
  }
})

test("the plugin polls the route and disposes its timer", async () => {
  const reported = []
  const plugin = createHerdrTuiSessionPlugin(async (id) => reported.push(id))
  const saved = { ...process.env }
  process.env.HERDR_ENV = "1"
  process.env.HERDR_SOCKET_PATH = "/tmp/herdr-test.sock"
  process.env.HERDR_PANE_ID = "pane-1"
  try {
    const dispose = plugin.setup(context({ type: "session", sessionID: "root" }, { root: { id: "root" } }))
    await new Promise((resolve) => setTimeout(resolve, 250))
    dispose()
    const settled = reported.length
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.ok(settled >= 2, `expected repeat reports, got ${settled}`)
    assert.equal(reported.length, settled)
  } finally {
    for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID"]) delete process.env[key]
    Object.assign(process.env, saved)
  }
})
