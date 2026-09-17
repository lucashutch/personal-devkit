import assert from "node:assert/strict"
import test from "node:test"

import { applyEstimatedCosts } from "./estimated-api-costs/index.js"

function editor(models, sources) {
  return {
    list: (providerID) => models.filter((model) => model.providerID === providerID),
    provider: { get: (providerID) => providerID === "openai" ? { models: new Map(sources.map((model) => [model.id, model])) } : undefined },
    update: (providerID, id, update) => update(models.find((model) => model.providerID === providerID && model.id === id)),
  }
}

test("zero-priced OpenAI models inherit catalog costs", () => {
  const models = [{ providerID: "openai", id: "gpt-5.6-luna", cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] }]
  const sourceCost = [{ input: 0.2, output: 1.2, cache: { read: 0.02, write: 0.25 } }]
  applyEstimatedCosts(editor(models, [{ id: "gpt-5.6-luna", cost: sourceCost }]))
  assert.deepEqual(models[0].cost, sourceCost)
  assert.notEqual(models[0].cost, sourceCost)
})

test("existing prices are preserved and fast aliases use their base model", () => {
  const models = [
    { providerID: "openai", id: "gpt-5.6-sol", cost: [{ input: 3, output: 15, cache: { read: 0, write: 0 } }] },
    { providerID: "openai", id: "gpt-5.6-sol-fast", cost: [] },
    { providerID: "other", id: "gpt-5.6-sol", cost: [] },
  ]
  const source = { id: "gpt-5.6-sol", cost: [{ input: 4, output: 20, cache: { read: 0.4, write: 5 } }] }
  applyEstimatedCosts(editor(models, [source]))
  assert.equal(models[0].cost[0].input, 3)
  assert.deepEqual(models[1].cost, source.cost)
  assert.deepEqual(models[2].cost, [])
})

test("missing and zero-priced catalog entries do not invent prices", () => {
  const models = [{ providerID: "openai", id: "unknown", cost: [] }]
  applyEstimatedCosts(editor(models, [{ id: "unknown", cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] }]))
  assert.deepEqual(models[0].cost, [])
})
