/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui"
import type { CliRenderer } from "@opentui/core"
import { createSignal, onCleanup, onMount } from "solid-js"

function ReactivitySmoke(props: { renderer: CliRenderer }) {
  const [ticks, setTicks] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => {
      setTicks((value) => value + 1)
      props.renderer.requestRender()
    }, 1_000)
    onCleanup(() => clearInterval(timer))
  })

  return <text>Plugin reactivity: {ticks()}s</text>
}

export default Plugin.define({
  id: "reactivity-smoke-plugin",
  setup(context) {
    return context.ui.slot("sidebar.content", () => <ReactivitySmoke renderer={context.renderer} />)
  },
})
