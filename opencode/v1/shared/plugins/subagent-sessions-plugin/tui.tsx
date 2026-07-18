/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"

type ChildSession = {
  id: string
  title: string
  agent?: string
  modelLabel?: string
  parentID?: string
  time?: { created?: number }
}

type ListState = {
  children: ChildSession[]
  loading: boolean
  error?: string
}

const id = "subagent-sessions-plugin"
const MAX_VISIBLE_ROWS = 18

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) return String(error.message)
  return String(error || "Unable to load subagent sessions")
}

function truncate(value: string, length = 42) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function chronological(children: ChildSession[]) {
  return [...children].sort((left, right) => (left.time?.created ?? 0) - (right.time?.created ?? 0))
}

function modelLabel(message: unknown) {
  if (!message || typeof message !== "object") return undefined
  const info = message as {
    providerID?: unknown
    modelID?: unknown
    model?: { providerID?: unknown; modelID?: unknown }
  }
  const model = info.model ?? info
  return typeof model.providerID === "string" && typeof model.modelID === "string"
    ? `${model.providerID}/${model.modelID}`
    : undefined
}

const tui: TuiPlugin = async (api) => {
  // A single signal lets every rendered sidebar instance refresh when the host
  // reports a session change, without each instance registering its own listener.
  const [sessionRevision, setSessionRevision] = createSignal(0)
  const refreshSessions = () => setSessionRevision((value) => value + 1)
  const disposeCreated = api.event.on("session.created", refreshSessions)
  const disposeUpdated = api.event.on("session.updated", refreshSessions)
  const disposeDeleted = api.event.on("session.deleted", refreshSessions)

  api.lifecycle.onDispose(() => {
    disposeCreated()
    disposeUpdated()
    disposeDeleted()
  })

  function SubagentSessions(props: { sessionID: string }) {
    const [state, setState] = createSignal<ListState>({ children: [], loading: true })
    const [open, setOpen] = createSignal(true)
    let scrollbox: ScrollBoxRenderable | undefined
    let request = 0
    let knownChildIDs = new Set<string>()

    const withModels = async (children: ChildSession[]) => Promise.all(children.map(async (child) => {
      try {
        const result = await api.client.session.messages({ sessionID: child.id })
        if (result.error) return child
        // Prefer the latest assistant message: it records the model that actually
        // produced a response. A pending child only has its user message, which
        // still records the selected model.
        const model = [...(result.data ?? [])].reverse()
          .map((message) => modelLabel(message.info))
          .find(Boolean)
        return model ? { ...child, modelLabel: model } : child
      } catch {
        return child
      }
    }))

    createEffect(() => {
      const parentID = props.sessionID
      sessionRevision()
      const currentRequest = ++request
      setState((previous) => ({ ...previous, loading: true, error: undefined }))

      void api.client.session.children({ sessionID: parentID }).then(async (result) => {
        if (currentRequest !== request) return
        if (result.error) {
          setState({ children: [], loading: false, error: errorMessage(result.error) })
          return
        }
        const children = await withModels(chronological(result.data ?? []))
        if (currentRequest !== request) return
        const hasNewChild = children.some((child) => !knownChildIDs.has(child.id))
        knownChildIDs = new Set(children.map((child) => child.id))
        setState({ children, loading: false })
        if (hasNewChild) {
          requestAnimationFrame(() => scrollbox?.scrollTo(scrollbox.scrollHeight))
        }
      }).catch((error) => {
        if (currentRequest !== request) return
        setState({ children: [], loading: false, error: errorMessage(error) })
      })
    })

    onCleanup(() => {
      request += 1
    })

    const status = (sessionID: string) => {
      const current = api.state.session.status(sessionID)
      if (current?.type === "busy") return { label: "working", color: api.theme.current.warning }
      if (current?.type === "retry") return { label: "retrying", color: api.theme.current.error }
      return { label: "idle", color: api.theme.current.textMuted }
    }

    const listHeight = () => {
      const children = state().children.length
      if (children === 0) return 1
      // Reserve the full list viewport as soon as a child exists. A one-child
      // list is three rows tall, but its model line can otherwise initially
      // land below the scroll viewport.
      return MAX_VISIBLE_ROWS
    }

    return (
      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" onMouseDown={() => setOpen((value) => !value)}>
          <text fg={api.theme.current.textMuted}>{open() ? "▼ " : "▶ "}</text>
          <text bold>{`Subagents (${state().children.length})`}</text>
        </box>
        <Show when={open()}>
          <scrollbox
            height={listHeight()}
            stickyScroll={true}
            stickyStart="bottom"
            ref={(element: ScrollBoxRenderable) => {
              scrollbox = element
            }}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: api.theme.current.background,
                foregroundColor: api.theme.current.borderActive,
              },
            }}
          >
            <For each={state().children} fallback={
              state().loading ? (
                <text fg={api.theme.current.textMuted}>Loading sessions…</text>
              ) : state().error ? (
                <text fg={api.theme.current.error}>Subagents unavailable</text>
              ) : (
                <text fg={api.theme.current.textMuted}>No subagent sessions</text>
              )
            }>
              {(child) => {
                const live = () => api.state.session.get(child.id) ?? child
                const activity = () => status(child.id)
                return (
                  <box
                    flexDirection="row"
                    onMouseDown={() => api.route.navigate("session", { sessionID: child.id })}
                  >
                    <text fg={activity().color}>▎{"\n"}▎ </text>
                    <box flexDirection="column" flexGrow={1}>
                      <text>{truncate(live().title || "Untitled subagent")}</text>
                      <text fg={api.theme.current.textMuted}>
                        {`  ${live().agent ?? "Subagent"} · ${activity().label}`}
                      </text>
                      <text fg={api.theme.current.textMuted}>
                        {`  ${child.modelLabel ?? "Model unavailable"}`}
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

  api.slots.register({
    order: 610,
    slots: {
      // OpenTUI slot renderers receive the slot context first, then its props.
      // In particular, `session_id` is the second argument here.
      sidebar_content(_context, props) {
        return <SubagentSessions sessionID={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }

export default plugin
