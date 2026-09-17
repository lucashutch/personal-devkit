export function requestedProfiles(messages) {
  const profiles = new Map()
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content ?? []) {
      if (part.type !== "tool" || part.name !== "subagent") continue
      const state = part.state
      const input = state?.input
      const childID = state?.metadata?.sessionID
      if (input?.sessionID || typeof childID !== "string") continue
      if (typeof input?.model === "string" && input.model !== "inherit") {
        profiles.set(childID, [input.model, input.effort ?? "medium"].join(":"))
      } else if (["fast", "standard", "deep", "advisor", "inherit"].includes(input?.model_profile)) {
        profiles.set(childID, input.model_profile)
      }
    }
  }
  return profiles
}

export function detailLines({ role, profile, status, model, tokens, cost }) {
  const tier = profile ? profile[0].toUpperCase() + profile.slice(1) : undefined
  return [
    [role, status].filter(Boolean).join(" · "),
    [tier ?? model, tokens, cost].filter(Boolean).join(" · "),
  ]
}

export function activityLabel({ permission, question, outcome, retry, running, queued = 0 }) {
  if (permission) return "blocked: permission"
  if (question) return "blocked: question"
  if (retry) return "retrying"
  if (!running && outcome === "failed") return "failed"
  if (!running && outcome === "interrupted") return "interrupted"
  const status = running ? "working" : queued ? "queued" : "idle"
  return running && queued ? `${status} · ${queued} queued` : status
}
