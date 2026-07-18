import { afterEach, describe, expect, mock, test } from "bun:test"

import {
  DelegatePlugin,
} from "../delegate"
import settings from "./settings.json"

const {
  createDelegateExecutor,
  delegateDescription,
  discoverDelegateDescription,
  observeParentModel,
  parseSettings,
  resolveModelProfile,
  withPromptVariant,
} = DelegatePlugin.internals

const inherited = { providerID: "openai", modelID: "gpt-5.5", variant: "high" }

function clientMock() {
  return {
    app: {
      agents: mock(async () => ({ data: [] })),
    },
    session: {
      create: mock(async () => ({ data: { id: "child-1" } })),
      get: mock(async () => ({ data: { id: "existing-7", parentID: "parent-1" } })),
      prompt: mock(async () => ({
        data: { parts: [{ type: "text", text: "delegated result" }] },
      })),
    },
  }
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    sessionID: "parent-1",
    messageID: "message-1",
    abort: new AbortController().signal,
    metadata: mock(() => undefined),
    ...overrides,
  }
}

const request = {
  description: "Inspect the parser",
  prompt: "Find the parsing edge cases",
  subagent_type: "explore",
  model_profile: "balanced" as const,
}

afterEach(() => mock.restore())

const fixture = {
  presets: {
    fast: { model: "openai/fast-model", variant: "low" },
    balanced: { model: "openai/balanced-model", variant: "high" },
    deep: { model: "other-provider/deep.model-1", variant: "high" },
  },
}

describe("delegate settings contract", () => {
  test("presets are fully customizable: any well-formed provider/model pair is accepted", () => {
    const parsed = parseSettings(fixture)
    expect(resolveModelProfile(parsed, "fast", inherited)).toEqual({
      providerID: "openai", modelID: "fast-model", variant: "low",
    })
    expect(resolveModelProfile(parsed, "balanced", inherited)).toEqual({
      providerID: "openai", modelID: "balanced-model", variant: "high",
    })
    expect(resolveModelProfile(parsed, "deep", inherited)).toEqual({
      providerID: "other-provider", modelID: "deep.model-1", variant: "high",
    })
    expect(resolveModelProfile(parsed, "inherit", inherited)).toEqual(inherited)
  })

  test("the checked-in settings file parses", () => {
    expect(() => parseSettings(settings)).not.toThrow()
  })

  test("rejects missing and malformed configuration", () => {
    expect(() => parseSettings(undefined)).toThrow(/settings/i)
    expect(() => parseSettings({})).toThrow(/presets/i)
    expect(() => parseSettings({
      presets: { ...fixture.presets, deep: { model: "no-slash-model", variant: "high" } },
    })).toThrow(/provider\/model/i)
    expect(() => parseSettings({
      presets: { ...fixture.presets, fast: { model: "too/many/slashes", variant: "low" } },
    })).toThrow(/provider\/model/i)
    expect(() => parseSettings({
      presets: { ...fixture.presets, fast: { model: 42, variant: "low" } },
    })).toThrow(/model/i)
    expect(() => parseSettings({
      presets: { ...fixture.presets, deep: { model: "openai/deep-model", variant: " " } },
    })).toThrow(/variant/i)
    expect(() => parseSettings({
      presets: { fast: fixture.presets.fast },
    })).toThrow(/presets\.balanced/i)
    expect(() => resolveModelProfile(parseSettings(fixture), "turbo", inherited)).toThrow(/profile/i)
    expect(() => resolveModelProfile(parseSettings(fixture), "inherit", undefined)).toThrow(/parent|inherit/i)
  })

  test("localizes the runtime-only prompt variant compatibility adapter", () => {
    const prompt = withPromptVariant({ model: { providerID: "openai", modelID: "gpt-5.5" } }, "high")
    expect(prompt).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.5" },
      variant: "high",
    })
  })
})

describe("delegate runtime contract", () => {
  test("formats only usable subagents from dynamic discovery", () => {
    const description = delegateDescription([
      { name: "explore", mode: "subagent", description: "Searches\ncode quickly" },
      { name: "reviewer", mode: "all", description: "Reviews changes" },
      { name: "primary", mode: "primary", description: "Not delegatable" },
      { name: "off", mode: "subagent", disabled: true },
      { name: "unavailable", mode: "all", available: false },
      { mode: "subagent", description: "Missing name" },
    ])

    expect(description).toContain("explore — Searches code quickly")
    expect(description).toContain("reviewer — Reviews changes")
    expect(description).not.toMatch(/primary|off|unavailable|Missing name/)
  })

  test("uses a stable fallback for malformed, empty, and failed discovery", async () => {
    const fallback = delegateDescription([])
    expect(delegateDescription(undefined)).toBe(fallback)
    expect(delegateDescription([{ name: "primary", mode: "primary" }, null])).toBe(fallback)

    const client = clientMock()
    client.app.agents.mockImplementation(async () => ({ error: { status: 500, data: { message: "no agents" } } }))
    expect(await discoverDelegateDescription(client as never)).toBe(fallback)
    client.app.agents.mockImplementation(async () => { throw new Error("offline") })
    expect(await discoverDelegateDescription(client as never)).toBe(fallback)
  })

  test("enriches the tool description once background discovery resolves", async () => {
    const client = clientMock()
    client.app.agents.mockImplementation(async () => ({
      data: [{ name: "configured-helper", mode: "subagent", description: "Handles configured work" }],
    }))
    const hooks = await DelegatePlugin({ client } as never)
    expect(client.app.agents).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hooks.tool?.task.description).toContain("configured-helper — Handles configured work")
  })

  test("initializes without awaiting discovery so host bootstrap cannot deadlock", async () => {
    const client = clientMock()
    // Simulate the host API being unreachable during bootstrap: the request
    // never settles. Plugin creation must still complete.
    client.app.agents.mockImplementation(() => new Promise(() => undefined) as never)
    const hooks = await DelegatePlugin({ client } as never)
    expect(hooks.tool?.task.description).toBe(delegateDescription([]))
  })

  test("registers the delegate tool without loading the plugin package at runtime", async () => {
    const hooks = await DelegatePlugin({ client: clientMock() } as never)

    expect(hooks.tool).toHaveProperty("task")
    expect(hooks.tool?.task.args).toEqual(expect.objectContaining({
      description: expect.anything(),
      prompt: expect.anything(),
      subagent_type: expect.anything(),
      task_id: expect.anything(),
      model_profile: expect.anything(),
    }))
    expect(hooks.tool?.task.args).not.toHaveProperty("strength")
    expect(hooks.tool?.task.args.model_profile.isOptional()).toBe(false)
    expect(hooks.tool?.task.args.model_profile.options).toEqual(["fast", "balanced", "deep", "inherit"])
    expect(hooks.tool?.task.args.model_profile.description).toContain("Prefer the least expensive tier likely to succeed")
    expect(hooks.tool?.task.execute).toBeFunction()
  })

  test("creates a child, forwards agent/model, reports progress, and returns a resumable id", async () => {
    const client = clientMock()
    const ctx = context()
    const execute = createDelegateExecutor({ client, settings: parseSettings(fixture), parentModels: new Map() })

    const result = await execute(request, ctx)

    expect(client.session.create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ parentID: "parent-1" }),
    }))
    expect(client.session.prompt).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: "child-1" },
      body: expect.objectContaining({
        agent: "explore",
        model: { providerID: "openai", modelID: "balanced-model" },
        variant: "high",
      }),
      signal: ctx.abort,
    }))
    expect(ctx.metadata).toHaveBeenCalledWith(expect.objectContaining({
      title: "Inspect the parser",
      metadata: expect.objectContaining({ task_id: "child-1" }),
    }))
    // The final result metadata replaces earlier progress updates in the tool
    // state, so it must keep the keys the TUI task renderer needs to link the
    // completed item to the child session.
    expect(result).toEqual({
      output: "Resumable task ID: child-1\n\ndelegated result",
      metadata: {
        status: "completed",
        task_id: "child-1",
        sessionId: "child-1",
        parentSessionId: "parent-1",
        model: { providerID: "openai", modelID: "balanced-model" },
        variant: "high",
        model_profile: "balanced",
      },
    })
  })

  test("resumes task_id without creating a session and permits agent selection", async () => {
    const client = clientMock()
    const execute = createDelegateExecutor({ client, settings: parseSettings(fixture), parentModels: new Map() })
    await execute({ ...request, task_id: "existing-7", subagent_type: "reviewer" }, context())

    expect(client.session.create).not.toHaveBeenCalled()
    expect(client.session.get).toHaveBeenCalledWith(expect.objectContaining({ path: { id: "existing-7" } }))
    expect(client.session.prompt).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: "existing-7" }, body: expect.objectContaining({ agent: "reviewer" }),
    }))
  })

  test("rejects a resume session owned by another parent", async () => {
    const client = clientMock()
    client.session.get.mockImplementation(async () => ({ data: { id: "existing-7", parentID: "other" } }))
    const execute = createDelegateExecutor({ client, settings: parseSettings(fixture), parentModels: new Map() })
    const result = await execute({ ...request, task_id: "existing-7" }, context())
    expect(result.metadata).toEqual({ status: "error", task_id: "existing-7", sessionId: "existing-7", parentSessionId: "parent-1" })
    expect(result.output).toMatch(/not owned/i)
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  test("inherits the cached parent model and falls back by session when needed", async () => {
    const client = clientMock()
    const parentModels = new Map([
      ["parent-1:message-1", inherited],
      ["parent-2", { providerID: "openai", modelID: "gpt-5.4-mini", variant: "minimal" }],
    ])
    const execute = createDelegateExecutor({ client, settings: parseSettings(fixture), parentModels })
    await execute({ ...request, model_profile: "inherit" }, context())
    client.session.get.mockImplementation(async () => ({ data: { id: "child-2", parentID: "parent-2" } }))
    await execute(
      { ...request, model_profile: "inherit", task_id: "child-2" },
      context({ sessionID: "parent-2", messageID: "uncached" }),
    )

    expect(client.session.prompt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      body: expect.objectContaining({ model: { providerID: "openai", modelID: "gpt-5.5" }, variant: "high" }),
    }))
    expect(client.session.prompt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      body: expect.objectContaining({ model: { providerID: "openai", modelID: "gpt-5.4-mini" }, variant: "minimal" }),
    }))
  })

  test("propagates cancellation and normalizes API failures", async () => {
    const aborted = new AbortController()
    aborted.abort()
    const cancelledClient = clientMock()
    const executeCancelled = createDelegateExecutor({
      client: cancelledClient, settings: parseSettings(fixture), parentModels: new Map(),
    })
    const cancelled = await executeCancelled(request, context({ abort: aborted.signal }))
    expect(cancelled).toEqual(expect.objectContaining({ metadata: expect.objectContaining({ status: "cancelled" }) }))

    const failedClient = clientMock()
    failedClient.session.prompt.mockImplementation(async () => ({
      error: { status: 429, data: { message: "rate limited" } },
    }))
    const executeFailed = createDelegateExecutor({
      client: failedClient, settings: parseSettings(fixture), parentModels: new Map(),
    })
    const failed = await executeFailed(request, context())
    expect(failed.metadata).toEqual({ status: "error", task_id: "child-1", sessionId: "child-1", parentSessionId: "parent-1" })
    expect(failed.output).toMatch(/429.*rate limited.*child-1/is)
  })

  test("handles a create error result without prompting", async () => {
    const client = clientMock()
    client.session.create.mockImplementation(async () => ({ error: { status: 403, data: { message: "denied" } } }))
    const execute = createDelegateExecutor({ client, settings: parseSettings(fixture), parentModels: new Map() })
    const result = await execute(request, context())
    expect(result.metadata).toEqual({ status: "error", task_id: undefined })
    expect(result.output).toMatch(/403.*denied/i)
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  test("clears stale inherit state when a newer message omits model or variant", () => {
    const models = new Map([["parent-1", inherited], ["parent-1:message-2", inherited]])
    observeParentModel(models, { sessionID: "parent-1", messageID: "message-2", model: inherited })
    expect(models.has("parent-1")).toBe(false)
    expect(models.has("parent-1:message-2")).toBe(false)
  })
})
