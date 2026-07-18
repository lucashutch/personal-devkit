import assert from "node:assert/strict"
import test from "node:test"

import {
  addModelProfile,
  aliasID,
  createDelegateProfilesPlugin,
  parseModelRef,
  parseProfiles,
} from "./delegate-profiles.js"

const options = {
  profiles: {
    fast: "capture/luna#low",
    standard: "capture/terra#medium",
    deep: "capture/sol#high",
  },
}

test("parseModelRef returns a V2 model reference", () => {
  assert.deepEqual(parseModelRef("openai/gpt-5.6-sol#high"), {
    providerID: "openai",
    id: "gpt-5.6-sol",
    variant: "high",
  })
  assert.throws(() => parseModelRef("gpt-5.6-sol"), /provider\/model/)
  assert.throws(() => parseModelRef("openai/model#"), /provider\/model/)
})

test("parseProfiles requires every preset", () => {
  assert.deepEqual(parseProfiles(options).standard, {
    providerID: "capture",
    id: "terra",
    variant: "medium",
  })
  assert.throws(() => parseProfiles({ profiles: { fast: "capture/luna" } }), /profiles.standard/)
})

test("addModelProfile augments a clone of the native schema", () => {
  const schema = {
    type: "object",
    properties: { agent: { type: "string" } },
    required: ["agent"],
  }
  const patched = addModelProfile(schema)
  assert.equal(schema.properties.model_profile, undefined)
  assert.deepEqual(patched.properties.model_profile.enum, ["fast", "standard", "deep", "inherit"])
  assert.deepEqual(patched.required, ["agent", "model_profile"])
})

test("plugin advertises model_profile and routes execution through a hidden alias", async () => {
  const hooks = {}
  const aliases = new Map()
  const disposed = []
  const source = {
    id: "Researcher",
    name: "Researcher",
    mode: "subagent",
    hidden: false,
    permissions: [{ action: "edit", resource: "*", effect: "deny" }],
    request: { headers: {}, body: {} },
  }
  const ctx = {
    options,
    agent: {
      get: async (id) => id === source.id ? source : aliases.get(id),
      transform: async (callback) => {
        callback({
          update: (id, update) => {
            const value = aliases.get(id) ?? { id }
            update(value)
            value.id = id
            aliases.set(id, value)
          },
        })
        return { dispose: async () => disposed.push("alias") }
      },
    },
    session: {
      hook: async (name, callback) => {
        hooks[name] = callback
        return { dispose: async () => disposed.push(name) }
      },
    },
    tool: {
      hook: async (name, callback) => {
        hooks[name] = callback
        return { dispose: async () => disposed.push(name) }
      },
    },
  }

  const cleanup = await createDelegateProfilesPlugin().setup(ctx)
  const context = {
    tools: {
      subagent: {
        description: "native",
        input: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] },
      },
    },
  }
  await hooks.context(context)
  assert.deepEqual(context.tools.subagent.input.properties.model_profile.enum, ["fast", "standard", "deep", "inherit"])

  const event = {
    tool: "subagent",
    input: { agent: "Researcher", description: "Probe", prompt: "Check", model_profile: "deep" },
  }
  await hooks["execute.before"](event)
  const expected = aliasID("Researcher", "deep")
  assert.equal(event.input.agent, expected)
  assert.equal(event.input.model_profile, undefined)
  assert.deepEqual(aliases.get(expected).model, {
    providerID: "capture",
    id: "sol",
    variant: "high",
  })
  assert.equal(aliases.get(expected).hidden, true)
  assert.deepEqual(aliases.get(expected).permissions, source.permissions)

  await cleanup()
  assert.deepEqual(disposed, ["alias", "execute.before", "context"])
})
