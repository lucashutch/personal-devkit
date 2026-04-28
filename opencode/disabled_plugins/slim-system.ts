import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const logDir = join(homedir(), ".config", "opencode", "plugin-logs")
const logFile = join(logDir, "system-replace.log")

const slim = `You are OpenCode, an AI coding agent.
Be concise. 
Use tools when useful.
Read before editing.
Make small safe changes.
Use task for delegated subagent work.
Verify when practical.
Do not commit, push, delete, reset, overwrite, or run destructive commands unless explicitly requested.
Do not create extra docs or files unless asked.
`

const opencodePromptPattern = /you are opencode/i

function log(obj: unknown) {
  mkdirSync(logDir, { recursive: true })
  appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...(obj as any) }) + "\n")
}

function systemText(system: unknown): string {
  if (typeof system === "string") return system
  if (Array.isArray(system)) return system.map(systemText).join("\n")
  if (system && typeof system === "object") {
    const maybeContent = (system as { content?: unknown; text?: unknown }).content ?? (system as { text?: unknown }).text
    if (maybeContent !== undefined) return systemText(maybeContent)
  }
  return ""
}

export const SystemReplaceProbe: Plugin = async () => {
  log({ event: "plugin_loaded" })

  return {
    "experimental.chat.system.transform": async (_input: any, output: any) => {
      const before = JSON.stringify(output.system ?? "")

      log({
        event: "before",
        type: Array.isArray(output.system) ? "array" : typeof output.system,
        len: before.length,
        start: before.slice(0, 200),
      })

      if (!opencodePromptPattern.test(systemText(output.system))) {
        log({ event: "skipped", reason: "system_prompt_is_not_opencode" })
        return
      }

      // Try both styles: mutate in place and assign the field.
      if (Array.isArray(output.system)) {
        output.system.splice(0, output.system.length, slim)
      } else {
        output.system = [slim]
      }

      const after = JSON.stringify(output.system ?? "")

      log({
        event: "after",
        len: after.length,
        start: after.slice(0, 200),
      })
    },
  }
}
