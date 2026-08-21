// Derived from the Herdr opencode integration (HERDR_INTEGRATION_ID=opencode),
// hand-ported to the V2 plugin API. Report the pane's agent state and session id
// to Herdr over its JSON-RPC socket.
import net from "node:net"

const SOURCE = "herdr:opencode"
const AGENT = "opencode"
let reportSeq = Date.now() * 1000
let requestChain = Promise.resolve()

function nextReportSeq() {
  reportSeq += 1
  return reportSeq
}

function stateFromSessionStatus(status) {
  // session.status carries { type: "idle" | "busy" | "retry" }; older builds used a bare string.
  const kind = typeof status === "string" ? status : status?.type
  if (typeof kind !== "string") return undefined
  switch (kind.toLowerCase()) {
    case "idle":
      return "idle"
    case "active":
    case "busy":
    case "pending":
    case "running":
    case "streaming":
    case "working":
    case "retry":
      return "working"
    default:
      return undefined
  }
}

function request(method, params) {
  const pending = requestChain.then(() => requestOnce(method, params))
  requestChain = pending.catch(() => {})
  return pending
}

function requestOnce(method, params) {
  const paneId = process.env.HERDR_PANE_ID
  const socketPath = process.env.HERDR_SOCKET_PATH
  if (!paneId || !socketPath) return Promise.resolve()

  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath
  const message = {
    id: `${SOURCE}:${Date.now()}:${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      seq: nextReportSeq(),
      ...params,
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

export function reportSession(sessionID) {
  if (!sessionID) return Promise.resolve()
  return request("pane.report_agent_session", { agent_session_id: sessionID })
}

export function reportState(state, sessionID) {
  const params = { state }
  if (sessionID) params.agent_session_id = sessionID
  return request("pane.report_agent", params)
}

export function createAgentStateHandler(send = { reportState, reportSession }) {
  // Subagent (task tool) sessions carry a parentID; the main agent session does
  // not. Their lifecycle events would otherwise clobber the pane's real state, so
  // learn child session ids from session.created/forked and drop their reports.
  const childSessions = new Set()
  let reportedRootSessionID

  const state = async (value, sessionID) => {
    if (sessionID) reportedRootSessionID = sessionID
    await send.reportState(value, sessionID)
  }

  return async (event) => {
    const type = event?.type
    const data = event?.data ?? {}
    const sessionID = typeof data.sessionID === "string" && data.sessionID ? data.sessionID : undefined

    if (sessionID && data.parentID) childSessions.add(sessionID)

    if (sessionID && childSessions.has(sessionID)) {
      // Child session events are dropped so they cannot clobber the pane's
      // root-agent state, but a subagent waiting on the user must still
      // surface as blocked (and clear once answered). Report state only,
      // without an agent_session_id, so the pane keeps the root session.
      switch (type) {
        case "permission.asked":
        case "question.asked":
          await send.reportState("blocked")
          break
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          await send.reportState("working")
          break
        default:
          break
      }
      return
    }

    switch (type) {
      case "session.created":
        // Creation is server-global, so an attached client may own it. The
        // TUI plugin separately reports the root selected in this pane.
        reportedRootSessionID = sessionID
        break
      case "session.renamed":
      case "session.moved":
        // V2 has no session.updated; renamed/moved are the equivalent signals
        // that an existing root session is the pane's current one.
        if (sessionID && sessionID !== reportedRootSessionID) {
          reportedRootSessionID = sessionID
          await send.reportSession(sessionID)
        }
        break
      case "session.status": {
        const value = stateFromSessionStatus(data.status)
        if (value) {
          await state(value, sessionID)
        } else {
          await send.reportSession(sessionID)
        }
        break
      }
      case "session.input.admitted":
      case "session.execution.started":
      case "session.tool.called":
      case "session.tool.success":
      case "session.tool.failed":
      case "permission.replied":
      case "question.replied":
      case "question.rejected":
      case "session.compacted":
        await state("working", sessionID)
        break
      case "permission.asked":
      case "question.asked":
      case "session.execution.failed":
        await state("blocked", sessionID)
        break
      case "session.idle":
        await state("idle", sessionID)
        break
      case "session.deleted":
        break
      default:
        break
    }
  }
}

export function createHerdrAgentStatePlugin(send = { reportState, reportSession }) {
  return {
    id: "herdr.agent-state",
    setup: async (ctx) => {
      if (
        process.env.HERDR_ENV !== "1"
        || !process.env.HERDR_SOCKET_PATH
        || !process.env.HERDR_PANE_ID
      ) return

      const controller = new AbortController()
      const handle = createAgentStateHandler(send)
      const task = (async () => {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await handle(event)
          } catch (error) {
            console.error("Herdr agent-state event failed", error)
          }
        }
      })().catch((error) => {
        if (!controller.signal.aborted) console.error("Herdr agent-state plugin failed", error)
      })

      return async () => {
        controller.abort()
        await task
      }
    },
  }
}

export default createHerdrAgentStatePlugin()
