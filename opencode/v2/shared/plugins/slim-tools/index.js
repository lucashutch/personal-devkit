import { Plugin } from "@opencode-ai/plugin"
import { slimDescriptions, slimParamDescriptions } from "../../lib/slim-tools-data.js"

// V2's session context hook receives the final, permission-filtered tool
// record immediately before the model request is built. Unlike the previous
// AI-SDK language-hook workaround, it covers both native and AI-SDK provider
// routes.

function patchSchemaNode(node, params) {
  if (!node || typeof node !== "object") return

  const props = node.properties
  if (props) {
    for (const [name, desc] of Object.entries(params)) {
      if (props[name]) props[name] = { ...props[name], description: desc }
    }
    node.properties = { ...props }
    Object.values(node.properties).forEach((sub) => patchSchemaNode(sub, params))
  }

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[key])) node[key].forEach((sub) => patchSchemaNode(sub, params))
  }
  if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((sub) => patchSchemaNode(sub, params))
  if (node.items) patchSchemaNode(node.items, params)
}

function slimTool(name, tool) {
  if (!tool || typeof tool !== "object") return tool
  const description = slimDescriptions[name]
  const params = slimParamDescriptions[name]
  if (!description && !params) return tool

  const next = { ...tool }
  if (description) next.description = description
  if (params && next.input) {
    next.input = structuredClone(next.input)
    patchSchemaNode(next.input, params)
  }
  return next
}

function slimTools(tools) {
  if (!tools || typeof tools !== "object") return tools
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, slimTool(name, tool)]))
}

export default Plugin.define({
  id: "personal.slim-tools",
  setup: async (ctx) => {
    await ctx.session.hook("context", (event) => {
      event.tools = slimTools(event.tools)
    })
  },
})
