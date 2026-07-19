#!/usr/bin/env bun
// V1 only: regenerate or check opencode/v1/shared/plugins/slim-schemas.json
// against a proxy capture. V2's slim-tools patches descriptions in place and
// has no schema snapshot.
// capture. The slim-tools plugin replaces tool JSON schemas wholesale, so the
// snapshot must be refreshed when an opencode upgrade changes tool parameters.
//
// Usage:
//   bun scripts/update-slim-schemas.ts --check   [capture-dir]
//   bun scripts/update-slim-schemas.ts --write   [capture-dir]
//
// capture-dir defaults to the newest folder in the proxy-captures directory.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { slimParamDescriptions } from "../opencode/v1/shared/lib/slim-tools-data"

const CAPTURES_DIR = "/home/lucas/9999-personal/context-proxy-forward/proxy-captures"
const SCHEMAS_PATH = join(dirname(Bun.main), "..", "opencode", "v1", "shared", "plugins", "slim-schemas.json")
const SENTINEL = 9007199254740991

function latestCaptureDir(): string {
  const dirs = readdirSync(CAPTURES_DIR)
    .map((d) => join(CAPTURES_DIR, d))
    .filter((d) => statSync(d).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!dirs.length) throw new Error(`no capture dirs in ${CAPTURES_DIR}`)
  return dirs[0]
}

function extractSchemas(captureDir: string): Record<string, any> {
  const req = JSON.parse(readFileSync(join(captureDir, "request.raw.json"), "utf8"))
  const out: Record<string, any> = {}
  for (const t of req.tools ?? []) {
    const fn = t.function ?? t // openai wraps in {type, function}; anthropic is flat
    const name = fn.name
    const schema = structuredClone(fn.parameters ?? fn.input_schema)
    if (!name || !schema) continue
    delete schema.$schema
    slim(schema, slimParamDescriptions[name] ?? {})
    out[name] = schema
  }
  return out
}

function slim(node: any, params: Record<string, string>) {
  if (Array.isArray(node)) return node.forEach((n) => slim(n, params))
  if (!node || typeof node !== "object") return
  for (const [key, prop] of Object.entries<any>(node.properties ?? {})) {
    if (params[key]) prop.description = params[key]
    for (const bound of ["minimum", "maximum"]) {
      if (typeof prop[bound] === "number" && Math.abs(prop[bound]) >= SENTINEL) delete prop[bound]
    }
  }
  for (const v of Object.values(node)) slim(v, params)
}

// Canonical form for comparison: drop description annotations (string-valued
// only — a *parameter* named "description" is an object and must survive) and
// sort keys so property order doesn't register as drift.
function canonical(node: any): any {
  if (Array.isArray(node)) return node.map(canonical)
  if (!node || typeof node !== "object") return node
  const out: Record<string, any> = {}
  for (const k of Object.keys(node).sort()) {
    if (k === "description" && typeof node[k] === "string") continue
    out[k] = canonical(node[k])
  }
  return out
}

const mode = process.argv[2]
if (mode !== "--check" && mode !== "--write") {
  console.error("usage: bun scripts/update-slim-schemas.ts --check|--write [capture-dir]")
  process.exit(2)
}
const captureDir = process.argv[3] ?? latestCaptureDir()
console.log(`capture: ${captureDir}`)

const captured = extractSchemas(captureDir)
const current: Record<string, any> = JSON.parse(readFileSync(SCHEMAS_PATH, "utf8"))

// Only tools we already track; new opencode tools are opt-in.
let drift = false
for (const name of Object.keys(current)) {
  if (!captured[name]) {
    console.log(`~ ${name}: not present in this capture (model/provider dependent), skipped`)
    continue
  }
  const a = JSON.stringify(canonical(current[name]))
  const b = JSON.stringify(canonical(captured[name]))
  if (a !== b) {
    drift = true
    console.log(`! ${name}: schema drift`)
    console.log(`   snapshot: ${a}`)
    console.log(`   opencode: ${b}`)
  } else {
    console.log(`  ${name}: in sync`)
  }
}

if (mode === "--write") {
  const merged = { ...current }
  for (const name of Object.keys(current)) if (captured[name]) merged[name] = captured[name]
  writeFileSync(SCHEMAS_PATH, JSON.stringify(merged, null, 2) + "\n")
  console.log(`wrote ${SCHEMAS_PATH}`)
} else if (drift) {
  process.exit(1)
}
