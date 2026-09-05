import assert from "node:assert/strict"
import test from "node:test"
import { listChildren, polledStatus, reconcileChildren } from "./subagent-sessions/reconcile.js"

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
