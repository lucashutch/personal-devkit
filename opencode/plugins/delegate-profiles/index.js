import { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"

const effortLevels = ["low", "medium", "high"]
const inherit = "inherit"

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

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

function parseModel(value, label) {
  const model = parseModelRef(value, label)
  if (model.variant) throw new Error(`${label} must not include a #variant; configure variants under efforts`)
  return model
}

function parseEfforts(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`)
  return Object.fromEntries(effortLevels.map((level) => {
    if (!Object.hasOwn(value, level)) throw new Error(`${label}.${level} must be a string or null`)
    const variant = value[level]
    if (variant !== null && (typeof variant !== "string" || !variant.trim() || /\s/.test(variant))) {
      throw new Error(`${label}.${level} must be a non-empty variant string or null`)
    }
    return [level, variant]
  }))
}

function parseScores(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`)
  return Object.fromEntries(Object.entries(value).map(([task, score]) => {
    if (!task.trim()) throw new Error(`${label} keys must not be empty`)
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 10) {
      throw new Error(`${label}.${task} must be a number from 0 to 10`)
    }
    return [task, score]
  }))
}

export function parseModels(configured) {
  const source = configured?.models
  if (!isObject(source) || Object.keys(source).length === 0) {
    throw new Error("delegate-profiles options.models must be a non-empty object")
  }
  return Object.fromEntries(Object.entries(source).map(([alias, value]) => {
    if (!alias.trim() || /\s/.test(alias) || alias === inherit) {
      throw new Error(`delegate-profiles options.models.${alias} must be a non-inherit alias without whitespace`)
    }
    if (!isObject(value)) throw new Error(`delegate-profiles options.models.${alias} must be an object`)
    if (typeof value.model !== "string") {
      throw new Error(`delegate-profiles options.models.${alias}.model must be a provider/model string`)
    }
    if (typeof value.description !== "string" || !value.description.trim()) {
      throw new Error(`delegate-profiles options.models.${alias}.description must be a non-empty string`)
    }
    return [alias, {
      model: parseModel(value.model, `delegate-profiles options.models.${alias}.model`),
      efforts: parseEfforts(value.efforts, `delegate-profiles options.models.${alias}.efforts`),
      scores: parseScores(value.scores, `delegate-profiles options.models.${alias}.scores`),
      description: value.description,
    }]
  }))
}

export function parseDefaults(configured, models = parseModels(configured)) {
  const source = configured?.defaults
  if (source === undefined) return {}
  if (!isObject(source)) throw new Error("delegate-profiles options.defaults must be an object")
  return Object.fromEntries(Object.entries(source).map(([role, value]) => {
    if (!role.trim()) {
      throw new Error(`delegate-profiles options.defaults.${role} must be a non-empty role name`)
    }
    if (!isObject(value)) throw new Error(`delegate-profiles options.defaults.${role} must be an object`)
    if (typeof value.model !== "string" || !Object.hasOwn(models, value.model) || value.model === inherit) {
      throw new Error(`delegate-profiles options.defaults.${role}.model must name a configured model alias`)
    }
    if (!effortLevels.includes(value.effort)) {
      throw new Error(`delegate-profiles options.defaults.${role}.effort must be low, medium, or high`)
    }
    return [role, { model: value.model, effort: value.effort }]
  }))
}

export function parseConfig(configured) {
  const models = parseModels(configured)
  return { models, defaults: parseDefaults(configured, models) }
}

function asConfig(configured) {
  if (configured?.models && Object.values(configured.models)[0]?.model?.providerID) return configured
  return parseConfig(configured)
}

export function formatModelRef(model) {
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`
}

function formatModelDescriptions(models) {
  return [
    "Configured model alias and description:",
    ...Object.entries(models).map(([alias, value]) => `${alias}=${value.description.replace(/\s+/g, " ").trim()}`),
    "inherit uses the role default when configured, otherwise the native model; omit model and effort when resuming to preserve settings.",
  ].join(" ")
}

function formatEffortDescription() {
  return "Effort is uniform across aliases: low, medium, or high. Each alias maps those levels to a variant; null uses the model's native default. Omit effort for the default mapping."
}

export function formatTaskFitMatrix(models) {
  const tasks = []
  for (const value of Object.values(models)) {
    for (const task of Object.keys(value.scores)) if (!tasks.includes(task)) tasks.push(task)
  }
  const header = ["model", ...tasks]
  const separator = ["---", ...tasks.map(() => "---:")]
  const rows = Object.entries(models).map(([alias, value]) => [
    alias,
    ...tasks.map((task) => value.scores[task] === undefined ? "?" : `${value.scores[task]}/10`),
  ])
  return [
    "Estimated task fit (/10):",
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "Subjective task-fit estimates at medium effort, not benchmarks; ? means unrated. Scores exclude cost and latency.",
  ].join("\n")
}

export function addModelProfile(schema, agents = [], configured) {
  const input = structuredClone(schema)
  const config = asConfig(configured)
  const available = agents
    .filter((agent) => agent.mode !== "primary" && !agent.hidden)
    .map((agent) => agent.id)
    .toSorted()
  const agent = input.properties?.agent
  const properties = { ...(input.properties ?? {}) }
  delete properties.model_profile
  input.properties = {
    ...properties,
    ...(agent === undefined
      ? {}
      : {
          agent: {
            ...agent,
            ...(available.length === 0 ? {} : { enum: available }),
            description: "Configured agent role to run. Choose a role from this list; model and effort are separate optional controls.",
          },
        }),
    model: {
      type: "string",
      enum: [...Object.keys(config.models), inherit],
      description: formatModelDescriptions(config.models),
    },
    effort: {
      type: "string",
      enum: effortLevels,
      description: formatEffortDescription(),
    },
  }
  input.required = [...new Set((input.required ?? []).filter((name) => name !== "model_profile"))]
  return input
}

export const addModelSelection = addModelProfile

function targetFor(models, alias, effort) {
  const selected = models[alias]
  const variant = selected.efforts[effort]
  return { ...selected.model, ...(variant === null ? {} : { variant }) }
}

function parseInputChoice(input) {
  if (Object.hasOwn(input, "model_profile")) {
    throw new Error("model_profile is no longer supported; select model and effort instead")
  }
  if (input.model !== undefined && typeof input.model !== "string") {
    throw new Error("model must be a configured alias or inherit")
  }
  if (input.effort !== undefined && !effortLevels.includes(input.effort)) {
    throw new Error("effort must be low, medium, or high")
  }
}

function resolveRequest(input, role, config) {
  const requestedModel = input.model
  const requestedEffort = input.effort
  const resuming = Boolean(input.sessionID)
  const hasModel = requestedModel !== undefined
  const explicitModel = hasModel && requestedModel !== inherit

  if (resuming) {
    if (!explicitModel) {
      if (requestedEffort !== undefined) {
        throw new Error("cannot choose effort without an explicit model when resuming a child")
      }
      return { model: undefined, preserve: true }
    }
    const effort = requestedEffort ?? "medium"
    if (!Object.hasOwn(config.models, requestedModel)) {
      throw new Error(`unknown model alias: ${requestedModel}`)
    }
    return { model: targetFor(config.models, requestedModel, effort), preserve: false }
  }

  if (explicitModel) {
    if (!Object.hasOwn(config.models, requestedModel)) {
      throw new Error(`unknown model alias: ${requestedModel}`)
    }
    return { model: targetFor(config.models, requestedModel, requestedEffort ?? "medium"), preserve: false }
  }

  const roleDefault = config.defaults[role]
  if (roleDefault) {
    return {
      model: targetFor(config.models, roleDefault.model, requestedEffort ?? roleDefault.effort),
      preserve: false,
    }
  }
  if (requestedEffort !== undefined) {
    throw new Error("cannot choose effort without a model or configured role default")
  }
  return { model: undefined, preserve: false }
}

function sameModel(actual, expected) {
  return actual
    && actual.providerID === expected.providerID
    && actual.id === expected.id
    && (actual.variant ?? undefined) === (expected.variant ?? undefined)
}

function availableVariant(model, variant) {
  return Array.isArray(model?.variants)
    && model.variants.some((entry) => entry === variant || entry?.id === variant)
}

export function createDelegateProfilesPlugin() {
  return Plugin.define({
    id: "personal.delegate-profiles",
    effect: (ctx) => Effect.gen(function* () {
      const config = parseConfig(ctx.options)
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
          if (!state) return fail("missing validated model and effort")
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
                if (!sameModel(child?.model, state.model)) {
                  return yield* fail("cannot change a resumed child's model or effort; requested model and variant do not match")
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
        subagent.description = [subagent.description, formatTaskFitMatrix(config.models)].filter(Boolean).join("\n")
        subagent.input = addModelProfile(subagent.input, agents, config)
      }))

      yield* ctx.tool.hook("execute.before", (event) => Effect.gen(function* () {
        if (event.tool !== "subagent" || !isObject(event.input)) return
        pending.delete(key(event))
        const input = { ...event.input }
        try {
          parseInputChoice(input)
        } catch (error) {
          return yield* fail(error.message)
        }
        const agents = (yield* ctx.agent.list()).data
        const source = agents.find((agent) => agent.id === input.agent && !agent.hidden && agent.mode !== "primary")
        if (!source) return yield* fail(`cannot find subagent role: ${input.agent}`)
        let request
        try {
          request = resolveRequest(input, source.id, config)
        } catch (error) {
          return yield* fail(error.message)
        }
        if (request.model) {
          const catalog = (yield* ctx.catalog.model.list()).data
          const model = catalog.find((entry) => entry.providerID === request.model.providerID && entry.id === request.model.id)
          if (!model?.enabled) return yield* fail(`model unavailable: ${formatModelRef(request.model)}`)
          if (request.model.variant && !availableVariant(model, request.model.variant)) {
            return yield* fail(`variant unavailable: ${formatModelRef(request.model)}`)
          }
        }
        delete input.model
        delete input.effort
        event.input = input
        pending.set(key(event), { model: request.model })
      }))
      yield* ctx.tool.hook("execute.after", (event) => Effect.sync(() => pending.delete(key(event))))
    }),
  })
}

export default createDelegateProfilesPlugin()
