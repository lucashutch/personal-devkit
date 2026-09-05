import { Plugin } from "@opencode-ai/plugin"

// Catalog-level model filter driven by its plugin options in opencode.json,
// mirroring how delegate-profiles reads its presets. Stopgap until V2 regains
// native whitelist support; per-model `disabled` blocklists rot as providers
// add models, so profiles declare a small allowlist instead.
//
// Options shape (rules are "provider/model" strings; `*` is a glob wildcard).
// A model-only glob such as "*free*" applies to every provider.
//   { "allow": [...] }  -> whitelist mode: everything unlisted is disabled
//   { "deny": [...] }   -> blocklist mode: only listed models are disabled
//   { "allow": [...], "deny": [...], "except": [...] } -> whitelist mode with exclusions

function parseRuleList(source, label) {
  if (source === undefined) return []
  if (!Array.isArray(source)) throw new Error(`model-filter options.${label} must be an array`)
  return source.map((value, index) => {
    const ref = `model-filter options.${label}[${index}]`
    if (typeof value !== "string") throw new Error(`${ref} must be a provider/model string or model glob`)
    if (!value || value !== value.trim() || /\s/.test(value)) {
      throw new Error(`${ref} must not be empty or contain whitespace`)
    }
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
  const except = parseRuleList(configured?.except, "except")
  if (allow.length === 0 && deny.length === 0) {
    throw new Error("model-filter options must list at least one allow or deny rule")
  }
  return { allow, deny, except }
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
      const { allow, deny, except } = parseRules(ctx.options)
      await ctx.catalog.transform((catalog) => {
        for (const record of catalog.provider.list()) {
          for (const model of record.models.values()) {
            const exception = matches(except, model.providerID, model.id)
            const allowed = allow.length === 0 || matches(allow, model.providerID, model.id)
            // Exceptions bypass filtering, but never revive a model disabled by
            // the provider or another plugin before this transform.
            model.enabled = model.enabled !== false && (exception || (allowed && !matches(deny, model.providerID, model.id)))
          }
        }
      })
    },
  })
}

export default createModelFilterPlugin()
