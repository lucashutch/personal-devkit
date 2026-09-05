export function createSharedFetch(fetch, now = Date.now, cooldown = 15000) {
  const consumers = new Set()
  let pending
  let result
  return {
    attach() {
      const token = {}
      consumers.add(token)
      return () => {
        consumers.delete(token)
        if (!consumers.size && pending) {
          const previous = pending
          pending = undefined
          previous.controller.abort()
        }
      }
    },
    seed(value) {
      if (value?.updatedAt > (result?.updatedAt ?? 0)) result = value
    },
    get() {
      if (result && now() - result.updatedAt < cooldown) return Promise.resolve(result)
      if (pending) return pending.promise
      const operation = { controller: new AbortController(), promise: undefined }
      pending = operation
      operation.promise = Promise.resolve().then(() => fetch(operation.controller.signal)).then((value) => {
        if (operation.controller.signal.aborted) throw new Error("Quota fetch cancelled")
        result = { ...value, updatedAt: now() }
        return result
      }).finally(() => { if (pending === operation) pending = undefined })
      return operation.promise
    },
  }
}
