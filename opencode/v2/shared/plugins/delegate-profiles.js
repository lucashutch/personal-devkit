import { readFileSync } from "node:fs"

const profileOrder = ["fast", "standard", "deep", "inherit"]
const settings = JSON.parse(readFileSync(new URL("./delegate/settings.json", import.meta.url), "utf8"))

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

export function parseProfiles(options = {}, configured = settings) {
  const source = configured?.presets
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("delegate-profiles settings.presets must be an object")
  }
  if (options.provider !== undefined && (typeof options.provider !== "string" || !options.provider.trim())) {
    throw new Error("delegate-profiles provider must be a non-empty string")
  }
  if (options.variants !== undefined && typeof options.variants !== "boolean") {
    throw new Error("delegate-profiles variants must be a boolean")
  }

  return Object.fromEntries(
    profileOrder.slice(0, 3).map((profile) => {
      // V1 calls the middle tier `balanced`; V2 exposes it as `standard`.
      // Accept `standard` in a future shared settings file without requiring a
      // coordinated plugin release.
      const presetName = profile === "standard" && source.standard === undefined ? "balanced" : profile
      const preset = source[presetName]
      if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
        throw new Error(`delegate-profiles settings.presets.${presetName} must be an object`)
      }
      if (typeof preset.variant !== "string" || !preset.variant.trim()) {
        throw new Error(`delegate-profiles settings.presets.${presetName}.variant must be a non-empty string`)
      }
      if (typeof preset.model !== "string") {
        throw new Error(`delegate-profiles settings.presets.${presetName}.model must be a provider/model string`)
      }
      const model = parseModelRef(
        `${preset.model}#${preset.variant}`,
        `delegate-profiles settings.presets.${presetName}.model`,
      )
      const selected = {
        ...model,
        ...(options.provider === undefined ? {} : { providerID: options.provider }),
      }
      if (options.variants === false) delete selected.variant
      return [
        profile,
        selected,
      ]
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
        "Execution tier. fast is cheapest, standard is the default, deep favors quality, and inherit uses the selected agent or parent model.",
    },
  }
  input.required = [...new Set([...(input.required ?? []), "model_profile"])]
  return input
}

export function aliasID(agent, profile) {
  return `delegate-profile--${profile}--${agent}`
}

export function createDelegateProfilesPlugin() {
  return {
    id: "personal.delegate-profiles",
    setup: async (ctx) => {
      const profiles = parseProfiles(ctx.options)
      const registrations = []
      const aliases = new Map()

      const ensureAlias = async (agent, profile) => {
        const id = aliasID(agent, profile)
        const existing = aliases.get(id)
        if (existing) return existing

        const pending = (async () => {
          const source = await ctx.agent.get(agent)
          if (!source) throw new Error(`delegate-profiles cannot find agent: ${agent}`)
          const registration = await ctx.agent.transform((draft) => {
            draft.update(id, (alias) => {
              Object.assign(alias, structuredClone(source))
              alias.hidden = true
              alias.model = profiles[profile]
            })
          })
          registrations.push(registration)
          return id
        })().catch((error) => {
          aliases.delete(id)
          throw error
        })
        aliases.set(id, pending)
        return pending
      }

      registrations.push(await ctx.session.hook("context", async (event) => {
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
      }))

      registrations.push(await ctx.tool.hook("execute.before", async (event) => {
        if (event.tool !== "subagent" || !event.input || typeof event.input !== "object") return
        const input = { ...event.input }
        const profile = input.model_profile
        if (!profileOrder.includes(profile)) {
          throw new Error(`delegate-profiles received an unknown model_profile: ${String(profile)}`)
        }
        delete input.model_profile
        if (profile !== "inherit") input.agent = await ensureAlias(input.agent, profile)
        event.input = input
      }))

      return async () => {
        for (const registration of registrations.toReversed()) await registration.dispose()
      }
    },
  }
}

export default createDelegateProfilesPlugin()
