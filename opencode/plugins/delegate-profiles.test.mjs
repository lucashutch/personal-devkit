import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { Effect, Exit, Fiber } from "effect"
import { Tool } from "@opencode/schema/tool"
import {
  addModelProfile,
  createDelegateProfilesPlugin,
  formatTaskFitMatrix,
  parseConfig,
  parseModelRef,
} from "./delegate-profiles/index.js"

const settings = {
  models: {
    luna: {
      model: "openai/luna",
      efforts: { low: "low", medium: "medium", high: null },
      scores: { coding: 9, research: 6 },
      description: "Fast implementation model",
    },
    terra: {
      model: "openai/terra",
      efforts: { low: "low", medium: "medium", high: "xhigh" },
      scores: { coding: 7, research: 9 },
      description: "Balanced research model",
    },
    twin: {
      model: "openai/luna",
      efforts: { low: "medium", medium: "medium", high: "medium" },
      scores: { coding: 8 },
      description: "An alternate alias for luna",
    },
  },
  defaults: { Worker: { model: "terra", effort: "high" } },
}

const config = parseConfig(settings)
const run = (fn, native) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const hooks = {}, log = [], active = {}
  let transform
  const catalog = [
    { providerID: "openai", id: "luna", enabled: true, variants: [{ id: "low" }, { id: "medium" }, { id: "high" }] },
    { providerID: "openai", id: "terra", enabled: true, variants: [{ id: "low" }, { id: "medium" }, { id: "xhigh" }] },
  ]
  const result = { content: "native", metadata: { native: true } }
  const tool = { execute: native ?? ((input, context) => Effect.gen(function* () {
    log.push(["native", input])
    yield* context.progress({ sessionID: input.sessionID ?? input.child ?? "child", status: "running" })
    log.push(["prompt", input.background ?? false])
    return result
  })) }
  const register = (name, callback) => Effect.sync(() => { hooks[name] = callback })
  yield* createDelegateProfilesPlugin().effect({
    options: settings,
    agent: { list: () => Effect.succeed({ data: [
      { id: "Worker", mode: "subagent" },
      { id: "Other", mode: "subagent" },
      { id: "Hidden", mode: "subagent", hidden: true },
      { id: "Primary", mode: "primary" },
    ] }) },
    catalog: { model: { list: () => Effect.succeed({ data: catalog }) } },
    session: {
      hook: register,
      get: ({ sessionID }) => Effect.succeed({ id: sessionID, model: active[sessionID] }),
      switchModel: (input) => Effect.sync(() => { log.push(["switch", input]); active[input.sessionID] = input.model; return {} }),
    },
    tool: {
      hook: register,
      transform: (callback) => Effect.sync(() => { transform = callback; callback({ update: (_, fn) => fn(tool) }) }),
    },
  })
  let sequence = 0
  const prepare = (input = {}, agent = "Worker", identity = {}) => Effect.gen(function* () {
    const event = {
      tool: "subagent", sessionID: "parent", messageID: "message", id: String(++sequence), ...identity,
      input: { agent, ...input },
    }
    yield* hooks["execute.before"](event)
    return {
      event,
      execute: () => tool.execute(event.input, {
        ...event,
        progress: (update) => Effect.sync(() => log.push(["progress", update])),
      }),
    }
  })
  const context = { tools: { subagent: { description: "native description", input: {
    type: "object", properties: { agent: { type: "string" } }, required: ["agent"],
  } } } }
  yield* fn({ hooks, log, active, catalog, tool, result, prepare, context,
    replay: () => transform({ update: (_, fn) => fn(tool) }) })
})))

test("config mappings and schema are compact and optional", () => {
  assert.deepEqual(parseModelRef("openai/a#low"), { providerID: "openai", id: "a", variant: "low" })
  assert.deepEqual(config.models.luna.efforts, { low: "low", medium: "medium", high: null })
  assert.throws(() => parseModelRef("openai/a#"))
  assert.throws(() => parseConfig({ models: {} }))
  assert.throws(() => parseConfig({ models: { bad: {
    model: "openai/a", efforts: { low: "low", medium: "medium", high: "high" }, scores: { coding: 11 }, description: "bad",
  } } }))
  assert.throws(() => parseConfig({ ...settings, defaults: { Worker: { model: "missing", effort: "low" } } }))
  const missingMapping = structuredClone(settings)
  delete missingMapping.models.luna.efforts.high
  assert.throws(() => parseConfig(missingMapping), /efforts.high/)
  const schema = addModelProfile(
    { type: "object", properties: { agent: { type: "string" }, model_profile: { type: "string" } }, required: ["agent", "model_profile"] },
    [{ id: "Worker", mode: "subagent" }, { id: "Primary", mode: "primary" }],
    config,
  )
  assert.deepEqual(schema.properties.agent.enum, ["Worker"])
  assert.deepEqual(schema.properties.model.enum, ["luna", "terra", "twin", "inherit"])
  assert.deepEqual(schema.properties.effort.enum, ["low", "medium", "high"])
  assert.deepEqual(schema.required, ["agent"])
  assert.match(schema.properties.model.description, /luna=Fast implementation model/)
  assert.match(schema.properties.effort.description, /uniform across aliases/)
  assert.match(formatTaskFitMatrix(config.models), /\| model \| coding \| research \|/)
  assert.match(formatTaskFitMatrix(config.models), /\| luna \| 9\/10 \| 6\/10 \|/)
  assert.match(formatTaskFitMatrix(config.models), /\| twin \| 8\/10 \| \? \|/)
})

test("native forwarding, aliases, null variants, role defaults, and ordering", () => run(function* ({ prepare, log, result }) {
  const explicit = yield* prepare({ model: "luna", background: true })
  assert.equal(explicit.event.input.model, undefined)
  assert.equal(yield* explicit.execute(), result)
  assert.deepEqual(log.map(([name]) => name), ["native", "switch", "progress", "prompt"])
  assert.deepEqual(log.find(([name]) => name === "switch")[1].model, { providerID: "openai", id: "luna", variant: "medium" })
  assert.equal(log.find(([name]) => name === "native")[1].model, undefined)

  log.length = 0
  const nativeVariant = yield* prepare({ model: "luna", effort: "high" })
  assert.equal(nativeVariant.event.input.effort, undefined)
  yield* nativeVariant.execute()
  assert.deepEqual(log.find(([name]) => name === "switch")[1].model, { providerID: "openai", id: "luna" })

  log.length = 0
  const roleDefault = yield* prepare({})
  yield* roleDefault.execute()
  assert.deepEqual(log.find(([name]) => name === "switch")[1].model, { providerID: "openai", id: "terra", variant: "xhigh" })

  log.length = 0
  const roleEffort = yield* prepare({ effort: "low" })
  yield* roleEffort.execute()
  assert.deepEqual(log.find(([name]) => name === "switch")[1].model, { providerID: "openai", id: "terra", variant: "low" })

  log.length = 0
  const noDefault = yield* prepare({ model: "inherit" }, "Other")
  assert.equal((yield* noDefault.execute()).content, "native")
  assert.equal(log.some(([name]) => name === "switch"), false)
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ effort: "low" }, "Other"))))
}))

test("several uniform efforts can select the same native variant", () => run(function* ({ prepare, log }) {
  for (const effort of ["low", "medium", "high"]) {
    log.length = 0
    yield* (yield* prepare({ model: "twin", effort })).execute()
    assert.deepEqual(log.find(([name]) => name === "switch")[1].model,
      { providerID: "openai", id: "luna", variant: "medium" })
  }
}))

test("managed profiles load and retain the Advisor model default", () => {
  for (const profile of ["default", "test"]) {
    const document = JSON.parse(readFileSync(new URL(`../${profile}/opencode.json`, import.meta.url), "utf8"))
    const options = document.plugins.find((entry) => entry.package === "./extensions/delegate-profiles").options
    const parsed = parseConfig(options)
    assert.deepEqual(parsed.defaults.Advisor, { model: "astra", effort: "medium" })
    assert.equal(parsed.models.astra.model.id, "gpt-6-astra")
    if (profile === "test") {
      for (const { model } of Object.values(parsed.models)) {
        assert.ok(document.providers[model.providerID].models[model.id])
      }
    }
  }
})

test("tool description gets a task-fit matrix without role details", () => run(function* ({ hooks, context }) {
  yield* hooks.context(context)
  assert.match(context.tools.subagent.description, /Estimated task fit \(\/10\):/)
  assert.match(context.tools.subagent.description, /\| model \| coding \| research \|/)
  assert.match(context.tools.subagent.description, /\| twin \| 8\/10 \| \? \|/)
  assert.match(context.tools.subagent.description, /Subjective task-fit estimates at medium effort, not benchmarks; \? means unrated\. Scores exclude cost and latency\./)
  assert.doesNotMatch(context.tools.subagent.description, /Available agent roles/)
  assert.deepEqual(context.tools.subagent.input.properties.model.enum, ["luna", "terra", "twin", "inherit"])
}))

test("invalid choices and catalog mappings fail before native", () => run(function* ({ prepare, catalog, log }) {
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ model: "unknown" }))))
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ effort: "invalid" }))))
  const legacy = yield* prepare({ model_profile: "deep" }).pipe(Effect.catch((error) => Effect.succeed(error)))
  assert.match(legacy.message, /model_profile is no longer supported/)
  catalog[0].enabled = false
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ model: "luna" }, "Other"))))
  catalog[0].enabled = true
  catalog[0].variants = [{ id: "low" }]
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ model: "luna", effort: "medium" }, "Other"))))
  assert.equal(log.some(([name]) => name === "native"), false)
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ model: "luna" }, "Hidden"))))
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ model: "luna" }, "Primary"))))
}))

test("resume preserves native selection, compares model and variant, and rejects effort-only", () => run(function* ({ prepare, active, log }) {
  active.old = { providerID: "openai", id: "luna", variant: "medium" }
  const preserved = yield* prepare({ sessionID: "old" })
  yield* preserved.execute()
  assert.equal(log.some(([name]) => name === "switch"), false)
  log.length = 0

  const inherited = yield* prepare({ sessionID: "old", model: "inherit" })
  yield* inherited.execute()
  assert.equal(log.some(([name]) => name === "switch"), false)
  log.length = 0

  const explicit = yield* prepare({ sessionID: "old", model: "twin" })
  yield* explicit.execute()
  assert.equal(log.some(([name]) => name === "switch"), false)
  assert.ok(Exit.isFailure(yield* Effect.exit(prepare({ sessionID: "old", effort: "low" }))))
  const mismatch = yield* prepare({ sessionID: "old", model: "terra" })
  assert.ok(Exit.isFailure(yield* Effect.exit(mismatch.execute())))
  active.native = { providerID: "openai", id: "luna" }
  const nullVariant = yield* prepare({ sessionID: "native", model: "luna", effort: "high" })
  yield* nullVariant.execute()
}))

test("concurrent locks clean up after cancellation", () => {
  const admitted = []
  return run(function* ({ prepare, log }) {
    const first = yield* prepare({ model: "luna", child: "a" })
    const second = yield* prepare({ model: "terra", child: "b" })
    const firstFiber = yield* Effect.forkChild(first.execute())
    const secondFiber = yield* Effect.forkChild(second.execute())
    while (admitted.length < 2) yield* Effect.yieldNow
    assert.deepEqual(log.filter(([name]) => name === "switch").map(([, value]) => [value.sessionID, value.model.id]).sort(), [["a", "luna"], ["b", "terra"]])
    const conflict = yield* prepare({ sessionID: "a", model: "inherit" })
    assert.ok(Exit.isFailure(yield* Effect.exit(conflict.execute())))
    yield* Fiber.interrupt(firstFiber)
    yield* Fiber.interrupt(secondFiber)
    const retry = yield* prepare({ sessionID: "a", model: "inherit" })
    const retryFiber = yield* Effect.forkChild(retry.execute())
    while (admitted.length < 3) yield* Effect.yieldNow
    yield* Fiber.interrupt(retryFiber)
  }, (input, context) => Effect.gen(function* () {
    yield* context.progress({ sessionID: input.sessionID ?? input.child, status: "running" })
    admitted.push(input.sessionID ?? input.child)
    yield* Effect.never
  }))
})

test("transform replay preserves execution and after-hook clears unused selections", () => run(function* ({ prepare, replay, hooks, log }) {
  replay(); replay()
  yield* (yield* prepare({ model: "luna" })).execute()
  assert.equal(log.filter(([name]) => name === "switch").length, 1)
  const discarded = yield* prepare({ model: "terra" })
  yield* hooks["execute.after"](discarded.event)
  assert.ok(Exit.isFailure(yield* Effect.exit(discarded.execute())))
}))

test("native failure identity is preserved", () => {
  const error = new Tool.Error({ message: "native error" })
  return run(function* ({ prepare }) {
    const call = yield* prepare({ model: "luna" }, "Other")
    const actual = yield* call.execute().pipe(Effect.catch((cause) => Effect.succeed(cause)))
    assert.equal(actual, error)
  }, () => Effect.fail(error))
})
