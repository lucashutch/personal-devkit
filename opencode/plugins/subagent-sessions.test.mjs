import assert from "node:assert/strict"
import test from "node:test"
import { listChildren, polledStatus, reconcileChildren } from "./subagent-sessions/reconcile.js"
import { activityLabel, detailLines, requestedProfiles } from "./subagent-sessions/labels.js"

test("sidebar separates role and status from profile, cumulative usage and cost", () => {
  assert.deepEqual(detailLines({ role: "Reviewer", profile: "luna:high", status: "idle",
    model: "gpt-5.6-luna#xhigh", tokens: "188k", cost: "$0.18" }), [
    "Reviewer · idle", "Luna:high · 188k · $0.18",
  ])
  assert.deepEqual(detailLines({ role: "Worker", status: "working", model: "gpt-5.6-luna" }),
    ["Worker · working", "gpt-5.6-luna"])
})

test("requested models come from creation calls, preserving historical tiers and ignoring resumes", () => {
  const call = (input, metadata) => ({ type: "tool", name: "subagent", state: { input, metadata } })
  const profiles = requestedProfiles([{ type: "assistant", content: [
    call({ model: "luna", effort: "high" }, { sessionID: "child" }),
    call({ model: "sol", sessionID: "child" }, { sessionID: "child" }),
    call({ model_profile: "deep" }, { sessionID: "other" }),
    call({ model_profile: "fast" }),
    call({}, { sessionID: "unknown" }),
    call({ model: "muse" }, { sessionID: "default-effort" }),
  ] }])
  assert.deepEqual([...profiles], [["child", "luna:high"], ["other", "deep"], ["default-effort", "muse:medium"]])
})

test("blocked and exceptional states take precedence over ordinary activity", () => {
  assert.equal(activityLabel({ permission: true, question: true, retry: true, running: true }), "blocked: permission")
  assert.equal(activityLabel({ question: true, retry: true, running: true }), "blocked: question")
  assert.equal(activityLabel({ retry: true, running: true }), "retrying")
  assert.equal(activityLabel({ outcome: "failed", running: false }), "failed")
  assert.equal(activityLabel({ outcome: "interrupted", running: false }), "interrupted")
  assert.equal(activityLabel({ running: true, queued: 2 }), "working · 2 queued")
  assert.equal(activityLabel({ running: false, queued: 1 }), "queued")
})

test("child snapshots consume all pages before reconciliation", async () => {
  const calls = []
  const sessions = await listChildren(async (input) => {
    calls.push(input)
    return input.cursor ? { data: [{ id: "b" }], cursor: {} }
      : { data: [{ id: "a" }], cursor: { next: "page2" } }
  }, "root")
  assert.deepEqual(sessions.map((session) => session.id), ["a", "b"])
  assert.deepEqual(calls, [{ parentID: "root" }, { parentID: "root", cursor: "page2" }])
})

test("incomplete and cancelled lists never produce authoritative snapshots", async () => {
  await assert.rejects(listChildren(async () => ({ data: [], cursor: { next: "same" } }), "root"), /Repeated/)
  assert.equal(await listChildren(async () => ({ data: [] }), "root", () => false), undefined)
  await assert.rejects(listChildren(async () => { throw new Error("offline") }, "root"), /offline/)
})

test("complete snapshots remove stale children, preserve concurrent events and clear tombstones", () => {
  const observed = new Map(["old", "new"].map((id) => [id, { id, parentID: "root" }]))
  const observedAt = new Map([["new", 11]])
  const absent = new Set(["returned"])
  reconcileChildren({ sessions: [{ id: "returned", parentID: "root" }], observed, observedAt, absent, parentID: "root", startedAt: 10 })
  assert.deepEqual([...observed.keys()], ["new", "returned"])
  assert.deepEqual([...absent], ["old"])
})

test("cached binary status cannot erase retry", () => {
  for (let count = 0; count < 10; count++) assert.equal(polledStatus("retry", "idle"), "retry")
  assert.equal(polledStatus("idle", "running"), "running")
})
