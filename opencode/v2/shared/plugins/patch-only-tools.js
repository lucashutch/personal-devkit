import { patchInput, patchDescription } from "../lib/patch-tool-data.js"

// OpenCode advertises the builtin patch tool only to gpt-* models and gives
// every other model edit and write instead. Its gate runs in the same session
// context hook and deletes from the same record, so this plugin reverses the
// swap for all models: drop edit and write, then re-advertise patch. External
// hooks run after the builtin ones, so patch is already gone by the time this
// runs and has to be added back rather than preserved.
//
// Only the advertisement is model-facing. The builtin patch tool is always
// registered, so execution, permissions, and the TUI diff rendering keep using
// OpenCode's implementation; nothing here reimplements patching.
//
// One description for every model. gpt-* models emit the format from a bare
// one-line description because they were trained on it, but the measured saving
// is 13 tokens and a per-model branch means a model-name test that rots as
// providers rename models. See patch-only-findings.md.

export function patchOnlyTools(tools) {
  if (!tools || typeof tools !== "object") return tools
  delete tools.edit
  delete tools.write
  tools.patch = {
    description: patchDescription,
    input: tools.patch?.input ?? structuredClone(patchInput),
  }
  return tools
}

export default {
  id: "personal.patch-only-tools",
  setup: async (ctx) => {
    await ctx.session.hook("context", (event) => {
      patchOnlyTools(event.tools)
    })
  },
}
