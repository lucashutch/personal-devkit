const allowedCopilotModels = new Set([
  "claude-opus-4.8",
  "claude-sonnet-5",
  "claude-haiku-4.5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
])

export default {
  id: "personal.work-model-filter",
  setup: async (ctx) => {
    await ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        for (const model of record.models.values()) {
          if (model.providerID === "opencode") {
            model.enabled = false
            continue
          }
          if (model.providerID === "github-copilot") {
            model.enabled = allowedCopilotModels.has(model.id)
          }
        }
      }
    })
  },
}
