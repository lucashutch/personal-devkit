import assert from "node:assert/strict"
import test from "node:test"
import { Effect, Fiber, Exit } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { addModelProfile, createDelegateProfilesPlugin, parseModelRef, parseProfiles } from "./delegate-profiles/index.js"

const settings = { presets: {
  fast: { model: "openai/luna", variant: "low" },
  balanced: { model: "openai/terra", variant: "medium" },
  deep: { model: "openai/sol", variant: "high" },
} }
const run = (fn, native) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const hooks = {}, log = [], active = {}
  const models = Object.values(parseProfiles(settings)).map((m) => ({ ...m, enabled: true, variants: [{ id: m.variant }] }))
  const tool = { execute: native ?? ((input, context) => Effect.gen(function* () {
    log.push(["role", input.agent])
    yield* context.progress({ sessionID: input.sessionID ?? input.child ?? "child", status: "running" })
    log.push(["prompt", input.background ?? false])
    return result
  })) }
  const result = { content: "native", metadata: { native: true } }
  let transform
  const register = (name, callback) => Effect.sync(() => { hooks[name] = callback })
  yield* createDelegateProfilesPlugin().effect({
    options: settings,
    agent: { list: () => Effect.succeed({ data: [{ id: "Worker", mode: "subagent" }] }) },
    catalog: { model: { list: () => Effect.succeed({ data: models }) } },
    session: {
      hook: register,
      get: ({ sessionID }) => Effect.succeed({ data: { model: active[sessionID] } }),
      switchModel: (input) => Effect.sync(() => { log.push(["switch", input]); return {} }),
    },
    tool: { hook: register, transform: (callback) => Effect.sync(() => { transform = callback; callback({ update: (_, fn) => fn(tool) }) }) },
  })
  let sequence = 0
  const prepare = (input = {}, identity = {}) => Effect.gen(function* () {
    const event = { tool: "subagent", sessionID: "parent", messageID: "message", id: String(++sequence), ...identity,
      input: { agent: "Worker", model_profile: "fast", ...input } }
    yield* hooks["execute.before"](event)
    return { event, execute: () => tool.execute(event.input, { ...event, progress: (update) => Effect.sync(() => log.push(["progress", update])) }) }
  })
  yield* fn({ hooks, log, active, models, tool, result, prepare, replay: () => transform({ update: (_, fn) => fn(tool) }) })
})))

test("profile parsing and compact cloned schema", () => {
  assert.deepEqual(parseModelRef("openai/a#low"), { providerID: "openai", id: "a", variant: "low" })
  for (const value of ["a", "openai/a#", " openai/a"]) assert.throws(() => parseModelRef(value))
  assert.equal(parseProfiles(settings).standard.id, "terra")
  assert.throws(() => parseProfiles({ presets: {} }))
  const schema = { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] }
  const augmented = addModelProfile(schema, [{ id: "Worker", mode: "subagent" }], parseProfiles(settings))
  assert.equal(schema.properties.model_profile, undefined)
  assert.deepEqual(augmented.properties.agent.enum, ["Worker"])
  assert.match(augmented.properties.model_profile.description, /fast=openai\/luna#low/)
  assert.match(augmented.properties.model_profile.description, /When resuming with sessionID, use inherit/)
  assert.match(addModelProfile(schema).properties.model_profile.description, /When resuming with sessionID, use inherit/)
})

for (const background of [false, true]) test(`native forwarding and pre-admission ordering background=${background}`, () => run(function* ({ prepare, log, result }) {
  const call = yield* prepare({ background })
  assert.equal(call.event.input.agent, "Worker")
  assert.equal(call.event.input.model_profile, undefined)
  assert.equal(yield* call.execute(), result)
  assert.deepEqual(log.map(([name]) => name), ["role", "switch", "progress", "prompt"])
}))

test("resume preserves model, rejects profile changes, and replay is idempotent", () => run(function* ({ prepare, log, active, replay, tool }) {
  const execute = tool.execute
  replay(); replay()
  assert.equal(tool.execute, execute)
  active.old = parseProfiles(settings).deep
  yield* (yield* prepare({ sessionID: "old", model_profile: "deep" })).execute()
  assert.equal(log.some(([name]) => name === "switch"), false)
  log.length = 0
  yield* (yield* prepare({ sessionID: "old", model_profile: "inherit" })).execute()
  assert.equal(log.some(([name]) => name === "switch"), false)
  const failed = yield* Effect.exit((yield* prepare({ sessionID: "old" })).execute())
  assert.ok(Exit.isFailure(failed))
  yield* (yield* prepare({ sessionID: "old", model_profile: "inherit" })).execute()
}))

test("invalid profile, model, variant and after-hook cleanup", () => run(function* ({ prepare, models, hooks }) {
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ model_profile: "invalid" }))))
  models[0].enabled = false
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare())))
  models[0].enabled = true
  models[0].variants = []
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare())))
  models[0].variants = [{ id: "low" }]
  const call = yield* prepare()
  yield* hooks["execute.after"](call.event)
  assert.ok(Exit.isFailure(yield* Effect.exit(call.execute())))
}))

test("native error identity and retry cleanup", () => {
  const error = new Tool.Error({ message: "native error" })
  return run(function* ({ prepare }) {
    for (let i = 0; i < 2; i++) {
      const call = yield* prepare({ sessionID: "same", model_profile: "inherit" })
      const actual = yield* call.execute().pipe(Effect.catch((e) => Effect.succeed(e)))
      assert.equal(actual, error)
    }
  }, () => Effect.fail(error))
})

test("concurrent invocation isolation, same-child conflict, cancellation cleanup", () => {
  const admitted = []
  return run(function* ({ prepare, log }) {
    const a = yield* prepare({ child: "a", model_profile: "fast" })
    const b = yield* prepare({ child: "b", model_profile: "deep" })
    const fa = yield* Effect.forkChild(a.execute())
    const fb = yield* Effect.forkChild(b.execute())
    while (admitted.length < 2) yield* Effect.yieldNow
    assert.deepEqual(log.filter(([n]) => n === "switch").map(([, v]) => [v.sessionID, v.model.id]).sort(), [["a", "luna"], ["b", "sol"]])
    const conflict = yield* prepare({ sessionID: "a", model_profile: "inherit" })
    assert.ok(Exit.isFailure(yield* Effect.exit(conflict.execute())))
    yield* Fiber.interrupt(fa)
    yield* Fiber.interrupt(fb)
    const retry = yield* prepare({ sessionID: "a", model_profile: "inherit" })
    const fr = yield* Effect.forkChild(retry.execute())
    while (admitted.length < 3) yield* Effect.yieldNow
    yield* Fiber.interrupt(fr)
  }, (input, context) => Effect.gen(function* () {
    yield* context.progress({ sessionID: input.sessionID ?? input.child, status: "running" })
    admitted.push(input.sessionID ?? input.child)
    yield* Effect.never
  }))
})
