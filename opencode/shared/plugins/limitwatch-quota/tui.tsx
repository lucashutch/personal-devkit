/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createSignal } from "solid-js"
import { isOpenAiQuota, openAiWindow, visibleQuotas } from "./openai-windows.js"
import { createSharedFetch } from "./shared-fetch.js"

const DEFAULT_COMMAND = "limitwatch show --json"

const SERVICE_PREFIXES: Record<string, string> = {
  "openai codex": "oAI",
  "github copilot": "GH",
  google: "G",
}

type QuotaLine = string | { name: string; value: string }
type QuotaCache = { lines: QuotaLine[]; updatedAt: number; raw?: unknown }
const REFRESH_INTERVAL = 2 * 60 * 1000
const MIN_REFRESH_INTERVAL = 15_000
const MAX_OUTPUT_BYTES = 1024 * 1024

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim()
}

function formatQuota(quota: any): QuotaLine {
  if (!quota || typeof quota !== "object") return "Malformed quota"
  const label = formatQuotaLabel(quota)
  const service = formatService(quota)
  const reset = isOpenAiCodexQuota(quota) ? formatResetDuration(quota.reset) : ""
  const nameLabel = reset ? `${label} (${reset})` : label
  const name = `${service ? `${service} ` : ""}${nameLabel}`
  const usedPct =
    typeof quota.used_pct === "number"
      ? quota.used_pct
      : typeof quota.remaining_pct === "number"
        ? 100 - quota.remaining_pct
        : null

  if (typeof quota.remaining === "number" && typeof quota.limit === "number") {
    const pct = usedPct === null ? "?" : formatPercentage(quota, usedPct)
    if (isGithubCopilotQuota(quota)) {
      return {
        name,
        value: `${formatGithubCopilotCredits(quota)} (${pct}%)`,
      }
    }

    const includeCounts = !isGithubPersonalAccountQuota(quota, label)
    return {
      name,
      value: includeCounts ? `${pct}% (${quota.remaining}/${quota.limit})` : `${pct}%`,
    }
  }

  if (usedPct !== null) return { name, value: `${formatPercentage(quota, usedPct)}%` }
  if (quota.is_error && quota.message) return `${name}: ${quota.message}`
  return name
}

function formatPercentage(quota: any, percentage: number) {
  return percentage.toFixed(isOpenAiCodexQuota(quota) ? 0 : 1)
}

function formatResetDuration(reset: unknown) {
  if (!reset) return ""

  const resetAt = new Date(String(reset)).getTime()
  if (!Number.isFinite(resetAt)) return ""

  const totalMinutes = Math.max(0, Math.ceil((resetAt - Date.now()) / (60 * 1000)))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function isOpenAiCodexQuota(quota: any) {
  return String(quota.source_type ?? quota.source ?? "").trim().toLowerCase() === "openai codex"
}

function isGithubPersonalAccountQuota(quota: any, label: string) {
  const source = String(quota.source_type ?? quota.source ?? "").trim().toLowerCase()
  return source === "github copilot" && label.toLowerCase().includes("personal")
}

function isGithubCopilotQuota(quota: any) {
  const source = String(quota.source_type ?? quota.source ?? "").trim().toLowerCase()
  return source === "github copilot"
}

function formatGithubCopilotCredits(quota: any) {
  const used =
    typeof quota.used === "number"
      ? quota.used
      : typeof quota.consumed === "number"
        ? quota.consumed
        : typeof quota.remaining === "number" && typeof quota.limit === "number"
          ? quota.limit - quota.remaining
          : null

  if (used === null) return "? cr"
  return `${used.toFixed(1)} cr`
}

function formatQuotaLabel(quota: any) {
  const label = String(quota.display_name || quota.name || quota.source_type || "Quota")
  const source = String(quota.source_type ?? quota.source ?? "").trim().toLowerCase()

  if (source === "openai codex") return formatCodexWindowLabel(quota, label)

  return label
}

// Codex window sizes move (the 5h primary window was withdrawn and restored),
// so read the window from the payload rather than assuming per rate-limit slot.
function formatCodexWindowLabel(quota: any, label: string) {
  const window = openAiWindow(quota)
  if (window) return window
  const seconds = typeof quota.window_seconds === "number" ? quota.window_seconds : null
  if (seconds && seconds > 0) {
    const hours = Math.round(seconds / 3600)
    return hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`
  }

  const suffix = label.match(/\(([^)]+)\)\s*$/)?.[1]
  if (suffix) return suffix

  const key = label.toLowerCase()
  if (key.includes("primary")) return "5h"
  if (key.includes("secondary")) return "7d"
  return label
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

export function parseQuotaData(output: unknown): QuotaLine[] {
  const text = normalizeText(output)
  if (!text) return ["No quota data"]

  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return [text.split("\n").find(Boolean) ?? "No quota data"]

    const lines: QuotaLine[] = []
    const multiple = parsed.length > 1
    for (const account of parsed as any[]) {
      if (!account || typeof account !== "object") {
        lines.push("Unknown account: malformed quota data")
        continue
      }
      const who = account.email || account.alias || account.account || "Unknown account"
      if (account.error) {
        lines.push(`${who}: ${account.error}`)
        continue
      }
      if (!Array.isArray(account.quotas)) {
        lines.push(`${who}: malformed quota data`)
        continue
      }
      for (const quota of visibleQuotas(account.quotas)) {
        const line = formatQuota(quota)
        lines.push(multiple && !isOpenAiQuota(quota)
          ? typeof line === "string" ? `${who}: ${line}` : { ...line, name: `${who} ${line.name}` }
          : line)
      }
    }

    return lines.length > 0 ? lines : ["No quota data"]
  } catch {
    return [text.split("\n").map((l) => l.trim()).find(Boolean) ?? "No quota data"]
  }
}

// The profile wrappers point XDG_CONFIG_HOME at a per-profile directory
// (~/.config/opencode-v2-<profile>). limitwatch resolves its accounts file from
// LIMITWATCH_CONFIG_DIR, else $XDG_CONFIG_HOME/limitwatch, else
// ~/.config/limitwatch, so inheriting the profile value makes it report
// "Accounts file not found" even though the same command works in a shell.
export function quotaEnv() {
  const env = { ...process.env }
  if (env.LIMITWATCH_CONFIG_DIR?.trim()) return env
  const home = env.HOME
  // Keep a deliberate custom XDG home. Only profile wrappers identify
  // themselves with an opencode-v2 directory and need the normal user config.
  const xdg = env.XDG_CONFIG_HOME?.replace(/\/+$/, "")
  if (xdg && /^opencode(?:-v2)?-[^/]+$/.test(xdg.split("/").at(-1) ?? "")) {
    env.XDG_CONFIG_HOME = xdg.slice(0, xdg.lastIndexOf("/")) || "/"
  }
  return env
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < limit) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, limit - size)
      chunks.push(chunk)
      size += chunk.byteLength
      if (size >= limit) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(output)
}

async function fetchQuotaLines(signal: AbortSignal) {
  signal.throwIfAborted()
  const command = process.env.LIMITWATCH_COMMAND?.trim() || DEFAULT_COMMAND
  const proc = Bun.spawn(["setsid", "sh", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
    env: quotaEnv(),
  })

  const kill = () => {
    try { process.kill(-proc.pid, "SIGKILL") } catch { proc.kill("SIGKILL") }
  }
  let rejectStopped: (error: Error) => void = () => {}
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject })
  const cancel = () => { kill(); rejectStopped(new Error("Quota fetch cancelled")) }
  signal.addEventListener("abort", cancel, { once: true })
  const timeout = setTimeout(() => { kill(); rejectStopped(new Error("Quota fetch timed out")) }, 30_000)
  let result
  try {
    result = await Promise.race([Promise.all([
      readBounded(proc.stdout, MAX_OUTPUT_BYTES),
      readBounded(proc.stderr, MAX_OUTPUT_BYTES),
      proc.exited,
    ]), stopped])
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", cancel)
  }

  const [stdout, stderr, exitCode] = result

  if (exitCode !== 0) {
    return { lines: [normalizeText(stderr) || `limitwatch exited with code ${exitCode}`] }
  }

  let raw
  try { raw = JSON.parse(normalizeText(stdout)) } catch {}
  return { lines: parseQuotaData(stdout), raw }
}

const sharedFetch = createSharedFetch(fetchQuotaLines, Date.now, MIN_REFRESH_INTERVAL)

const plugin = Plugin.define({
  id: "limitwatch-quota-plugin",
  setup(context) {
    const theme = context.theme
    const [cache, updateCache] = context.storage.store<QuotaCache>("quota", {
      initial: { lines: [], updatedAt: 0 },
    })
    const [refreshing, setRefreshing] = createSignal(false)
    const [clock, setClock] = createSignal(Date.now())
    const detach = sharedFetch.attach()

    let timer: ReturnType<typeof setInterval> | undefined
    let refreshQueued = false
    let disposed = false

    // A mounted slot repaints in place; the host just needs to be asked. Do not
    // reintroduce a dispose/re-register cycle, which resets sidebar scroll.
    const repaint = () => { if (!disposed) context.renderer.requestRender() }
    const refresh = async () => {
      if (disposed) return
      sharedFetch.seed({ lines: cache.lines, raw: cache.raw, updatedAt: cache.updatedAt })
      if (refreshing()) {
        refreshQueued = true
        return
      }
      setRefreshing(true)
      try {
        const result = await sharedFetch.get()
        if (disposed) return
        await updateCache((draft) => {
          draft.lines = result.lines
          draft.raw = result.raw
          draft.updatedAt = result.updatedAt
        })
        repaint()
      } catch (error) {
        if (disposed) return
        await updateCache((draft) => {
          draft.lines = [`Error: ${error instanceof Error ? error.message : String(error)}`]
          draft.raw = undefined
          draft.updatedAt = Date.now()
        })
        repaint()
      } finally {
        setRefreshing(false)
        if (refreshQueued && !disposed) {
          refreshQueued = false
          void refresh()
        }
      }
    }

    void refresh()
    timer = setInterval(() => void refresh(), REFRESH_INTERVAL)
    timer.unref?.()
    const clockTimer = setInterval(() => { setClock(Date.now()); repaint() }, 60_000)
    clockTimer.unref?.()
    const disposeStatus = context.data.on("session.status", () => void refresh())

    function QuotaSidebar() {
      const stamp = () => cache.updatedAt
        ? `updated ${new Date(cache.updatedAt).toLocaleTimeString()}`
        : refreshing() ? "refreshing" : ""
      const lines = () => {
        clock()
        return cache.raw
        ? parseQuotaData(JSON.stringify(cache.raw))
        : cache.lines.length > 0 ? cache.lines : ["Loading quota..."]
      }

      return (
        <box flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Quotas</text>
          {lines().map((line) => typeof line === "string" ? (
            <text fg={theme.text.subdued}>{line}</text>
          ) : (
            <box flexDirection="row">
              <text fg={theme.text.subdued}>{line.name}:</text>
              <box flexGrow={1} />
              <text fg={theme.text.subdued}>{line.value}</text>
            </box>
          ))}
          {stamp() ? (
            <box flexDirection="row">
              <box flexGrow={1} />
              <text fg={theme.text.subdued}>{stamp()}</text>
            </box>
          ) : null}
        </box>
      )
    }

    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => <QuotaSidebar />,
    })

    return () => {
      disposed = true
      refreshQueued = false
      detach()
      clearInterval(clockTimer)
      if (timer) clearInterval(timer)
      disposeStatus()
      disposeSlot()
    }
  },
})

export default plugin
