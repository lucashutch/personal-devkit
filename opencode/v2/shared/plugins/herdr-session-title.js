// Created by the Herdr session-title integration.
// Keep Herdr tab labels in sync with the selected OpenCode session title.
import net from "node:net"

const SOURCE = "herdr:opencode-session-title"
let requestSeq = Date.now() * 1000
let requestChain = Promise.resolve()

function request(method, params) {
  const pending = requestChain.then(() => requestOnce(method, params))
  requestChain = pending.catch(() => {})
  return pending
}

function requestOnce(method, params) {
  const paneId = process.env.HERDR_PANE_ID
  const socketPath = process.env.HERDR_SOCKET_PATH
  if (!paneId || !socketPath) return Promise.resolve(undefined)

  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath
  const message = {
    id: `${SOURCE}:${Date.now()}:${++requestSeq}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      seq: ++requestSeq,
      ...params,
    },
  }

  return new Promise((resolve) => {
    const client = net.createConnection(endpoint, () => {
      client.write(`${JSON.stringify(message)}\n`)
    })
    let response = ""
    const finish = () => {
      client.destroy()
      try {
        resolve(JSON.parse(response))
      } catch {
        resolve(undefined)
      }
    }
    client.setTimeout(500, finish)
    client.on("data", (chunk) => {
      response += chunk.toString()
      if (response.includes("\n")) finish()
    })
    client.on("error", () => resolve(undefined))
    client.on("end", finish)
    client.on("close", () => resolve(undefined))
  })
}

export function createTabRenamer(send = request) {
  let tabId

  return async (title) => {
    const label = title?.trim()
    if (!label || label === "Untitled") return

    if (!tabId) {
      const response = await send("pane.get", { pane_id: process.env.HERDR_PANE_ID })
      tabId = response?.result?.pane?.tab_id
    }
    if (tabId) await send("tab.rename", { tab_id: tabId, label })
  }
}

export function createSessionTitleHandler(ctx, renameTab) {
  let selectedSessionID

  return async (event) => {
    if (event?.type === "tui.session.select") {
      selectedSessionID = event.data?.sessionID
      if (!selectedSessionID) return
      const session = await ctx.session.get({ sessionID: selectedSessionID })
      await renameTab(session?.title)
      return
    }

    if (event?.type === "session.created") {
      const session = event.data
      if (!selectedSessionID && session?.sessionID && !session.parentID) {
        selectedSessionID = session.sessionID
        await renameTab(session.title)
      }
      return
    }

    if (event?.type === "session.renamed" && event.data?.sessionID === selectedSessionID) {
      await renameTab(event.data.title)
    }
  }
}

export function createHerdrSessionTitlePlugin(renameTab = createTabRenamer()) {
  return {
    id: "herdr.session-title",
    setup: async (ctx) => {
      if (
        process.env.HERDR_ENV !== "1"
        || !process.env.HERDR_SOCKET_PATH
        || !process.env.HERDR_PANE_ID
      ) return

      const controller = new AbortController()
      const handle = createSessionTitleHandler(ctx, renameTab)
      const task = (async () => {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await handle(event)
          } catch (error) {
            console.error("Herdr session-title event failed", error)
          }
        }
      })().catch((error) => {
        if (!controller.signal.aborted) console.error("Herdr session-title plugin failed", error)
      })

      return async () => {
        controller.abort()
        await task
      }
    },
  }
}

export default createHerdrSessionTitlePlugin()
