export async function listChildren(list, parentID, isCurrent = () => true) {
  const sessions = new Map()
  const cursors = new Set()
  let cursor
  do {
    const response = await list({ parentID, ...(cursor ? { cursor } : {}) })
    if (!isCurrent()) return undefined
    if (!Array.isArray(response.data)) throw new Error("Invalid session list")
    for (const session of response.data) sessions.set(session.id, session)
    cursor = response.cursor?.next
    if (cursor && cursors.has(cursor)) throw new Error("Repeated session cursor")
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return [...sessions.values()]
}

export function reconcileChildren({ sessions, observed, observedAt, absent, parentID, startedAt }) {
  const remoteIDs = new Set(sessions.map((session) => session.id))
  for (const session of sessions) {
    if ((observedAt.get(session.id) ?? 0) > startedAt) continue
    observed.set(session.id, session)
    absent.delete(session.id)
  }
  for (const [id, session] of observed) {
    if (session.parentID === parentID && !remoteIDs.has(id) && (observedAt.get(id) ?? 0) <= startedAt) {
      observed.delete(id)
      absent.add(id)
    }
  }
}

export function polledStatus(observed, cached) {
  return observed === "retry" ? observed : cached
}
