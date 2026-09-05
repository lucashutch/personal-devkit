import assert from "node:assert/strict"
import test from "node:test"
import plugin from "./slim-tools/index.js"

test("patches refs and nested schemas while preserving originals and unknown tools", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const input = { $ref: "#/$defs/request", $defs: { request: { properties: { path: { type: "string", minLength: 2 }, metadata: { properties: { path: { description: "unrelated" } } } } } }, additionalProperties: false }
  const known = { description: "long", input }
  const unknown = { description: "leave" }
  const event = { tools: { read: known, custom: unknown } }
  hook(event)
  assert.equal(event.tools.read.input.$defs.request.properties.path.description, "Path to read")
  assert.equal(event.tools.read.input.$defs.request.properties.path.minLength, 2)
  assert.equal(event.tools.read.input.$defs.request.properties.metadata.properties.path.description, "unrelated")
  assert.equal(event.tools.read.input.additionalProperties, false)
  assert.equal(input.$defs.request.properties.path.description, undefined)
  assert.equal(event.tools.custom, unknown)
})

test("patches every union alternative at the declared parameter location", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const event = { tools: { read: { input: { oneOf: [
    { properties: { path: { type: "string", description: "a" } } },
    { properties: { path: { type: "string", description: "b" } } },
  ] } } } }
  hook(event)
  assert.deepEqual(event.tools.read.input.oneOf.map((part) => part.properties.path.description), ["Path to read", "Path to read"])
})

test("patches repeated nested parameter names", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const event = { tools: { question: { input: { properties: { questions: { items: { properties: { question: { type: "string" } } } } } } } } }
  hook(event)
  assert.equal(event.tools.question.input.properties.questions.items.properties.question.description, "Complete question")
})
