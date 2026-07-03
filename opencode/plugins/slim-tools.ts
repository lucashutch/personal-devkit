import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import slimSchemas from "./slim-schemas.json"
import { slimDescriptions, slimParamDescriptions } from "./slim-tools-data"

const driftLog = join(homedir(), ".config", "opencode", "plugin-logs", "slim-tools-drift.log")
const warnedTools = new Set<string>()

function warnDrift(toolID: string, snapshot: string, actual: string) {
  if (warnedTools.has(toolID)) return
  warnedTools.add(toolID)
  const msg = `slim-tools: schema drift for '${toolID}' (snapshot: ${snapshot}; opencode: ${actual}); using stock schema. Rerun scripts/update-slim-schemas.ts.`
  console.warn(msg)
  try {
    mkdirSync(join(homedir(), ".config", "opencode", "plugin-logs"), { recursive: true })
    appendFileSync(driftLog, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

function patchSchemaNode(node: any, params: Record<string, string>) {
  if (!node || typeof node !== "object") return

  const props = node.properties
  if (props) {
    for (const [name, desc] of Object.entries(params)) {
      if (props[name]) props[name].description = desc
    }
  }

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[key])) node[key].forEach((sub: any) => patchSchemaNode(sub, params))
  }
  if (node.items) patchSchemaNode(node.items, params)
}

// Built-in tools carry an Effect schema in `parameters` and leave `jsonSchema`
// undefined; the AI SDK derives the JSON schema from `parameters` later, so
// mutating it in the hook is invisible. The supported override is supplying a
// complete `jsonSchema`, so we ship full replacement schemas with slim
// descriptions. slim-schemas.json is generated from proxy captures by
// scripts/update-slim-schemas.ts -- do not edit it by hand; rerun the script
// after opencode upgrades.
function applySlimSchema(tool: any, toolID: string) {
  if (tool.jsonSchema) {
    // A future opencode may pre-populate jsonSchema; patch it instead.
    patchSchemaNode(tool.jsonSchema, slimParamDescriptions[toolID] ?? {})
    return
  }
  const schema = (slimSchemas as Record<string, any>)[toolID]
  if (!schema) return

  // Guard against drift: only override when our snapshot still matches the
  // tool's real parameter names, otherwise keep opencode's stock schema.
  const fields = tool.parameters?.fields
  if (fields && typeof fields === "object") {
    const actual = Object.keys(fields).sort().join(",")
    const snapshot = Object.keys(schema.properties ?? {}).sort().join(",")
    if (actual !== snapshot) {
      warnDrift(toolID, snapshot, actual)
      return
    }
  }
  tool.jsonSchema = schema
}

export const SlimToolsPlugin: Plugin = async () => {
  return {
    "tool.definition": async (input: any, output: any) => {
      const toolID = input.toolID ?? input.tool ?? input.name

      if (slimDescriptions[toolID]) {
        output.description = slimDescriptions[toolID]
      }

      applySlimSchema(output, toolID)
    },
  }
}
