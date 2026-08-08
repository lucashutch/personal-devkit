import assert from "node:assert/strict"
import test from "node:test"

import {
  createHerdrSessionTitlePlugin,
  createSessionTitleHandler,
  createTabRenamer,
} from "./herdr-session-title.js"

test("session title handler follows the selected V2 session", async () => {
  const titles = []
  const sessions = new Map([
    ["session-1", { id: "session-1", title: "Selected title" }],
    ["session-2", { id: "session-2", title: "Other title" }],
  ])
  const handle = createSessionTitleHandler(
    { session: { get: async ({ sessionID }) => sessions.get(sessionID) } },
    async (title) => titles.push(title),
  )

  await handle({ type: "tui.session.select", data: { sessionID: "session-1" } })
  await handle({ type: "session.renamed", data: { sessionID: "session-2", title: "Ignore me" } })
  await handle({ type: "session.renamed", data: { sessionID: "session-1", title: "New title" } })

  assert.deepEqual(titles, ["Selected title", "New title"])
})

test("root session creation provides a fallback before a TUI selection event", async () => {
  const titles = []
  const handle = createSessionTitleHandler(
    { session: { get: async () => undefined } },
    async (title) => titles.push(title),
  )

  await handle({
    type: "session.created",
    data: { sessionID: "child", parentID: "root", title: "Child" },
  })
  await handle({ type: "session.created", data: { sessionID: "root", title: "Root" } })

  assert.deepEqual(titles, ["Root"])
})

test("tab renamer resolves the pane once and ignores empty titles", async () => {
  const requests = []
  const rename = createTabRenamer(async (method, params) => {
    requests.push([method, params])
    if (method === "pane.get") return { result: { pane: { tab_id: "tab-1" } } }
    return undefined
  })

  await rename("Untitled")
  await rename(" First title ")
  await rename("Second title")

  assert.deepEqual(requests, [
    ["pane.get", { pane_id: process.env.HERDR_PANE_ID }],
    ["tab.rename", { tab_id: "tab-1", label: "First title" }],
    ["tab.rename", { tab_id: "tab-1", label: "Second title" }],
  ])
})

test("V2 plugin exposes a descriptor instead of the V1 hook object", () => {
  const plugin = createHerdrSessionTitlePlugin(async () => {})
  assert.equal(plugin.id, "herdr.session-title")
  assert.equal(typeof plugin.setup, "function")
})
