// Derived from the Herdr opencode-tui integration (HERDR_INTEGRATION_ID=opencode-tui),
// hand-ported to the V2 TUI plugin API. Report the root session selected in this
// pane so Herdr binds the pane to the session the TUI actually shows; the
// server-side agent-state plugin only reports state, because session creation is
// server-global and any attached client may own it.
import net from "node:net"

const SOURCE = "herdr:opencode"
const AGENT = "opencode"
const ROUTE_POLL_INTERVAL_MS = 100
// Herdr may not have the session yet when the route changes, so repeat the
// report a few times while the selection holds, then stay quiet.
const SELECTION_RETRY_DELAYS_MS = [100, 400, 1_000]

export function reportSelectedSession(sessionID) {
  const paneId = process.env.HERDR_PANE_ID
  const socketPath = process.env.HERDR_SOCKET_PATH
  if (!paneId || !socketPath) return Promise.resolve()

  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath
  const message = {
    id: `${SOURCE}:tui:${Date.now()}:${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`,
    method: "pane.report_agent_session",
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      agent_session_id: sessionID,
      session_start_source: "select",
    },
  }

  return new Promise((resolve) => {
    const client = net.createConnection(endpoint, () => {
      client.write(`${JSON.stringify(message)}\n`)
    })

    const finish = () => {
      client.destroy()
      resolve()
    }

    client.setTimeout(500, finish)
    client.on("data", finish)
    client.on("error", finish)
    client.on("end", finish)
    client.on("close", resolve)
  })
}

export function selectedRootSession(context) {
  const route = context.ui.router.current()
  if (route?.type !== "session") return undefined
  const session = context.data.session.get(route.sessionID)
  // Subagent sessions carry a parentID; only a root selection owns the pane.
  return !session || session.parentID ? undefined : route.sessionID
}

export function createSelectionReporter(report = reportSelectedSession, now = () => Date.now()) {
  let selectedSessionID
  let retryIndex = 0
  let nextReportAt = 0
  let reportPending = false

  return async (sessionID) => {
    if (!sessionID) {
      selectedSessionID = undefined
      retryIndex = 0
      nextReportAt = 0
      return
    }
    if (sessionID !== selectedSessionID) {
      selectedSessionID = sessionID
      retryIndex = 0
      nextReportAt = 0
    }
    if (reportPending || now() < nextReportAt) return

    reportPending = true
    try {
      await report(sessionID)
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
}

export function createHerdrTuiSessionPlugin(report = reportSelectedSession) {
  return {
    id: "herdr.tui-session",
    setup: (context) => {
      if (
        process.env.HERDR_ENV !== "1"
        || !process.env.HERDR_SOCKET_PATH
        || !process.env.HERDR_PANE_ID
      ) return

      const sync = createSelectionReporter(report)
      // router.current() is only reactive inside a Solid computation, and plugin
      // setup does not run in one, so poll instead of tracking.
      const run = () => {
        void sync(selectedRootSession(context)).catch((error) => {
          console.error("Herdr tui-session report failed", error)
        })
      }

      run()
      const poll = setInterval(run, ROUTE_POLL_INTERVAL_MS)
      return () => clearInterval(poll)
    },
  }
}

export default createHerdrTuiSessionPlugin()
