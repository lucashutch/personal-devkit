export function isOpenAiQuota(quota) {
  return String(quota?.source_type ?? quota?.source ?? "").trim().toLowerCase() === "openai codex"
}

export function openAiWindow(quota) {
  if (!isOpenAiQuota(quota)) return undefined
  // Limitwatch labels the main rate_limit slots Primary/Secondary. Additional
  // limits can have the same duration, so duration alone is insufficient.
  const label = String(quota.display_name || quota.name || "")
  if (!/^(?:OpenAI Codex )?(Primary|Secondary)(?:\s|$)/i.test(label)) return undefined
  if (typeof quota.window_seconds === "number") {
    return quota.window_seconds === 18000 ? "5h" : quota.window_seconds === 604800 ? "7d" : undefined
  }
  return label.match(/\((5h|7d)\)\s*$/i)?.[1].toLowerCase()
}

export function visibleQuotas(quotas) {
  return quotas.filter((quota) => !isOpenAiQuota(quota) || openAiWindow(quota) !== undefined)
}
