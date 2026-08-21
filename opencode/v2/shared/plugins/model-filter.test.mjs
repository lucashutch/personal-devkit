import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  createModelFilterPlugin,
  loadSettings,
  matches,
  modelConfigPath,
  parseRules,
} from "./model-filter.js"

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

test("loadSettings reports missing and invalid config files", () => {
  const dir = mkdtempSync(join(tmpdir(), "model-filter-"))
  try {
    const path = join(dir, "model_config.json")
    assert.throws(() => loadSettings(path), /not found/)
    writeFileSync(path, "{ not json")
    assert.throws(() => loadSettings(path), /model-filter config/)
    writeFileSync(path, JSON.stringify({ deny: ["opencode/*"] }))
    assert.deepEqual(loadSettings(path), { deny: ["opencode/*"] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("modelConfigPath resolves inside XDG_CONFIG_HOME", () => {
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = "/tmp/xdg-example"
  try {
    assert.equal(modelConfigPath(), "/tmp/xdg-example/opencode/model_config.json")
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
  }
})

function fakeCatalog(models) {
  return {
    provider: {
      list: () => [{ models: new Map(models.map((m) => [m.id, m])) }],
    },
  }
}

test("setup applies allowlist mode across the catalog", async () => {
  const dir = mkdtempSync(join(tmpdir(), "model-filter-"))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  mkdirSync(join(dir, "opencode"))
  writeFileSync(
    join(dir, "opencode", "model_config.json"),
    JSON.stringify({ allow: ["openai/gpt-5.6-sol"] }),
  )
  try {
    const models = [
      { providerID: "openai", id: "gpt-5.6-sol", enabled: true },
      { providerID: "openai", id: "gpt-5.6", enabled: true },
      { providerID: "opencode", id: "big-pickle", enabled: true },
    ]
    await createModelFilterPlugin().setup({
      catalog: { transform: async (fn) => fn(fakeCatalog(models)) },
    })
    assert.deepEqual(models.map((m) => m.enabled), [true, false, false])
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setup applies denylist mode without touching other models", async () => {
  const dir = mkdtempSync(join(tmpdir(), "model-filter-"))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  mkdirSync(join(dir, "opencode"))
  writeFileSync(
    join(dir, "opencode", "model_config.json"),
    JSON.stringify({ deny: ["opencode/*"] }),
  )
  try {
    const models = [
      { providerID: "openai", id: "gpt-5.6-sol", enabled: true },
      { providerID: "opencode", id: "big-pickle", enabled: true },
      { providerID: "prompt-capture-openai", id: "gpt-5.6-sol", enabled: true },
    ]
    await createModelFilterPlugin().setup({
      catalog: { transform: async (fn) => fn(fakeCatalog(models)) },
    })
    assert.deepEqual(models.map((m) => m.enabled), [true, false, true])
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
