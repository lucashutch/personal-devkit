/** @jsxImportSource @opentui/solid */
import type { ScrollBoxRenderable } from "@opentui/core"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"

type ChildSession = {
  id: string
  title?: string
  agent?: string
  model?: { providerID?: string; id?: string; variant?: string }
  parentID?: string
  time?: { created?: number; updated?: number }
}

type ChildWithModel = ChildSession & { modelLabel?: string }
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
  const match = session.agent?.match(/^delegate-profile--(.+?)--(.+)$/)
  return match ? { profile: match[1], agent: match[2] } : undefined
}

function effortLabel(value?: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : undefined
}

function modelName(value?: string) {
  return value?.split("/").at(-1)?.split("#")[0]
}

export default Plugin.define({
  id: "subagent-sessions-plugin",
  setup(context) {
    const theme = context.theme
    const [sessionRevision, setSessionRevision] = createSignal(0)
    const observedSessions = new Map<string, ChildSession>()
    let disposeSlot: (() => void) | undefined
    let slotReady = false
    const refreshSessions = () => {
      setSessionRevision((value) => value + 1)
      if (slotReady) {
        disposeSlot?.()
        disposeSlot = registerSlot()
      }
      context.renderer.requestRender()
    }
    const rememberSession = (event: { data: { sessionID: string; info: unknown } }) => {
      observedSessions.set(event.data.sessionID, event.data.info as ChildSession)
      refreshSessions()
    }
    const disposeCreated = context.data.on("session.created", rememberSession)
    const disposeUpdated = context.data.on("session.updated", rememberSession)
    const disposeDeleted = context.data.on("session.deleted", (event) => {
      observedSessions.delete(event.data.sessionID)
      refreshSessions()
    })
    const disposeStatus = context.data.on("session.status", () => context.renderer.requestRender())

    function SubagentSessions(props: { sessionID: string }) {
      const [state, setState] = createSignal<ListState>({ children: [], loading: true })
      const [open, setOpen] = createSignal(true)
      let scrollbox: ScrollBoxRenderable | undefined
      let request = 0
      let disposed = false
      let knownChildIDs = new Set<string>()

      const refreshRemote = async () => {
        const parentID = props.sessionID
        try {
          const response = await context.client.session.list({ parentID })
          if (disposed || parentID !== props.sessionID) return
          let changed = false
          for (const session of response.data as ChildSession[]) {
            const previous = observedSessions.get(session.id)
            observedSessions.set(session.id, session)
            changed ||= !previous
              || previous.time?.updated !== session.time?.updated
              || previous.title !== session.title
              || previous.agent !== session.agent
          }
          if (changed) refreshSessions()
        } catch {
          // The local cache and event payloads remain usable if polling fails.
        }
      }

      void refreshRemote()
      const poll = setInterval(() => void refreshRemote(), 1_000)

      const load = (parentID: string) => {
        // The collection cache can lag behind session events. Retain the info
        // carried by those events so a new child is renderable immediately.
        const sessions = new Map<string, ChildSession>(
          context.data.session.list().map((session) => [session.id, session]),
        )
        for (const [id, session] of observedSessions) sessions.set(id, session)
        const children = [...sessions.values()]
          .filter((session) => session.parentID === parentID)
          .sort((left, right) => (left.time?.created ?? 0) - (right.time?.created ?? 0))

        return children.map((child) => {
          const model = child.model
            ? modelLabel(child.model)
            : [...context.data.session.message.list(child.id)].reverse()
              .map((message) => modelLabel(message.info))
              .find(Boolean)
          return model ? { ...child, modelLabel: model } : child
        })
      }

      createEffect(() => {
        const parentID = props.sessionID
        sessionRevision()
        const currentRequest = ++request
        setState((previous) => ({ ...previous, loading: true, error: undefined }))
        try {
          const children = load(parentID)
          if (currentRequest !== request) return
          const hasNewChild = children.some((child) => !knownChildIDs.has(child.id))
          knownChildIDs = new Set(children.map((child) => child.id))
          setState({ children, loading: false })
          context.renderer.requestRender()
          if (hasNewChild) requestAnimationFrame(() => scrollbox?.scrollTo(scrollbox.scrollHeight))
        } catch (error) {
          if (currentRequest !== request) return
          setState({ children: [], loading: false, error: errorMessage(error) })
          context.renderer.requestRender()
        }
      })

      onCleanup(() => {
        disposed = true
        clearInterval(poll)
        request += 1
      })

      const listHeight = () => state().children.length === 0 ? 1 : MAX_VISIBLE_ROWS

      // V2 reports only "idle" or "running"; V1's separate "retry" state has no
      // equivalent in the session status API.
      const activity = (sessionID: string) =>
        context.data.session.status(sessionID) === "running"
          ? { label: "working", color: theme.text.feedback.warning.default }
          : { label: "idle", color: theme.text.subdued }

      return (
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" onMouseDown={() => setOpen((value) => !value)}>
            <text fg={theme.text.subdued}>{open() ? "▼ " : "▶ "}</text>
            <text bold>{`Subagents (${state().children.length})`}</text>
          </box>
          <Show when={open()}>
            <scrollbox
              height={listHeight()}
              stickyScroll={true}
              stickyStart="bottom"
              ref={(element: ScrollBoxRenderable) => { scrollbox = element }}
              verticalScrollbarOptions={{
                trackOptions: {
                  backgroundColor: theme.background.default,
                  foregroundColor: theme.scrollbar.default,
                },
              }}
            >
              <For each={state().children} fallback={
                state().loading ? <text fg={theme.text.subdued}>Loading sessions…</text>
                  : state().error ? <text fg={theme.text.feedback.error.default}>Subagents unavailable</text>
                    : <text fg={theme.text.subdued}>No subagent sessions</text>
              }>
                {(child) => {
                  const live = () => context.data.session.get(child.id) ?? child
                  const current = () => activity(child.id)
                  const label = () => delegateLabel(live())
                  const role = () => label()?.agent ?? live().agent ?? "Subagent"
                  const model = () => child.modelLabel ?? modelLabel(live().model)
                  return (
                    <box
                      flexDirection="row"
                      onMouseDown={() => context.ui.router.navigate({ type: "session", sessionID: child.id })}
                    >
                      <text fg={current().color}>▎{"\n"}▎ </text>
                      <box flexDirection="column" flexGrow={1}>
                        <text>{truncate(
                          [role(), effortLabel(label()?.profile)].filter(Boolean).join(" · ")
                            || live().title || "Untitled subagent",
                        )}</text>
                        <text fg={theme.text.subdued}>
                          {`  ${modelName(model()) ?? "Model unavailable"} · ${current().label}`}
                        </text>
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

    function registerSlot() {
      return context.ui.slot("sidebar.content", (props) => (
        <SubagentSessions sessionID={String(props.sessionID)} />
      ))
    }

    disposeSlot = registerSlot()
    slotReady = true

    return () => {
      disposeCreated()
      disposeUpdated()
      disposeDeleted()
      disposeStatus()
      slotReady = false
      disposeSlot?.()
    }
  },
})
