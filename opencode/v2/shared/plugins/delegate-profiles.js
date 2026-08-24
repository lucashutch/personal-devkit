import { Plugin } from "@opencode-ai/plugin"

// Delegate model profiles, configured through this plugin's options in the
// profile's opencode.json:
//   { "presets": { "fast": { "model": "provider/model", "variant": "low" }, ... } }

const profileOrder = ["fast", "standard", "deep", "inherit"]

export function parseModelRef(value, label = "model") {
  if (typeof value !== "string") throw new Error(`${label} must be a provider/model string`)
  const providerEnd = value.indexOf("/")
  const variantStart = value.indexOf("#", providerEnd + 1)
  const providerID = value.slice(0, providerEnd)
  const id = value.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : value.slice(variantStart + 1)
  if (
    providerEnd <= 0
    || !id
    || providerID.includes("#")
    || (variant !== undefined && (!variant || variant.includes("#")))
  ) {
    throw new Error(`${label} must be a provider/model string with an optional #variant`)
  }
  return { providerID, id, ...(variant ? { variant } : {}) }
}

export function parseProfiles(configured) {
  const source = configured?.presets
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("delegate-profiles options.presets must be an object")
  }
  return Object.fromEntries(
    profileOrder.slice(0, 3).map((profile) => {
      // V1 calls the middle tier `balanced`; V2 exposes it as `standard`.
      // Accept `standard` in a future shared settings file without requiring a
      // coordinated plugin release.
      const presetName = profile === "standard" && source.standard === undefined ? "balanced" : profile
      const preset = source[presetName]
      if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
        throw new Error(`delegate-profiles options.presets.${presetName} must be an object`)
      }
      if (preset.variant !== undefined && (typeof preset.variant !== "string" || !preset.variant.trim())) {
        throw new Error(`delegate-profiles options.presets.${presetName}.variant must be a non-empty string when provided`)
      }
      if (typeof preset.model !== "string") {
        throw new Error(`delegate-profiles options.presets.${presetName}.model must be a provider/model string`)
      }
      const model = parseModelRef(
        `${preset.model}${preset.variant ? `#${preset.variant}` : ""}`,
        `delegate-profiles options.presets.${presetName}.model`,
      )
      return [profile, model]
    }),
  )
}

export function addModelProfile(schema, agents = []) {
  const input = structuredClone(schema)
  const available = agents
    .filter((agent) => agent.mode !== "primary" && !agent.hidden)
    .map((agent) => agent.id)
    .toSorted()
  const agent = input.properties?.agent
  input.properties = {
    ...(input.properties ?? {}),
    ...(agent === undefined
      ? {}
      : {
          agent: {
            ...agent,
            ...(available.length === 0 ? {} : { enum: available }),
            description:
              "Configured agent role to run. Choose a role from this list; model speed and depth belong in model_profile, never in agent.",
          },
        }),
    model_profile: {
      type: "string",
      enum: profileOrder,
      description:
        "Execution tier. Start at fast. Escalate to standard when the task needs judgement or spans several "
        + "files, and to deep when it is ambiguous, high-stakes, or needs multi-step reasoning. "
        + "inherit deliberately matches the selected agent or parent model and reasoning level.",
    },
  }
  input.required = [...new Set([...(input.required ?? []), "model_profile"])]
  return input
}

export function aliasID(agent, profile) {
  return `${profile[0].toUpperCase()}${profile.slice(1)}-${agent}`
}

export function createDelegateProfilesPlugin() {
  return Plugin.define({
    id: "personal.delegate-profiles",
    setup: async (ctx) => {
      const profiles = parseProfiles(ctx.options)
      const aliases = new Map()

      const ensureAlias = async (agent, profile) => {
        const id = aliasID(agent, profile)
        const existing = aliases.get(id)
        if (existing) return existing

        const pending = (async () => {
          // `agent.get` takes `{ agentID }` and returns `{ location, data }`.
          // It rejects with "Agent not found" rather than resolving undefined.
          const source = await ctx.agent.get({ agentID: agent })
            .then((result) => result?.data)
            .catch(() => undefined)
          if (!source) throw new Error(`delegate-profiles cannot find agent: ${agent}`)
          await ctx.agent.transform((draft) => {
            draft.update(id, (alias) => {
              Object.assign(alias, structuredClone(source))
              alias.hidden = true
              alias.model = profiles[profile]
            })
          })
          return id
        })().catch((error) => {
          aliases.delete(id)
          throw error
        })
        aliases.set(id, pending)
        return pending
      }

      // Hooks and transforms are released with the plugin generation, so this
      // setup owns no resource that needs an explicit cleanup function.
      await ctx.session.hook("context", async (event) => {
        const subagent = event.tools.subagent
        if (!subagent) return
        const agents = (await ctx.agent.list()).data
        const available = agents
          .filter((agent) => agent.mode !== "primary" && !agent.hidden)
          .map((agent) => agent.id)
          .toSorted()
        subagent.description = [
          subagent.description,
          "",
          "Choose `agent` by role and `model_profile` by execution tier; profile names are not agent names.",
          ...(available.length === 0 ? [] : [`Available agent roles: ${available.join(", ")}.`]),
        ].join("\n")
        subagent.input = addModelProfile(subagent.input, agents)
      })

      await ctx.tool.hook("execute.before", async (event) => {
        if (event.tool !== "subagent" || !event.input || typeof event.input !== "object") return
        const input = { ...event.input }
        const profile = input.model_profile
        if (!profileOrder.includes(profile)) {
          throw new Error(`delegate-profiles received an unknown model_profile: ${String(profile)}`)
        }
        delete input.model_profile
        if (profile !== "inherit") input.agent = await ensureAlias(input.agent, profile)
        event.input = input
      })
    },
  })
}

export default createDelegateProfilesPlugin()
