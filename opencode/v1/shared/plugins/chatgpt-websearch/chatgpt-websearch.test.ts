import { describe, expect, test } from "bun:test"
import { ChatGPTWebSearchPlugin } from "../chatgpt-websearch"

const { createExecutor, resolveAuth } = ChatGPTWebSearchPlugin.internals

describe("ChatGPTWebSearchPlugin", () => {
  test("searches with ChatGPT OAuth and filters unsafe results", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined
    const execute = createExecutor({
      randomUUID: () => "search-id",
      loadAuth: async () => ({
        type: "oauth",
        refresh: "refresh-secret",
        access: "access-secret",
        expires: Date.now() + 60_000,
        accountId: "account-secret",
      }),
      saveAuth: async () => undefined,
      fetch: async (input, init) => {
        request = { input, init }
        return Response.json({
          output: "done",
          results: [
            { type: "text_result", url: "https://example.com", title: " Example ", snippet: " Result " },
            { type: "text_result", url: "javascript:alert(1)", title: "unsafe" },
          ],
        })
      },
    })
    const result = await execute(
      { query: "example query" },
      { abort: new AbortController().signal } as never,
    )

    expect(result).toMatchObject({ metadata: { resultCount: 1 } })
    expect(JSON.parse((result as { output: string }).output)).toEqual([
      { url: "https://example.com", title: "Example", content: "Result" },
    ])
    const headers = new Headers(request?.init?.headers)
    expect(headers.get("authorization")).toBe("Bearer access-secret")
    expect(headers.get("chatgpt-account-id")).toBe("account-secret")
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      id: "search-id",
      input: "example query",
      commands: { search_query: [{ q: "example query" }] },
    })
  })

  test("refreshes an expired credential and persists it through OpenCode", async () => {
    let saved: unknown
    const auth = await resolveAuth(
      {
        randomUUID: () => "unused",
        loadAuth: async () => ({
          type: "oauth",
          refresh: "old-refresh",
          access: "old-access",
          expires: 0,
          accountId: "account-id",
        }),
        saveAuth: async (value) => { saved = value },
        fetch: async () => Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      },
      new AbortController().signal,
    )

    expect(auth).toMatchObject({
      access: "new-access",
      refresh: "new-refresh",
      accountId: "account-id",
    })
    expect(saved).toEqual(auth)
  })

  test("does not include upstream authentication details in errors", async () => {
    const execute = createExecutor({
      randomUUID: () => "search-id",
      loadAuth: async () => ({
        type: "oauth",
        refresh: "refresh-secret",
        access: "access-secret",
        expires: Date.now() + 60_000,
      }),
      saveAuth: async () => undefined,
      fetch: async () => new Response("access-secret upstream detail", { status: 401 }),
    })

    const error = await execute(
      { query: "query" },
      { abort: new AbortController().signal } as never,
    ).then(() => undefined, (cause: unknown) => cause)
    expect(String(error)).toContain("authentication failed")
    expect(String(error)).not.toContain("access-secret")
    expect(String(error)).not.toContain("upstream detail")
  })
})
