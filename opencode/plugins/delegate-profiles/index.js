import { Plugin } from "@opencode-ai/plugin/effect"
import { Tool } from "@opencode-ai/schema/tool"
import { Effect } from "effect"

// Delegate model profiles, configured through this plugin's options in the
// profile's opencode.json:
//   { "presets": { "fast": { "model": "provider/model", "variant": "low" }, ... } }

const profileOrder = ["fast", "standard", "deep", "inherit"]

export function parseModelRef(value, label = "model") {
  if (typeof value !== "string") throw new Error(`${label} must be a provider/model string`)
  if (value !== value.trim() || /\s/.test(value)) throw new Error(`${label} must not contain whitespace`)
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

export function addModelProfile(schema, agents = [], profiles) {
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
      description: profiles
        ? `Configured model: fast=${formatModelRef(profiles.fast)}, standard=${formatModelRef(profiles.standard)}, deep=${formatModelRef(profiles.deep)}; inherit=selected agent/parent.`
        : "Configured model profile; inherit uses the selected agent or parent.",
    },
  }
  input.required = [...new Set([...(input.required ?? []), "model_profile"])]
  return input
}

function formatModelRef(model) {
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`
}

export function createDelegateProfilesPlugin() {
  return Plugin.define({
    id: "personal.delegate-profiles",
    effect: (ctx) => Effect.gen(function* () {
      const profiles = parseProfiles(ctx.options)
      const pending = new Map()
      const children = new Map()
      const wrapped = new WeakSet()
      const key = (event) => JSON.stringify([event.sessionID, event.messageID, event.id])
      const fail = (message) => Effect.fail(new Tool.Error({ message: `delegate-profiles ${message}` }))
      yield* Effect.addFinalizer(() => Effect.sync(() => { pending.clear(); children.clear() }))

      yield* ctx.tool.transform((editor) => editor.update("subagent", (tool) => {
        if (wrapped.has(tool.execute)) return
        const native = tool.execute
        tool.execute = (input, context) => Effect.suspend(() => {
          const invocation = key(context)
          const state = pending.get(invocation)
          pending.delete(invocation)
          if (!state) return fail("missing validated model_profile")
          const owned = new Set()
          const claim = (child) => Effect.suspend(() => {
            if (children.has(child) && children.get(child) !== state) return fail(`child already in use: ${child}`)
            children.set(child, state)
            owned.add(child)
            return Effect.void
          })
          let selected = false
          return Effect.gen(function* () {
            if (input.sessionID) {
              yield* claim(input.sessionID)
              if (state.model) {
                const child = yield* ctx.session.get({ sessionID: input.sessionID })
                const current = child.model
                if (!current || current.providerID !== state.model.providerID || current.id !== state.model.id || current.variant !== state.model.variant) {
                  return yield* fail("cannot change a resumed child's model profile; use inherit or start a new child")
                }
              }
            }
            return yield* native(input, {
              ...context,
              progress: (update) => Effect.gen(function* () {
                if (!selected && update.status === "running" && typeof update.sessionID === "string") {
                  yield* claim(update.sessionID)
                  if (state.model && !input.sessionID) yield* ctx.session.switchModel({ sessionID: update.sessionID, model: state.model })
                  selected = true
                }
                yield* context.progress(update)
              }),
            })
          }).pipe(Effect.ensuring(Effect.sync(() => {
            for (const child of owned) if (children.get(child) === state) children.delete(child)
          })))
        })
        wrapped.add(tool.execute)
      }))

      yield* ctx.session.hook("context", (event) => Effect.gen(function* () {
        const subagent = event.tools.subagent
        if (!subagent) return
        const agents = (yield* ctx.agent.list()).data
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
        subagent.input = addModelProfile(subagent.input, agents, profiles)
      }))

      yield* ctx.tool.hook("execute.before", (event) => Effect.gen(function* () {
        if (event.tool !== "subagent" || !event.input || typeof event.input !== "object") return
        pending.delete(key(event))
        const input = { ...event.input }
        const profile = input.model_profile
        if (!profileOrder.includes(profile)) {
          return yield* fail(`received an unknown model_profile: ${String(profile)}`)
        }
        delete input.model_profile
        if (profile !== "inherit") {
          const agents = (yield* ctx.agent.list()).data
          const source = agents.find((agent) => agent.id === input.agent && !agent.hidden && agent.mode !== "primary")
          if (!source) return yield* fail(`cannot find subagent role: ${input.agent}`)
          const selected = profiles[profile]
          const models = (yield* ctx.catalog.model.list()).data
          const model = models.find((model) => model.providerID === selected.providerID && model.id === selected.id)
          if (!model?.enabled) return yield* fail(`model unavailable: ${formatModelRef(selected)}`)
          if (selected.variant && !model.variants?.some((variant) => variant.id === selected.variant)) {
            return yield* fail(`variant unavailable: ${formatModelRef(selected)}`)
          }
        }
        event.input = input
        pending.set(key(event), { model: profile === "inherit" ? undefined : profiles[profile] })
      }))
      yield* ctx.tool.hook("execute.after", (event) => Effect.sync(() => pending.delete(key(event))))
    }),
  })
}

export default createDelegateProfilesPlugin()
