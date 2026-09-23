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

test("adds routing guidance without changing the native delegation schema or executor", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const input = {
    type: "object",
    properties: {
      agent: { type: "string" },
      prompt: { type: "string" },
      model: { type: "string" },
      sessionID: { type: "string", pattern: "^ses", description: "Continue a previous session" },
      background: { type: "boolean" },
    },
    required: ["agent", "prompt"],
    additionalProperties: false,
  }
  const original = structuredClone(input)
  const execute = () => "native executor"
  const event = { tools: { subagent: { description: "Upstream delegation instructions", input, execute } } }

  hook(event)

  assert.match(event.tools.subagent.description, /\| Model \| Cost ↓ \| Code ↑ \| Reasoning ↑ \| UI ↑ \|/)
  assert.match(event.tools.subagent.description, /Advisor defaults to Astra medium/)
  assert.match(event.tools.subagent.description, /Query the catalog only when an override is unknown/)
  assert.match(event.tools.subagent.input.properties.agent.description, /Exact case-sensitive agent ID/)
  assert.match(event.tools.subagent.input.properties.agent.description, /Advisor, Reviewer, and Worker/)
  assert.match(event.tools.subagent.input.properties.model.description, /Omit when the configured or inherited model fits/)
  assert.equal(event.tools.subagent.input.properties.model.type, "string")
  assert.equal(event.tools.subagent.input.properties.effort, undefined)
  const withoutDescriptions = (value) => {
    if (Array.isArray(value)) return value.map(withoutDescriptions)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(Object.entries(value)
      .filter(([key, child]) => key !== "description" || typeof child !== "string")
      .map(([key, child]) => [key, withoutDescriptions(child)]))
  }
  assert.deepEqual(withoutDescriptions(event.tools.subagent.input), withoutDescriptions(original))
  assert.deepEqual(input, original)
  assert.equal(event.tools.subagent.execute, execute)
})

test("makes grep regex behavior explicit", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const event = { tools: { grep: { description: "upstream", input: { properties: { pattern: { type: "string" }, literal: { type: "boolean" } } } } } }

  hook(event)

  assert.match(event.tools.grep.description, /literal=true/)
  assert.match(event.tools.grep.description, /Escape regex metacharacters/)
})

test("preserves upstream patch grammar while shortening the patch parameter", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const description = "*** Begin Patch\n*** Add File: hello.txt\n+Hello\n*** End Patch"
  const input = { properties: { patchText: { type: "string", description: "Upstream parameter description" } } }
  const event = { tools: { patch: { description, input } } }

  hook(event)

  assert.equal(event.tools.patch.description, description)
  assert.notEqual(event.tools.patch.input.properties.patchText.description, input.properties.patchText.description)
  assert.equal(event.tools.patch.input.properties.patchText.type, "string")
})

test("does not invent a maximum for the uncapped shell timeout", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const event = { tools: { shell: { input: { properties: {
    timeout: {
      type: "integer",
      minimum: 0,
      description: "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
    },
  } } } } }

  hook(event)

  const { description, ...schema } = event.tools.shell.input.properties.timeout
  assert.deepEqual(schema, { type: "integer", minimum: 0 })
  assert.doesNotMatch(description, /600000|\bmax(?:imum)?\s*[:=]?\s*\d/i)
  assert.match(description, /0\s+(?:unlimited|disable)/i)
  assert.match(description, /120000\s+foreground/i)
  assert.match(description, /unlimited\s+background/i)
})
