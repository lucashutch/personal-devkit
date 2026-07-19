import type { Plugin, PluginInput, ToolContext, ToolResult } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"

const runtimeRequire = createRequire(join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "opencode/package.json",
))
const { z } = runtimeRequire("zod") as typeof import("zod")

const modelProfiles = ["fast", "balanced", "deep", "inherit"] as const
type ModelProfile = (typeof modelProfiles)[number]
type ModelChoice = { providerID: string; modelID: string; variant: string }
type PresetName = Exclude<ModelProfile, "inherit">
type Settings = {
  presets: Record<PresetName, ModelChoice>
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`delegate ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const presetNames = modelProfiles.slice(0, 3) as readonly PresetName[]

function parsePreset(source: Record<string, unknown>, name: PresetName): ModelChoice {
  const preset = record(source[name], `presets.${name}`)
  if (typeof preset.model !== "string") {
    throw new Error(`delegate presets.${name}.model must be a provider/model string`)
  }
  const pieces = preset.model.split("/")
  if (pieces.length !== 2 || pieces.some((piece) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(piece))) {
    throw new Error(`delegate presets.${name}.model must be an unambiguous provider/model pair`)
  }
  if (typeof preset.variant !== "string" || !preset.variant.trim()) {
    throw new Error(`delegate presets.${name}.variant must be a non-empty string`)
  }
  return { providerID: pieces[0], modelID: pieces[1], variant: preset.variant }
}

function parseSettings(value: unknown): Settings {
  const root = record(value, "settings")
  const source = record(root.presets, "presets")
  const presets = {} as Settings["presets"]
  for (const name of presetNames) presets[name] = parsePreset(source, name)
  return { presets }
}

function delegateConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(configHome, "opencode", "delegate_config.json")
}

function loadSettings(path: string = delegateConfigPath()): Settings {
  if (!existsSync(path)) {
    throw new Error(
      `delegate config not found at ${path}. The active profile has not linked its `
      + "delegate_config.json; run scripts/link-config.py for this profile and restart OpenCode.",
    )
  }
  try {
    return parseSettings(JSON.parse(readFileSync(path, "utf8")))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`delegate config ${path}: ${message}`)
  }
}

function resolveModelProfile(
  settings: Settings,
  modelProfile: string,
  parent: ModelChoice | undefined,
): ModelChoice {
  const selected = modelProfile
  if (!modelProfiles.includes(selected as ModelProfile)) throw new Error(`Unknown delegate model profile: ${selected}`)
  if (selected === "inherit") {
    if (!parent) throw new Error("Cannot inherit: parent model/variant was not observed by chat.message")
    return { ...parent }
  }
  return { ...settings.presets[selected as PresetName] }
}

function withPromptVariant<T extends object>(body: T, variant: string): T & { variant: string } {
  // V1 runtimes accept `variant`, but older public SDK typings omit it. Keep the
  // compatibility exception at this boundary so the rest of the client usage is typed.
  return { ...body, variant } as T & { variant: string }
}

type ExecutorDeps = {
  client: PluginInput["client"]
  settings: Settings
  parentModels: Map<string, ModelChoice>
}

type ApiResult<T> = { data?: T; error?: unknown }

const baseDescription = "Delegate a task to a selected subagent in a resumable child session."

function delegateDescription(value: unknown): string {
  if (!Array.isArray(value)) return baseDescription
  const agents = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const agent = entry as Record<string, unknown>
    if (typeof agent.name !== "string" || !agent.name.trim()) return []
    if (agent.mode !== "subagent" && agent.mode !== "all") return []
    if (agent.disabled === true || agent.enabled === false || agent.available === false) return []
    const name = agent.name.trim()
    const description = typeof agent.description === "string"
      ? agent.description.replace(/\s+/g, " ").trim().slice(0, 120)
      : ""
    return [`${name}${description ? ` — ${description}` : ""}`]
  })
  if (!agents.length) return baseDescription
  return `${baseDescription} Available subagents: ${agents.join("; ")}.`
}

async function discoverDelegateDescription(client: PluginInput["client"]): Promise<string> {
  try {
    return delegateDescription(apiData(await client.app.agents(), "app.agents"))
  } catch {
    return baseDescription
  }
}

function apiData<T>(result: ApiResult<T>, operation: string): T {
  if (result.error != null) throw new Error(`${operation}: ${errorText(result.error)}`)
  if (result.data == null) throw new Error(`${operation} returned no data`)
  return result.data
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  const item = record(error, "API error")
  const status = item.status == null ? "" : `${item.status} `
  const data = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : undefined
  return `${status}${data?.message ?? item.message ?? "Unknown API failure"}`.trim()
}

function createDelegateExecutor({ client, settings, parentModels }: ExecutorDeps) {
  return async (args: {
    description: string
    prompt: string
    subagent_type: string
    task_id?: string
    model_profile: ModelProfile
  }, context: ToolContext): Promise<ToolResult> => {
    let taskID = args.task_id
    try {
      if (context.abort.aborted) return {
        output: "Delegation cancelled",
        metadata: { status: "cancelled", task_id: taskID },
      }
      const parent = parentModels.get(`${context.sessionID}:${context.messageID}`)
        ?? parentModels.get(context.sessionID)
      const selected = resolveModelProfile(settings, args.model_profile, parent)
      // The TUI's task renderer keys on sessionId/parentSessionId/model to show
      // the selected model and let the user click into the child session. The
      // returned ToolResult metadata replaces these progress updates once the
      // tool completes, so the final return must carry the same keys.
      const taskMetadata = (status: string) => ({
        status,
        task_id: taskID,
        ...(taskID ? { sessionId: taskID, parentSessionId: context.sessionID } : {}),
        model: { providerID: selected.providerID, modelID: selected.modelID },
        variant: selected.variant,
        model_profile: args.model_profile,
      })
      const progress = (status: string) => context.metadata({
        title: args.description,
        metadata: taskMetadata(status),
      })

      progress("starting")
      if (!taskID) {
        // Public session.create can establish parentage, but cannot reproduce the
        // built-in task tool's private child permission overrides.
        const created = apiData(await client.session.create({
          body: { parentID: context.sessionID, title: args.description },
          signal: context.abort,
        }), "session.create")
        taskID = created.id
      } else {
        const resumed = apiData(await client.session.get({
          path: { id: taskID }, signal: context.abort,
        }), "session.get")
        if (resumed.parentID !== context.sessionID) {
          throw new Error("Refusing to resume a session not owned by the current parent")
        }
      }

      progress("running")
      const body = withPromptVariant({
        agent: args.subagent_type,
        model: { providerID: selected.providerID, modelID: selected.modelID },
        parts: [{ type: "text", text: args.prompt }],
      }, selected.variant)
      const response = apiData(await client.session.prompt({ path: { id: taskID }, body, signal: context.abort }), "session.prompt")
      const output = response.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text).join("\n").trim()
      progress("completed")
      return {
        output: `Resumable task ID: ${taskID}\n\n${output || "Delegated task completed without text output"}`,
        metadata: taskMetadata("completed"),
      }
    } catch (error) {
      const cancelled = context.abort.aborted || (error instanceof Error && error.name === "AbortError")
      const status = cancelled ? "cancelled" : "error"
      const message = cancelled ? "Delegation cancelled" : errorText(error)
      // `selected` may not have resolved before the failure, so rebuild the
      // final metadata here without the model fields.
      const metadata = {
        status,
        task_id: taskID,
        ...(taskID ? { sessionId: taskID, parentSessionId: context.sessionID } : {}),
      }
      context.metadata({ title: args.description, metadata })
      const resume = taskID ? `\nResumable task ID: ${taskID}` : ""
      return { output: `${message}${resume}`, metadata }
    }
  }
}

type ChatMessageInput = Parameters<NonNullable<Awaited<ReturnType<Plugin>>["chat.message"]>>[0]

function observeParentModel(parentModels: Map<string, ModelChoice>, input: ChatMessageInput): void {
  const messageKey = input.messageID ? `${input.sessionID}:${input.messageID}` : undefined
  if (!input.model || !input.variant) {
    parentModels.delete(input.sessionID)
    if (messageKey) parentModels.delete(messageKey)
    return
  }
  const model = { ...input.model, variant: input.variant }
  parentModels.set(input.sessionID, model)
  if (messageKey) parentModels.set(messageKey, model)
}

const delegateInternals = {
  createDelegateExecutor,
  delegateDescription,
  delegateConfigPath,
  discoverDelegateDescription,
  loadSettings,
  observeParentModel,
  parseSettings,
  resolveModelProfile,
  withPromptVariant,
}

const createPlugin: Plugin = async ({ client }) => {
  const settings = loadSettings()
  const parentModels = new Map<string, ModelChoice>()
  const execute = createDelegateExecutor({ client, settings, parentModels })

  // The V1 host accepts tool definitions directly; only its bundled Zod
  // schemas are needed at runtime. Avoid resolving the plugin package from
  // this discovered (and repository-symlinked) module.
  const delegate = {
    description: baseDescription,
    args: {
      description: z.string().describe("Short task title"),
      prompt: z.string().describe("Complete instructions for the subagent"),
      subagent_type: z.string().describe("Agent to run"),
      task_id: z.string().optional().describe("Existing delegated session to resume"),
      model_profile: z.enum(modelProfiles).describe(
        "Execution tier. `fast`: bounded, low-risk lookup, extraction, or mechanical work. "
        + "`balanced`: default for implementation, analysis, testing, and review. "
        + "`deep`: difficult, ambiguous, high-stakes, or multi-step reasoning where quality outweighs latency and cost. "
        + "`inherit`: intentionally use the parent model and reasoning level. "
        + "Prefer the least expensive tier likely to succeed; a resumed task can be escalated if necessary.",
      ),
    },
    execute,
  }

  // Discovery calls back into the host's API, which cannot answer until
  // bootstrap (including plugin loading) has finished — awaiting it here
  // deadlocks startup. Enrich the description in the background instead.
  void discoverDelegateDescription(client).then((description) => {
    delegate.description = description
  })

  return {
    "chat.message": async (input) => {
      // Some V1 hosts probe hooks without an input payload during shutdown.
      if (input) observeParentModel(parentModels, input)
    },
    // Registered as "task" (with the built-in disabled via `tools.task`) so the
    // TUI applies its task renderer: child-session click-through and model chip.
    tool: { task: delegate },
  }
}

// V1 treats every module export as a plugin factory, so expose test seams as a
// property of the sole exported function rather than as another module export.
export const DelegatePlugin = Object.assign(createPlugin, { internals: delegateInternals })
