import assert from "node:assert/strict"
import test from "node:test"

import plugin, { patchOnlyTools } from "./patch-only-tools.js"
import { patchDescription, patchInput } from "../lib/patch-tool-data.js"
import { slimDescriptions } from "../lib/slim-tools-data.js"

const builtin = () => ({
  edit: { description: "edit", input: {} },
  write: { description: "write", input: {} },
  read: { description: "read", input: {} },
  patch: {
    description: "builtin patch spec",
    input: { type: "object", properties: { patchText: { type: "string", description: "builtin" } } },
  },
})

test("removes edit and write and leaves other tools alone", () => {
  const tools = builtin()
  patchOnlyTools(tools)
  assert.deepEqual(Object.keys(tools).sort(), ["patch", "read"])
  assert.equal(tools.read.description, "read")
})

test("re-advertises patch when the builtin gate removed it", () => {
  const tools = { edit: {}, write: {}, read: {} }
  patchOnlyTools(tools)
  assert.equal(tools.patch.description, patchDescription)
  assert.deepEqual(tools.patch.input, patchInput)
})

test("keeps the builtin schema when the builtin advertisement is present", () => {
  const tools = builtin()
  patchOnlyTools(tools)
  // Upstream owns the schema; preserving it is what survives a parameter being
  // added or renamed. Only the description is ours.
  assert.equal(tools.patch.input.properties.patchText.description, "builtin")
  assert.equal(tools.patch.description, patchDescription)
})

test("the description carries the envelope and every operation header", () => {
  // A model cannot produce an applicable patch without these, and the observed
  // failure when they are missing is a rejected '*** Begin Patch' envelope.
  for (const marker of [
    "*** Begin Patch",
    "*** End Patch",
    "*** Add File:",
    "*** Update File:",
    "*** Delete File:",
    "@@",
    "\n+",
    "\n-",
  ]) {
    assert.ok(patchDescription.includes(marker), `description is missing ${marker}`)
  }
})

test("slim-tools no longer owns the patch description", () => {
  // Both plugins used to set it, with slim-tools winning by load order and
  // dropping the format. patch-only-tools owns the description; slim-tools keeps
  // owning parameter descriptions.
  assert.equal("patch" in slimDescriptions, false)
  assert.ok(slimDescriptions.shell)
})

test("tolerates a missing or malformed tool record", () => {
  assert.equal(patchOnlyTools(undefined), undefined)
  assert.equal(patchOnlyTools("nope"), "nope")
})

test("registers the context hook under a namespaced id", () => {
  assert.equal(plugin.id, "personal.patch-only-tools")
  const hooks = []
  plugin.setup({ session: { hook: (name, fn) => hooks.push([name, fn]) } })
  assert.deepEqual(hooks.map(([name]) => name), ["context"])
  const event = { tools: { edit: {}, write: {} } }
  hooks[0][1](event)
  assert.deepEqual(Object.keys(event.tools), ["patch"])
})
