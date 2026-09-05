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
      if (["fast", "standard", "deep", "inherit"].includes(input?.model_profile)) {
        profiles.set(childID, input.model_profile)
      }
    }
  }
  return profiles
}

export function detailLines({ role, profile, status, model, tokens }) {
  const tier = profile ? profile[0].toUpperCase() + profile.slice(1) : undefined
  return [
    [role, tier, status].filter(Boolean).join(" · "),
    [model, tokens].filter(Boolean).join(" · "),
  ]
}
