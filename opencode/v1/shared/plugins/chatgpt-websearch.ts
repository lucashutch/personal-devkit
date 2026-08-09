import type { Plugin, PluginInput, ToolContext, ToolResult } from "@opencode-ai/plugin"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"

const runtimeRequire = createRequire(join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "opencode/package.json",
))
const { z } = runtimeRequire("zod") as typeof import("zod")

const endpoint = "https://chatgpt.com/backend-api/codex/alpha/search"
const tokenEndpoint = "https://auth.openai.com/oauth/token"
const clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
const maximumResponseBytes = 256 * 1024
const maximumQueryBytes = 8 * 1024
const timeoutMs = 25_000

type OAuth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

type SearchResult = {
  url: string
  title?: string
  content?: string
}

type Dependencies = {
  fetch: typeof globalThis.fetch
  randomUUID: () => string
  loadAuth: () => Promise<OAuth>
  saveAuth: (auth: OAuth) => Promise<void>
}

function authPath() {
  const data = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share")
  return join(data, "opencode/auth.json")
}

async function loadOpenAIAuth(): Promise<OAuth> {
  let root: unknown
  try {
    root = process.env.OPENCODE_AUTH_CONTENT
      ? JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
      : JSON.parse(await readFile(authPath(), "utf8"))
  } catch {
    throw new Error("ChatGPT OAuth is required. Connect OpenAI with ChatGPT login in OpenCode V1.")
  }
  const auth = isRecord(root) ? root.openai : undefined
  if (
    !isRecord(auth)
    || auth.type !== "oauth"
    || typeof auth.refresh !== "string"
    || typeof auth.access !== "string"
    || typeof auth.expires !== "number"
  ) {
    throw new Error("ChatGPT OAuth is required. Connect OpenAI with ChatGPT login in OpenCode V1.")
  }
  return {
    type: "oauth",
    refresh: auth.refresh,
    access: auth.access,
    expires: auth.expires,
    ...(typeof auth.accountId === "string" ? { accountId: auth.accountId } : {}),
  }
}

function createDependencies(client: PluginInput["client"]): Dependencies {
  return {
    fetch: globalThis.fetch,
    randomUUID: () => globalThis.crypto.randomUUID(),
    loadAuth: loadOpenAIAuth,
    saveAuth: async (auth) => {
      const result = await client.auth.set({
        path: { id: "openai" },
        body: auth,
      })
      if (result.error) throw new Error("OpenCode could not save the refreshed ChatGPT credential.")
    },
  }
}

async function resolveAuth(dependencies: Dependencies, signal: AbortSignal): Promise<OAuth> {
  const auth = await dependencies.loadAuth()
  if (auth.access && auth.expires > Date.now()) return auth

  let response: Response
  try {
    response = await dependencies.fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: clientID,
      }),
      signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
  } catch {
    throw new Error(signal.aborted ? "ChatGPT credential refresh was aborted." : "ChatGPT credential refresh failed.")
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error("ChatGPT credential refresh failed. Reconnect OpenAI in OpenCode V1.")
  }
  const value = await response.json().catch(() => undefined)
  if (
    !isRecord(value)
    || typeof value.access_token !== "string"
    || typeof value.refresh_token !== "string"
  ) throw new Error("ChatGPT credential refresh returned an invalid response.")

  const refreshed: OAuth = {
    type: "oauth",
    access: value.access_token,
    refresh: value.refresh_token,
    expires: Date.now() + (typeof value.expires_in === "number" ? value.expires_in : 3600) * 1000,
    ...(accountID(value) ?? auth.accountId ? { accountId: accountID(value) ?? auth.accountId } : {}),
  }
  await dependencies.saveAuth(refreshed)
  return refreshed
}

async function search(query: string, context: ToolContext, dependencies: Dependencies): Promise<SearchResult[]> {
  const value = query.trim()
  if (!value) throw new Error("ChatGPT web search requires a non-empty query.")
  if (new TextEncoder().encode(value).byteLength > maximumQueryBytes) {
    throw new Error(`ChatGPT web search query exceeded ${maximumQueryBytes} UTF-8 bytes.`)
  }

  const timed = timedSignal(context.abort, timeoutMs)
  try {
    const auth = await resolveAuth(dependencies, timed.signal)
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${auth.access}`,
      "Content-Type": "application/json",
      originator: "opencode",
    }
    if (auth.accountId) headers["ChatGPT-Account-ID"] = auth.accountId
    const response = await dependencies.fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: dependencies.randomUUID(),
        model: "gpt-5.6-luna",
        reasoning: { effort: "max" },
        input: value,
        commands: { search_query: [{ q: value }], response_length: "short" },
        settings: { allowed_callers: ["direct"], external_web_access: true },
        max_output_tokens: 4096,
      }),
      signal: timed.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
    if (response.url && new URL(response.url).origin !== new URL(endpoint).origin) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("ChatGPT web search returned from an unexpected origin.")
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 401 || response.status === 403) {
        throw new Error(`ChatGPT web search authentication failed (HTTP ${response.status}). Reconnect OpenAI.`)
      }
      throw new Error(`ChatGPT web search failed (HTTP ${response.status}).`)
    }
    return parseResponse(await readBounded(response))
  } catch (error) {
    if (context.abort.aborted) throw new Error("ChatGPT web search was aborted.")
    if (timed.timedOut()) throw new Error("ChatGPT web search timed out.")
    throw error instanceof Error ? error : new Error("ChatGPT web search request failed.")
  } finally {
    timed.dispose()
  }
}

function parseResponse(body: string): SearchResult[] {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error("ChatGPT web search returned invalid JSON.")
  }
  if (!isRecord(value) || typeof value.output !== "string" || !Array.isArray(value.results)) {
    throw new Error("ChatGPT web search did not return structured citations; the alpha protocol may have changed.")
  }
  return value.results.flatMap((result): SearchResult[] => {
    if (!isRecord(result) || result.type !== "text_result" || typeof result.url !== "string") return []
    if (!isSafeURL(result.url)) return []
    const title = text(result.title)
    const content = text(result.snippet)
    return [{ url: result.url, ...(title ? { title } : {}), ...(content ? { content } : {}) }]
  })
}

async function readBounded(response: Response) {
  const declared = response.headers.get("content-length")
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumResponseBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`ChatGPT web search response exceeded ${maximumResponseBytes} bytes.`)
  }
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`ChatGPT web search response exceeded ${maximumResponseBytes} bytes.`)
      }
      chunks.push(item.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function timedSignal(parent: AbortSignal, milliseconds: number) {
  const controller = new AbortController()
  let timeout = false
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) abort()
  else parent.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => {
    timeout = true
    controller.abort()
  }, milliseconds)
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    dispose: () => {
      clearTimeout(timer)
      parent.removeEventListener("abort", abort)
    },
  }
}

function accountID(tokens: Record<string, unknown>) {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (typeof token !== "string") continue
    const claims = parseJWT(token)
    const auth = claims && isRecord(claims["https://api.openai.com/auth"])
      ? claims["https://api.openai.com/auth"]
      : undefined
    const value = claims?.chatgpt_account_id ?? auth?.chatgpt_account_id
    if (typeof value === "string") return value
  }
}

function parseJWT(token: string): Record<string, unknown> | undefined {
  const pieces = token.split(".")
  if (pieces.length !== 3) return
  try {
    const value: unknown = JSON.parse(Buffer.from(pieces[1], "base64url").toString())
    return isRecord(value) ? value : undefined
  } catch {
    return
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isSafeURL(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createExecutor(dependencies: Dependencies) {
  return async ({ query }: { query: string }, context: ToolContext): Promise<ToolResult> => {
    const results = await search(query, context, dependencies)
    return {
      title: `ChatGPT web search: ${query}`,
      output: JSON.stringify(results, null, 2),
      metadata: { resultCount: results.length },
    }
  }
}

const createPlugin: Plugin = async ({ client }) => ({
  tool: {
    chatgpt_websearch: {
      description: "Search the web through OpenAI using the active ChatGPT OAuth login.",
      args: {
        query: z.string().describe("Web search query"),
      },
      execute: createExecutor(createDependencies(client)),
    },
  },
})

export const ChatGPTWebSearchPlugin = Object.assign(createPlugin, {
  internals: { createExecutor, parseResponse, resolveAuth, search },
})
