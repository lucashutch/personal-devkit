import assert from "node:assert/strict"
import test from "node:test"

import { createModelFilterPlugin, matches, parseRules } from "./model-filter.js"

test("parseRules accepts an allowlist", () => {
  const { allow, deny } = parseRules({ allow: ["openai/gpt-5.6-sol", "opencode/*", "*free*"] })
  assert.deepEqual(allow, [
    { providerID: "openai", id: "gpt-5.6-sol" },
    { providerID: "opencode", id: "*" },
    { providerID: "*", id: "*free*" },
  ])
  assert.deepEqual(deny, [])
})

test("parseRules rejects malformed and ambiguous settings", () => {
  assert.throws(() => parseRules({}), /at least one/)
  assert.throws(() => parseRules({ allow: [], deny: [] }), /at least one/)
  assert.throws(() => parseRules({ allow: ["a/b"], deny: ["c/d"] }), /not both/)
  assert.throws(() => parseRules({ allow: "openai/sol" }), /must be an array/)
  assert.throws(() => parseRules({ allow: ["no-provider"] }), /provider\/model/)
  assert.throws(() => parseRules({ deny: ["openai/"] }), /provider\/model/)
})

test("matches honors exact IDs and glob wildcards", () => {
  const { allow } = parseRules({ allow: ["openai/gpt-5.6-sol", "opencode/*", "*free*"] })
  assert.equal(matches(allow, "openai", "gpt-5.6-sol"), true)
  assert.equal(matches(allow, "openai", "gpt-5.6-sol-fast"), false)
  assert.equal(matches(allow, "opencode", "big-pickle"), true)
  assert.equal(matches(allow, "github-copilot", "gpt-5.6-sol"), false)
  assert.equal(matches(allow, "opencode", "deepseek-v4-flash-free"), true)
  assert.equal(matches(allow, "other-provider", "free-model"), true)
})

function fakeCatalog(models) {
  return {
    provider: {
      list: () => [{ models: new Map(models.map((m) => [m.id, m])) }],
    },
  }
}

test("setup applies allowlist mode across the catalog", async () => {
  const models = [
    { providerID: "openai", id: "gpt-5.6-sol", enabled: true },
    { providerID: "openai", id: "gpt-5.6", enabled: true },
    { providerID: "opencode", id: "big-pickle", enabled: true },
  ]
  await createModelFilterPlugin().setup({
    options: { allow: ["openai/gpt-5.6-sol"] },
    catalog: { transform: async (fn) => fn(fakeCatalog(models)) },
  })
  assert.deepEqual(models.map((m) => m.enabled), [true, false, false])
})

test("setup applies denylist mode without touching other models", async () => {
  const models = [
    { providerID: "openai", id: "gpt-5.6-sol", enabled: true },
    { providerID: "opencode", id: "big-pickle", enabled: true },
    { providerID: "prompt-capture-openai", id: "gpt-5.6-sol", enabled: true },
  ]
  await createModelFilterPlugin().setup({
    options: { deny: ["opencode/*"] },
    catalog: { transform: async (fn) => fn(fakeCatalog(models)) },
  })
  assert.deepEqual(models.map((m) => m.enabled), [true, false, true])
})
