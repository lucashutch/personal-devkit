import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin"

// Catalog-level model filter driven by the active profile's model_config.json,
// mirroring how delegate-profiles resolves delegate_config.json. Stopgap until
// V2 regains native whitelist support; per-model `disabled` blocklists rot as
// providers add models, so profiles declare a small allowlist instead.
//
// Config shape (rules are "provider/model" strings; `*` is a glob wildcard).
// A model-only glob such as "*free*" applies to every provider.
//   { "allow": [...] }  -> whitelist mode: everything unlisted is disabled
//   { "deny": [...] }   -> blocklist mode: only listed models are disabled

export function modelConfigPath() {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(configHome, "opencode", "model_config.json")
}

export function loadSettings(path = modelConfigPath()) {
  if (!existsSync(path)) {
    throw new Error(
      `model-filter config not found at ${path}. The active profile has not linked its `
      + "model_config.json; run scripts/link-config.py for this profile and restart OpenCode.",
    )
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`model-filter config ${path}: ${message}`)
  }
}

function parseRuleList(source, label) {
  if (source === undefined) return []
  if (!Array.isArray(source)) throw new Error(`model-filter settings.${label} must be an array`)
  return source.map((value, index) => {
    const ref = `model-filter settings.${label}[${index}]`
    if (typeof value !== "string") throw new Error(`${ref} must be a provider/model string or model glob`)
    const providerEnd = value.indexOf("/")
    if (providerEnd === -1) {
      if (!value.includes("*")) throw new Error(`${ref} must be a provider/model string or model glob`)
      return { providerID: "*", id: value }
    }
    const providerID = value.slice(0, providerEnd)
    const id = value.slice(providerEnd + 1)
    if (providerEnd <= 0 || !id) throw new Error(`${ref} must be a provider/model string or model glob`)
    return { providerID, id }
  })
}

export function parseRules(configured) {
  const allow = parseRuleList(configured?.allow, "allow")
  const deny = parseRuleList(configured?.deny, "deny")
  if (allow.length > 0 && deny.length > 0) {
    throw new Error("model-filter settings must set either allow or deny, not both")
  }
  if (allow.length === 0 && deny.length === 0) {
    throw new Error("model-filter settings must list at least one allow or deny rule")
  }
  return { allow, deny }
}

export function matches(rules, providerID, id) {
  return rules.some((rule) => globMatches(rule.providerID, providerID) && globMatches(rule.id, id))
}

function globMatches(pattern, value) {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${expression}$`).test(value)
}

export function createModelFilterPlugin() {
  return Plugin.define({
    id: "personal.model-filter",
    setup: async (ctx) => {
      const { allow, deny } = parseRules(loadSettings())
      await ctx.catalog.transform((catalog) => {
        for (const record of catalog.provider.list()) {
          for (const model of record.models.values()) {
            if (allow.length > 0) {
              model.enabled = matches(allow, model.providerID, model.id)
            } else if (matches(deny, model.providerID, model.id)) {
              model.enabled = false
            }
          }
        }
      })
    },
  })
}

export default createModelFilterPlugin()
