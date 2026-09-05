import { Plugin } from "@opencode-ai/plugin"
import { slimDescriptions, slimParamDescriptions } from "../../lib/slim-tools-data.js"

// V2's session context hook receives the final, permission-filtered tool
// record immediately before the model request is built. Unlike the previous
// AI-SDK language-hook workaround, it covers both native and AI-SDK provider
// routes.

function resolveRef(node, root) {
  if (typeof node?.$ref !== "string" || !node.$ref.startsWith("#/")) return undefined
  return node.$ref.slice(2).split("/").reduce((value, part) => value?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], root)
}

function patchPath(node, path, description, root, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return
  seen.add(node)
  const ref = resolveRef(node, root)
  if (ref) patchPath(ref, path, description, root, seen)
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[key])) node[key].forEach((part) => patchPath(part, path, description, root, seen))
  }
  const [name, ...rest] = path
  const child = name === "*" ? node.items : node.properties?.[name]
  if (!child) return
  if (rest.length === 0) node.properties[name] = { ...child, description }
  else patchPath(child, rest, description, root, seen)
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
    for (const [param, description] of Object.entries(params)) {
      const path = name === "question"
        ? ({ question: ["questions", "*", "question"], header: ["questions", "*", "header"], options: ["questions", "*", "options"], label: ["questions", "*", "options", "*", "label"], description: ["questions", "*", "options", "*", "description"], multiple: ["questions", "*", "multiple"] }[param] ?? [param])
        : [param]
      patchPath(next.input, path, description, next.input)
    }
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
