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

export function parseProfiles(options) {
  const configured = options?.profiles
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    throw new Error("delegate-profiles requires a profiles object")
  }
  return Object.fromEntries(
    profileOrder.slice(0, 3).map((profile) => [
      profile,
      parseModelRef(configured[profile], `delegate-profiles profiles.${profile}`),
    ]),
  )
}

export function addModelProfile(schema) {
  const input = structuredClone(schema)
  input.properties = {
    ...(input.properties ?? {}),
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
    id: "personal.delegate-profiles-prototype",
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

      registrations.push(await ctx.session.hook("context", (event) => {
        const subagent = event.tools.subagent
        if (!subagent) return
        subagent.input = addModelProfile(subagent.input)
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
