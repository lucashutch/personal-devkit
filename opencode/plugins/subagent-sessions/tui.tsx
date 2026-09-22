/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { listChildren, polledStatus, reconcileChildren } from "./reconcile.js"
import { activityLabel, detailLines, latestContextTokens, requestedProfiles } from "./labels.js"

type ChildSession = {
  id: string
  title?: string
  agent?: string
  model?: { providerID?: string; id?: string; variant?: string }
  parentID?: string
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  outcome?: "succeeded" | "failed" | "interrupted"
  time?: { created?: number; updated?: number }
}

type TokenUsage = { context?: number; total: number }
type ChildWithModel = ChildSession & { modelLabel?: string; tokenUsage?: TokenUsage; profile?: string }
type ListState = { children: ChildWithModel[]; loading: boolean; error?: string }

const MAX_VISIBLE_ROWS = 18

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) return String(error.message)
  return String(error || "Unable to load subagent sessions")
}

function truncate(value: string, length = 42) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function modelLabel(message: unknown) {
  if (!message || typeof message !== "object") return undefined
  const info = message as {
    providerID?: unknown
    id?: unknown
    modelID?: unknown
    model?: { providerID?: unknown; id?: unknown; modelID?: unknown; variant?: unknown }
  }
  const model = info.model ?? info
  const modelID = "id" in model ? model.id : model.modelID
  if (typeof model.providerID !== "string" || typeof modelID !== "string") return undefined
  const variant = "variant" in model && typeof model.variant === "string" ? `#${model.variant}` : ""
  return `${model.providerID}/${modelID}${variant}`
}

function delegateLabel(session: ChildSession) {
  const legacy = session.agent?.match(/^delegate-profile--(.+?)--(.+)$/)
  if (legacy) return { profile: legacy[1], agent: legacy[2] }
  const concise = session.agent?.match(/^(Fast|Standard|Deep)-(.+)$/)
  return concise ? { profile: concise[1].toLowerCase(), agent: concise[2] } : undefined
}

function modelName(value?: string) {
  return value?.split("/").at(-1)
}

function formatTokens(value: number) {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

function formatCost(value: number) {
  return `~$${value.toFixed(value < 0.01 ? 3 : 2)}`
}

export default Plugin.define({
  id: "subagent-sessions-plugin",
  setup(context) {
    const theme = context.theme
    const [revision, setRevision] = createSignal(0)
    const observedSessions = new Map<string, ChildSession>()
    const observedStatuses = new Map<string, "idle" | "running" | "retry">()
    const statusEventTimes = new Map<string, number>()
    const observedTokenCounts = new Map<string, number>()
    const observedAt = new Map<string, number>()
    const absentRemoteIDs = new Set<string>()
    // The component's revision effect rebuilds the list; a mounted slot then
    // repaints in place once the host is asked. Do not reintroduce a
    // dispose/re-register cycle, which also discarded scroll and child state.
    const refreshSessions = () => {
      setRevision((value) => value + 1)
      context.renderer.requestRender()
    }
    const rememberSession = (event: { data: Omit<ChildSession, "id"> & { sessionID: string } }) => {
      observedSessions.set(event.data.sessionID, { ...event.data, id: event.data.sessionID })
      observedAt.set(event.data.sessionID, Date.now())
      absentRemoteIDs.delete(event.data.sessionID)
      refreshSessions()
    }
    const disposeCreated = context.data.on("session.created", rememberSession)
    const disposeRenamed = context.data.on("session.renamed", refreshSessions)
    const disposeModelSelected = context.data.on("session.model.selected", refreshSessions)
    const disposeUsage = context.data.on("session.usage.updated", refreshSessions)
    const disposePermissionAsked = context.data.on("permission.asked", refreshSessions)
    const disposePermissionReplied = context.data.on("permission.replied", refreshSessions)
    const disposeFormCreated = context.data.on("form.created", refreshSessions)
    const disposeFormReplied = context.data.on("form.replied", refreshSessions)
    const disposeFormCancelled = context.data.on("form.cancelled", refreshSessions)
    const disposeInboxEnqueued = context.data.on("session.inbox.enqueued", refreshSessions)
    const disposeInboxDelivered = context.data.on("session.inbox.delivered", refreshSessions)
    const disposeInboxCancelled = context.data.on("session.inbox.cancelled", refreshSessions)
    const disposeInboxDelivery = context.data.on("session.inbox.delivery.changed", refreshSessions)
    const disposeExecutionSucceeded = context.data.on("session.execution.succeeded", refreshSessions)
    const disposeExecutionFailed = context.data.on("session.execution.failed", refreshSessions)
    const disposeExecutionInterrupted = context.data.on("session.execution.interrupted", refreshSessions)
    const disposeDeleted = context.data.on("session.deleted", (event) => {
      observedSessions.delete(event.data.sessionID)
      observedStatuses.delete(event.data.sessionID)
      statusEventTimes.delete(event.data.sessionID)
      observedTokenCounts.delete(event.data.sessionID)
      observedAt.delete(event.data.sessionID)
      absentRemoteIDs.add(event.data.sessionID)
      refreshSessions()
    })
    const disposeStatus = context.data.on("session.status", (event) => {
      const type = event.data.status.type
      observedStatuses.set(event.data.sessionID, type === "busy" ? "running" : type === "retry" ? "retry" : "idle")
      statusEventTimes.set(event.data.sessionID, Date.now())
      refreshSessions()
    })

    function SubagentSessions(props: { sessionID: string }) {
      const [state, setState] = createSignal<ListState>({ children: [], loading: true })
      const [open, setOpen] = createSignal(true)
      let scrollbox: { scrollHeight: number; scrollTo(value: number): void } | undefined
      let request = 0
      let disposed = false
      let polling = false
      let knownChildIDs = new Set<string>()
      const syncedDetailIDs = new Set<string>()
      const syncingDetailIDs = new Set<string>()

      const syncDetails = (sessionID: string) => {
        if (syncedDetailIDs.has(sessionID) || syncingDetailIDs.has(sessionID)) return
        syncingDetailIDs.add(sessionID)
        void Promise.all([
          context.data.session.message.sync(sessionID),
          context.data.session.permission.sync(sessionID),
          context.data.session.form.sync(sessionID, context.location),
          context.data.session.pending.sync(sessionID),
        ]).then(() => {
          syncedDetailIDs.add(sessionID)
          refreshSessions()
        }).catch(() => {}).finally(() => syncingDetailIDs.delete(sessionID))
      }

      const refreshRemote = async () => {
        if (polling || disposed) return
        polling = true
        const parentID = props.sessionID
        const startedAt = Date.now()
        try {
          const sessions = await listChildren(
            (input: { parentID: string; cursor?: string }) => context.client.session.list(input),
            parentID, () => !disposed && parentID === props.sessionID,
          ) as ChildSession[] | undefined
          if (!sessions) return
          let changed = false
          for (const session of sessions) {
            const previous = observedSessions.get(session.id)
            changed ||= !previous
              || previous.time?.updated !== session.time?.updated
              || previous.title !== session.title
              || previous.agent !== session.agent

            const observedStatus = observedStatuses.get(session.id)
            const status = polledStatus(observedStatus, context.data.session.status(session.id))
            const eventIsFresh = Date.now() - (statusEventTimes.get(session.id) ?? 0) < 750
            if (!eventIsFresh && observedStatus !== status) {
              observedStatuses.set(session.id, status)
              changed = true
            }

            const tokenCount = tokenUsage(session.id)?.total ?? 0
            if (observedTokenCounts.get(session.id) !== tokenCount) {
              observedTokenCounts.set(session.id, tokenCount)
              changed = true
            }
          }
          reconcileChildren({ sessions, observed: observedSessions, observedAt,
            absent: absentRemoteIDs, parentID, startedAt })
          refreshSessions()
        } catch {
          // The local cache and event payloads remain usable if polling fails.
        } finally { polling = false }
      }

      void refreshRemote()
      const poll = setInterval(() => void refreshRemote(), 1_000)

      const load = (parentID: string) => {
        // The collection cache can lag behind session events. Retain the info
        // carried by those events so a new child is renderable immediately.
        const sessions = new Map<string, ChildSession>()
        for (const id of context.data.session.family(parentID)) {
          const session = context.data.session.get(id)
          if (session) sessions.set(id, session)
        }
        // family() is cache-backed and can lag behind creation events.
        for (const [id, session] of observedSessions) sessions.set(id, session)
        const children = [...sessions.values()]
          .filter((session) => session.parentID === parentID && !absentRemoteIDs.has(session.id))
          .sort((left, right) => (left.time?.created ?? 0) - (right.time?.created ?? 0))

        const profiles = requestedProfiles(context.data.session.message.list(parentID) ?? [])
        return children.map((child) => {
          syncDetails(child.id)
          const model = child.model
            ? modelLabel(child.model)
            : [...(context.data.session.message.list(child.id) ?? [])].reverse()
              .map((message) => modelLabel(message))
              .find(Boolean)
          const usage = tokenUsage(child.id)
          return { ...child, ...(model ? { modelLabel: model } : {}), tokenUsage: usage, profile: profiles.get(child.id) }
        })
      }

      function tokenUsage(sessionID: string): TokenUsage | undefined {
        const tokens = context.data.session.get(sessionID)?.tokens
        if (!tokens) return undefined
        const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
        const contextTokens = latestContextTokens(context.data.session.message.list(sessionID) ?? [])
        return { context: contextTokens, total }
      }

      createEffect(() => {
        const parentID = props.sessionID
        revision()
        const currentRequest = ++request
        setState((previous) => ({ ...previous, loading: true, error: undefined }))
        try {
          const children = load(parentID)
          if (currentRequest !== request) return
          const hasNewChild = children.some((child) => !knownChildIDs.has(child.id))
          knownChildIDs = new Set(children.map((child) => child.id))
          setState({ children, loading: false })
          if (hasNewChild) requestAnimationFrame(() => scrollbox?.scrollTo(scrollbox.scrollHeight))
        } catch (error) {
          if (currentRequest !== request) return
          setState({ children: [], loading: false, error: errorMessage(error) })
        }
      })

      onCleanup(() => {
        disposed = true
        clearInterval(poll)
        request += 1
      })

      const listHeight = () => Math.max(1, Math.min(MAX_VISIBLE_ROWS, state().children.length * 3))

      const activity = (sessionID: string) => {
        const session = context.data.session.get(sessionID)
        const status = observedStatuses.get(sessionID) ?? context.data.session.status(sessionID)
        const permission = (context.data.session.permission.list(sessionID)?.length ?? 0) > 0
        const question = (context.data.session.form.list(sessionID, context.location)?.length ?? 0) > 0
        const queued = context.data.session.pending.list(sessionID).length
        const label = activityLabel({ permission, question, outcome: session?.outcome,
          retry: status === "retry", running: status === "running", queued })
        const color = permission || question || status === "retry"
          ? theme.text.feedback.warning.base
          : session?.outcome === "failed"
            ? theme.text.feedback.error.base
            : status === "running" ? theme.text.feedback.warning.base : theme.text.muted
        return { label, color }
      }

      return (
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" onMouseDown={() => setOpen((value) => !value)}>
            <text fg={theme.text.muted}>{open() ? "▼ " : "▶ "}</text>
            <text attributes={TextAttributes.BOLD}>{`Subagents (${state().children.length}) · ${formatCost(context.data.session.cost(props.sessionID))}`}</text>
          </box>
          <Show when={open()}>
            <scrollbox
              height={listHeight()}
              stickyScroll={true}
              stickyStart="bottom"
              ref={(element) => { scrollbox = element }}
              verticalScrollbarOptions={{
                trackOptions: {
                  backgroundColor: theme.background.base,
                  foregroundColor: theme.scrollbar.base,
                },
              }}
            >
              <For each={state().children} fallback={
                state().loading ? <text fg={theme.text.muted}>Loading sessions…</text>
                  : state().error ? <text fg={theme.text.feedback.error.base}>Subagents unavailable</text>
                    : <text fg={theme.text.muted}>No subagent sessions</text>
              }>
                {(child) => {
                  const live = () => context.data.session.get(child.id) ?? child
                  const current = () => activity(child.id)
                  const label = () => delegateLabel(live())
                  const role = () => label()?.agent ?? live().agent ?? "Subagent"
                  const model = () => child.modelLabel ?? modelLabel(live().model)
                  const usage = () => child.tokenUsage
                  const tokenLabel = () => {
                    const current = usage()
                    if (!current) return undefined
                    const contextLabel = current.context === undefined ? undefined : `C:${formatTokens(current.context)}`
                    return [contextLabel, `T:${formatTokens(current.total)}`].filter(Boolean).join(" ")
                  }
                  const costLabel = () => formatCost(context.data.session.cost(child.id))
                  const lines = () => detailLines({ role: role(), profile: child.profile ?? label()?.profile,
                    status: current().label, model: modelName(model()), tokens: tokenLabel(), cost: costLabel() })
                  return (
                    <box
                      flexDirection="row"
                      flexShrink={0}
                      height={3}
                      onMouseDown={() => context.ui.router.navigate({ type: "session", sessionID: child.id })}
                    >
                      <text fg={current().color}>▎{"\n"}▎{"\n"}▎</text>
                      <box flexDirection="column" flexGrow={1} minWidth={0}>
                        <text height={1} wrapMode="none">{truncate(
                          live().title || "Untitled subagent",
                        )}</text>
                        <text height={1} wrapMode="none" fg={theme.text.muted}>{` ${lines()[0]}`}</text>
                        <text height={1} wrapMode="none" fg={theme.text.muted}>{` ${lines()[1]}`}</text>
                      </box>
                    </box>
                  )
                }}
              </For>
            </scrollbox>
          </Show>
        </box>
      )
    }

    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SubagentSessions sessionID={String(props.sessionID)} />,
    })

    return () => {
      disposeCreated()
      disposeRenamed()
      disposeModelSelected()
      disposeUsage()
      disposePermissionAsked()
      disposePermissionReplied()
      disposeFormCreated()
      disposeFormReplied()
      disposeFormCancelled()
      disposeInboxEnqueued()
      disposeInboxDelivered()
      disposeInboxCancelled()
      disposeInboxDelivery()
      disposeExecutionSucceeded()
      disposeExecutionFailed()
      disposeExecutionInterrupted()
      disposeDeleted()
      disposeStatus()
      disposeSlot()
    }
  },
})
