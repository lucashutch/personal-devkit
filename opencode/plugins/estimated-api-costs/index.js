import { Plugin } from "@opencode/plugin"

function hasPrice(cost) {
  return cost?.some((tier) => tier.input > 0 || tier.output > 0 || tier.cache?.read > 0 || tier.cache?.write > 0)
}

function sourceModel(models, id) {
  return models.get(id) ?? (id.endsWith("-fast") ? models.get(id.slice(0, -5)) : undefined)
}

export function applyEstimatedCosts(editor, providerID = "openai") {
  const catalog = editor.provider.get(providerID)
  if (!catalog) return

  for (const model of editor.list(providerID)) {
    if (hasPrice(model.cost)) continue
    const source = sourceModel(catalog.models, model.id)
    if (!hasPrice(source?.cost)) continue
    editor.update(providerID, model.id, (draft) => {
      draft.cost = structuredClone(source.cost)
    })
  }
}

export function createEstimatedApiCostsPlugin() {
  return Plugin.define({
    id: "personal.estimated-api-costs",
    setup: async (context) => {
      await context.model.transform((editor) => applyEstimatedCosts(editor))
    },
  })
}

export default createEstimatedApiCostsPlugin()
