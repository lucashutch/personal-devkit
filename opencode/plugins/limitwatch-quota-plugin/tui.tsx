/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const DEFAULT_COMMAND = "limitwatch show --json"

const SERVICE_PREFIXES: Record<string, string> = {
  "openai codex": "oAI",
  "github copilot": "GH",
  google: "G",
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim()
}

function formatQuota(quota: any) {
  const label = quota.display_name || quota.name || quota.source_type || "Quota"
  const service = formatService(quota)
  const usedPct =
    typeof quota.used_pct === "number"
      ? quota.used_pct
      : typeof quota.remaining_pct === "number"
        ? 100 - quota.remaining_pct
        : null

  if (typeof quota.remaining === "number" && typeof quota.limit === "number") {
    const pct = usedPct?.toFixed(1) ?? "?"
    return `${service ? `${service} ` : ""}${label}: ${pct}% used (${quota.remaining}/${quota.limit})`
  }

  if (usedPct !== null) return `${service ? `${service} ` : ""}${label}: ${usedPct.toFixed(1)}% used`
  if (quota.is_error && quota.message) return `${service ? `${service} ` : ""}${label}: ${quota.message}`
  return `${service ? `${service} ` : ""}${label}`
}

function formatService(quota: any) {
  const source = String(quota.source_type ?? quota.source ?? "").trim()
  const key = source.toLowerCase()

  if (!source) return ""

  const prefix = SERVICE_PREFIXES[key] ?? source.slice(0, 1).toUpperCase()
  if (key === "github copilot") return prefix
  if (key === "google") return prefix
  if (key === "openai codex") return prefix
  return `${prefix}(${source.toLowerCase().replace(/\s+/g, "-")})`
}

function parseQuotaData(output: unknown) {
  const text = normalizeText(output)
  if (!text) return ["No quota data"]

  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return [text.split("\n").find(Boolean) ?? "No quota data"]

    const lines: string[] = []
    for (const account of parsed as any[]) {
      if (account.error) {
        const who = account.email || account.alias || "Unknown"
        lines.push(`${who}: ${account.error}`)
        continue
      }

      for (const quota of account.quotas ?? []) {
        lines.push(formatQuota(quota))
      }
    }

    return lines.length > 0 ? lines : ["No quota data"]
  } catch {
    return [text.split("\n").map((l) => l.trim()).find(Boolean) ?? "No quota data"]
  }
}

async function fetchQuotaLines() {
  const command = process.env.LIMITWATCH_COMMAND?.trim() || DEFAULT_COMMAND
  const proc = Bun.spawn(["sh", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    return [normalizeText(stderr) || `limitwatch exited with code ${exitCode}`]
  }

  return parseQuotaData(stdout)
}

const id = "limitwatch-quota-plugin"

const tui: TuiPlugin = async (api) => {
  const [state, setState] = createSignal({
    lines: ["Loading quota..."],
    updatedAt: 0,
    refreshing: false,
  })

  let timer: ReturnType<typeof setInterval> | undefined

  const refresh = async () => {
    if (state().refreshing) return
    setState((prev) => ({ ...prev, refreshing: true }))
    try {
      const lines = await fetchQuotaLines()
      setState({ lines, updatedAt: Date.now(), refreshing: false })
    } catch (error) {
      setState({
        lines: [`Error: ${error instanceof Error ? error.message : String(error)}`],
        updatedAt: Date.now(),
        refreshing: false,
      })
    }
  }

  void refresh()
  timer = setInterval(() => {
    void refresh()
  }, 2 * 60 * 1000)
  timer.unref?.()

  api.lifecycle.onDispose(() => {
    if (timer) clearInterval(timer)
  })

  api.slots.register({
    order: 600,
    slots: {
      sidebar_content() {
        const current = state()
        const stamp = current.updatedAt
          ? `updated ${new Date(current.updatedAt).toLocaleTimeString()}`
          : current.refreshing
            ? "refreshing"
            : ""

        return (
          <box flexDirection="column">
            <text bold>Quotas</text>
            {current.lines.map((line) => (
              <text fg={api.theme.current.textMuted}>{line}</text>
            ))}
            {stamp ? (
              <box flexDirection="row">
                <box flexGrow={1} />
                <text fg={api.theme.current.textMuted}>{stamp}</text>
              </box>
            ) : null}
          </box>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
