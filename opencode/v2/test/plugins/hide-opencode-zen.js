export default {
  id: "personal.test-hide-opencode-zen",
  setup: async (ctx) => {
    await ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        if (record.provider.id !== "opencode") continue
        for (const model of record.models.values()) {
          model.enabled = false
        }
      }
    })
  },
}
