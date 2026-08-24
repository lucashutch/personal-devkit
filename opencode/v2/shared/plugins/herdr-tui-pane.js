// Herdr pane integration for the V2 TUI, derived from the Herdr opencode and
// opencode-tui integrations (HERDR_INTEGRATION_ID=opencode, opencode-tui).
//
// This runs in the TUI process, not the server, and that placement is the whole
// point. V2 shares one background service across every pane: the service
// inherits HERDR_PANE_ID and HERDR_TAB_ID from whichever TUI happened to start
// it, so a server plugin reports every pane's state and every tab's title to
// that first pane. Only the TUI process knows which pane it is.
//
// One plugin owns all three reports because they answer the same question --
// which root session this pane is showing -- and must never disagree.
import net from "node:net"

const SOURCE = "herdr:opencode"
const AGENT = "opencode"
const ROUTE_POLL_INTERVAL_MS = 100
// Herdr may not know the session yet when the route changes, so repeat the
// identity report a few times while the selection holds, then stay quiet.
const SELECTION_RETRY_DELAYS_MS = [100, 400, 1_000]

const STATE_BY_SESSION_STATUS = new Map([
  ["idle", "idle"],
  ["active", "working"],
  ["busy", "working"],
  ["pending", "working"],
  ["retry", "working"],
  ["running", "working"],
  ["streaming", "working"],
  ["working", "working"],
])

const STATE_BY_EVENT = new Map([
  ["session.input.admitted", "working"],
  ["session.execution.started", "working"],
  ["session.tool.called", "working"],
  ["session.tool.success", "working"],
  ["session.tool.failed", "working"],
  ["session.compaction.admitted", "working"],
  ["session.compaction.started", "working"],
  ["permission.replied", "working"],
  ["question.replied", "working"],
  ["question.rejected", "working"],
  ["permission.asked", "blocked"],
  ["question.asked", "blocked"],
  ["session.execution.failed", "blocked"],
  // V2 ends a turn with session.execution.*; it never emits session.idle or
  // session.status, so without these the pane stays working forever.
  ["session.execution.succeeded", "idle"],
  ["session.execution.interrupted", "idle"],
  ["session.idle", "idle"],
])

let requestSeq = Date.now() * 1000
let requestChain = Promise.resolve()

export function request(method, params) {
  const pending = requestChain.then(() => requestOnce(method, params))
  requestChain = pending.catch(() => {})
  return pending
}

function requestOnce(method, params) {
  const paneId = process.env.HERDR_PANE_ID
  const socketPath = process.env.HERDR_SOCKET_PATH
  if (!paneId || !socketPath) return Promise.resolve(undefined)

  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath
  requestSeq += 1
  const message = {
    id: `${SOURCE}:tui:${Date.now()}:${requestSeq}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      seq: requestSeq,
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

export function stateFromSessionStatus(status) {
  // session.status carries { type: "idle" | "busy" | "retry" }; older builds used a bare string.
  const kind = typeof status === "string" ? status : status?.type
  return typeof kind === "string" ? STATE_BY_SESSION_STATUS.get(kind.toLowerCase()) : undefined
}

export function createTabRenamer(send = request, initialTabID = process.env.HERDR_TAB_ID) {
  let tabId = initialTabID

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

/**
 * Track the root session this pane shows, and keep Herdr's session id, pane
 * state and tab label in step with it.
 *
 * `selection` is polled rather than latched: the poll is the only thing that
 * notices a route change, a title arriving late, or a rename, so identity and
 * title both settle without needing their own event wiring.
 */
export function createPaneSync({ reportSession, reportState, renameTab, rootOf, now = () => Date.now() }) {
  let selectedSessionID
  let reportedTitle
  let retryIndex = 0
  let nextReportAt = 0
  let reportPending = false

  const syncSelection = async (selection) => {
    const sessionID = selection?.sessionID
    if (!sessionID) {
      selectedSessionID = undefined
      reportedTitle = undefined
      retryIndex = 0
      nextReportAt = 0
      return
    }
    if (sessionID !== selectedSessionID) {
      selectedSessionID = sessionID
      reportedTitle = undefined
      retryIndex = 0
      nextReportAt = 0
    }

    const title = selection.title
    if (title && title !== reportedTitle) {
      reportedTitle = title
      await renameTab(title)
    }

    if (reportPending || now() < nextReportAt) return
    reportPending = true
    try {
      await reportSession(sessionID)
    } catch {
      // Best-effort: the retry ladder below covers a socket that is not ready.
    } finally {
      reportPending = false
    }
    if (selectedSessionID !== sessionID) {
      retryIndex = 0
      nextReportAt = 0
      return
    }
    const retryDelay = SELECTION_RETRY_DELAYS_MS[retryIndex]
    retryIndex += 1
    nextReportAt = retryDelay === undefined ? Number.POSITIVE_INFINITY : now() + retryDelay
  }

  const handleEvent = async (event) => {
    const sessionID = event?.data?.sessionID
    if (!selectedSessionID || typeof sessionID !== "string" || !sessionID) return
    // Subagent sessions get their own ids; roll them up to the root so a
    // subagent asking for permission still blocks the pane. Events belonging to
    // another pane's session are dropped, which a server plugin cannot do.
    if (rootOf(sessionID) !== selectedSessionID) return

    const state = event.type === "session.status"
      ? stateFromSessionStatus(event.data.status)
      : STATE_BY_EVENT.get(event.type)
    if (state) await reportState(state, selectedSessionID)
  }

  return { syncSelection, handleEvent }
}

export function selectedRootSession(context) {
  const route = context.ui.router.current()
  if (route?.type !== "session") return undefined
  const session = context.data.session.get(route.sessionID)
  // Subagent sessions carry a parentID; only a root selection owns the pane.
  if (!session || session.parentID) return undefined
  return { sessionID: route.sessionID, title: session.title }
}

export function createHerdrTuiPanePlugin(send = request) {
  return {
    id: "herdr.tui-pane",
    setup: (context) => {
      if (
        process.env.HERDR_ENV !== "1"
        || !process.env.HERDR_SOCKET_PATH
        || !process.env.HERDR_PANE_ID
      ) return

      const { syncSelection, handleEvent } = createPaneSync({
        reportSession: (sessionID) => send("pane.report_agent_session", {
          agent: AGENT,
          agent_session_id: sessionID,
          session_start_source: "select",
        }),
        reportState: (state, sessionID) => send("pane.report_agent", {
          agent: AGENT,
          state,
          agent_session_id: sessionID,
        }),
        renameTab: createTabRenamer(send),
        rootOf: (sessionID) => context.data.session.root(sessionID),
      })

      const fail = (error) => console.error("Herdr tui-pane report failed", error)
      // router.current() is only reactive inside a Solid computation, and plugin
      // setup does not run in one, so poll instead of tracking.
      const poll = () => void syncSelection(selectedRootSession(context)).catch(fail)
      poll()
      const timer = setInterval(poll, ROUTE_POLL_INTERVAL_MS)
      const stopListening = context.data.listen(({ details }) => {
        void handleEvent(details).catch(fail)
      })

      return () => {
        clearInterval(timer)
        stopListening()
      }
    },
  }
}

export default createHerdrTuiPanePlugin()
