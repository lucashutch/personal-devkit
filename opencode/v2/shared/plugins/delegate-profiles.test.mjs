import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  addModelProfile,
  aliasID,
  createDelegateProfilesPlugin,
  delegateConfigPath,
  loadSettings,
  parseModelRef,
  parseProfiles,
} from "./delegate-profiles.js"

const settings = {
  presets: {
    fast: { model: "openai/luna", variant: "low" },
    balanced: { model: "openai/terra", variant: "medium" },
    deep: { model: "openai/sol", variant: "high" },
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
  assert.deepEqual(parseProfiles(settings).standard, {
    providerID: "openai",
    id: "terra",
    variant: "medium",
  })
  assert.deepEqual(parseProfiles(settings).deep, {
    providerID: "openai",
    id: "sol",
    variant: "high",
  })
  const withoutVariants = structuredClone(settings)
  delete withoutVariants.presets.fast.variant
  assert.deepEqual(parseProfiles(withoutVariants).fast, {
    providerID: "openai",
    id: "luna",
  })
  assert.throws(() => parseProfiles({ presets: { fast: settings.presets.fast } }), /presets.balanced/)
})

test("loadSettings uses the active profile config root", () => {
  const root = mkdtempSync(join(tmpdir(), "delegate-profiles-"))
  const previous = process.env.XDG_CONFIG_HOME
  try {
    process.env.XDG_CONFIG_HOME = root
    const path = delegateConfigPath()
    assert.throws(() => loadSettings(), /not found.*link-config\.py/is)
    mkdirSync(join(root, "opencode"))
    writeFileSync(path, JSON.stringify(settings))
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("addModelProfile augments a clone of the native schema", () => {
  const schema = {
    type: "object",
    properties: { agent: { type: "string" } },
    required: ["agent"],
  }
  const patched = addModelProfile(schema, [
    { id: "Director", mode: "primary", hidden: false },
    { id: "WebResearcher", mode: "subagent", hidden: false },
    { id: "internal", mode: "subagent", hidden: true },
  ])
  assert.equal(schema.properties.model_profile, undefined)
  assert.deepEqual(patched.properties.agent.enum, ["WebResearcher"])
  assert.match(patched.properties.agent.description, /model_profile/)
  assert.deepEqual(patched.properties.model_profile.enum, ["fast", "standard", "deep", "inherit"])
  assert.deepEqual(patched.required, ["agent", "model_profile"])
})

test("plugin advertises model_profile and routes execution through a hidden alias", async () => {
  const root = mkdtempSync(join(tmpdir(), "delegate-profiles-"))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = root
  const configDir = join(root, "opencode")
  mkdirSync(configDir)
  writeFileSync(join(configDir, "delegate_config.json"), JSON.stringify(settings))
  try {
  const hooks = {}
  const aliases = new Map()
  const disposed = []
  const source = {
    id: "WebResearcher",
    name: "WebResearcher",
    mode: "subagent",
    hidden: false,
    permissions: [{ action: "edit", resource: "*", effect: "deny" }],
    request: { headers: {}, body: {} },
  }
  const ctx = {
    agent: {
      // Mirrors the host: `{ agentID }` in, `{ location, data }` out, and a
      // rejection rather than `undefined` when the agent does not exist.
      get: async (input) => {
        if (typeof input?.agentID !== "string") throw new Error("Expected string, got undefined")
        const found = input.agentID === source.id ? source : aliases.get(input.agentID)
        if (!found) throw new Error(`Agent not found: ${input.agentID}`)
        return { location: {}, data: found }
      },
      list: async () => ({ data: [source] }),
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
  assert.deepEqual(context.tools.subagent.input.properties.agent.enum, ["WebResearcher"])
  assert.match(context.tools.subagent.description, /profile names are not agent names/)

  const event = {
    tool: "subagent",
    input: { agent: "WebResearcher", description: "Probe", prompt: "Check", model_profile: "deep" },
  }
  await hooks["execute.before"](event)
  const expected = aliasID("WebResearcher", "deep")
  assert.equal(event.input.agent, expected)
  assert.equal(event.input.model_profile, undefined)
  assert.deepEqual(aliases.get(expected).model, {
    providerID: "openai",
    id: "sol",
    variant: "high",
  })
  assert.equal(aliases.get(expected).hidden, true)
  assert.deepEqual(aliases.get(expected).permissions, source.permissions)

  await cleanup()
  assert.deepEqual(disposed, ["alias", "execute.before", "context"])
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})
