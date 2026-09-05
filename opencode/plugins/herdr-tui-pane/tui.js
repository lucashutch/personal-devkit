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
// A session switch is only visible in the route, and nothing reports a route
// change, so it is polled. One second is enough: the reads are in-process and a
// switch only has to beat the eye, while title changes emit session.renamed.
const ROUTE_POLL_INTERVAL_MS = 1_000
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
  // Terminal execution events also cover turns without a final status update.
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

  return new Promise((resolve, reject) => {
    const client = net.createConnection(endpoint, () => {
      client.write(`${JSON.stringify(message)}\n`)
    })
    let response = ""
    const finish = () => {
      client.destroy()
      try {
        const reply = JSON.parse(response)
        if (reply.error) reject(new Error(`Herdr: ${JSON.stringify(reply.error)}`))
        else resolve(reply)
      } catch {
        reject(new Error("Invalid Herdr response"))
      }
    }
    client.setTimeout(500, finish)
    client.on("data", (chunk) => {
      response += chunk.toString()
      if (response.includes("\n")) finish()
    })
    client.on("error", reject)
    client.on("end", finish)
    client.on("close", () => {
      if (!response) reject(new Error("Herdr connection closed"))
    })
  })
}

export function stateFromSessionStatus(status) {
  // session.status carries { type: "idle" | "busy" | "retry" }; older builds used a bare string.
  const kind = typeof status === "string" ? status : status?.type
  return typeof kind === "string" ? STATE_BY_SESSION_STATUS.get(kind.toLowerCase()) : undefined
}

export function createTabRenamer(send = request, initialTabID = process.env.HERDR_TAB_ID) {
  let tabId = initialTabID

  return async (title, isCurrent = () => true) => {
    const label = title?.trim()
    if (!label || label === "Untitled" || !isCurrent()) return

    if (!tabId) {
      const response = await send("pane.get", { pane_id: process.env.HERDR_PANE_ID })
      if (!isCurrent()) return
      if (response?.error) throw new Error(`Herdr: ${JSON.stringify(response.error)}`)
      tabId = response?.result?.pane?.tab_id
      if (!tabId) throw new Error("Herdr pane has no tab")
    }
    if (tabId) {
      try {
        if (!isCurrent()) return
        const response = await send("tab.rename", { tab_id: tabId, label })
        if (response?.error) throw new Error(`Herdr: ${JSON.stringify(response.error)}`)
      } catch (error) {
        // Pane moves can invalidate the inherited tab id. Resolve it once more
        // on the next attempt rather than permanently latching stale identity.
        tabId = undefined
        throw error
      }
    }
  }
}

/**
 * Track the root session this pane shows, and keep Herdr's session id, pane
 * state and tab label in step with it.
 *
 * `selection` is pushed in by the caller: on every session event, and on a
 * slow poll for the route, which nothing announces. Repeats are cheap, since
 * an unchanged selection and title report nothing.
 *
 * `syncSelection` returns the delay after which it wants the same selection
 * offered again, or undefined when it is settled. That is only the retry
 * ladder: Herdr may not know the session yet, and nothing re-notifies us when
 * it catches up.
 */
export function createPaneSync({ reportSession, reportState, renameTab, rootOf, isSelected = () => true }) {
  let selectedSessionID
  let reportedTitle
  let retryIndex = 0
  let reportPending = false
  let reportedSession = false
  const familyStates = new Map()
  const pendingRequests = new Map()
  let reportedState

  const reportFamilyState = async () => {
    const values = [...familyStates.values()]
    const state = values.includes("blocked") ? "blocked" : values.includes("working") ? "working" : "idle"
    if (state === reportedState) return
    const sessionID = selectedSessionID
    if (!isSelected(sessionID)) return
    await reportState(state, sessionID)
    if (selectedSessionID === sessionID) reportedState = state
  }

  const syncSelection = async (selection) => {
    const sessionID = selection?.sessionID
    if (!sessionID) {
      selectedSessionID = undefined
      reportedTitle = undefined
      retryIndex = 0
      familyStates.clear()
      pendingRequests.clear()
      reportedSession = false
      reportedState = undefined
      return undefined
    }
    if (sessionID !== selectedSessionID) {
      selectedSessionID = sessionID
      reportedTitle = undefined
      retryIndex = 0
      familyStates.clear()
      pendingRequests.clear()
      reportedSession = false
      reportedState = undefined
    }

    const current = () => selectedSessionID === sessionID && isSelected(sessionID)
    if (reportPending) return undefined
    reportPending = true
    try {
      const title = selection.title
      if (title && title !== reportedTitle && current()) {
        await renameTab(title, current)
        if (!current()) return undefined
        reportedTitle = title
      }
      if (!current()) return undefined
      if (!reportedSession) {
        const response = await reportSession(sessionID)
        if (response?.error) throw new Error(`Herdr: ${JSON.stringify(response.error)}`)
        if (current()) reportedSession = true
      }
      if (familyStates.size) await reportFamilyState()
      retryIndex = 0
      return undefined
    } catch {
      // Best-effort: the retry ladder covers a socket that is not ready.
    } finally {
      reportPending = false
    }
    if (selectedSessionID !== sessionID) {
      retryIndex = 0
      return undefined
    }
    const retryDelay = SELECTION_RETRY_DELAYS_MS[Math.min(retryIndex, SELECTION_RETRY_DELAYS_MS.length - 1)]
    retryIndex += 1
    return retryDelay
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
    if (state) {
      const kind = event.type.split(".")[0]
      const requests = pendingRequests.get(sessionID) ?? new Set()
      const requestID = `${kind}:${event.data.requestID ?? event.data.id ?? "unknown"}`
      if (event.type === "permission.asked" || event.type === "question.asked") requests.add(requestID)
      if (["permission.replied", "question.replied", "question.rejected"].includes(event.type)) requests.delete(requestID)
      if (["session.execution.succeeded", "session.execution.interrupted", "session.execution.failed"].includes(event.type)) requests.clear()
      pendingRequests.set(sessionID, requests)
      familyStates.set(sessionID, requests.size ? "blocked" : state)
      await reportFamilyState()
    }
  }

  return { syncSelection, handleEvent }
}

export function selectedRootSession(context) {
  const route = context.ui.router.current()
  if (route?.type !== "session") return undefined
  const session = context.data.session.get(route.sessionID)
  if (!session) return undefined
  const rootID = context.data.session.root?.(route.sessionID) ?? route.sessionID
  const root = context.data.session.get(rootID) ?? session
  return { sessionID: rootID, title: root.title }
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

      let disposed = false
      const { syncSelection, handleEvent } = createPaneSync({
        isSelected: (sessionID) => !disposed && selectedRootSession(context)?.sessionID === sessionID,
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

      let retryTimer
      let syncing = false
      let queued = false
      const sync = async () => {
        if (disposed) return
        if (syncing) {
          queued = true
          return
        }
        syncing = true
        try {
          do {
            queued = false
            const retryDelay = await syncSelection(selectedRootSession(context))
            if (disposed) break
            clearTimeout(retryTimer)
            if (retryDelay !== undefined) retryTimer = setTimeout(run, retryDelay)
          } while (queued && !disposed)
        } finally {
          syncing = false
        }
      }
      const run = () => void sync().catch(fail)

      run()
      const timer = setInterval(run, ROUTE_POLL_INTERVAL_MS)
      // A title arriving or changing is an event, so do not wait for the poll.
      const stopWatchingSessions = context.data.on("session.renamed", run)
      const stopListening = context.data.listen(({ details }) => {
        void handleEvent(details).catch(fail)
      })

      return () => {
        disposed = true
        clearInterval(timer)
        clearTimeout(retryTimer)
        stopWatchingSessions()
        stopListening()
      }
    },
  }
}

export default createHerdrTuiPanePlugin()
