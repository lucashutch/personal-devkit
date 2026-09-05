import assert from "node:assert/strict"
import test from "node:test"
import { openAiWindow, visibleQuotas } from "./limitwatch-quota/openai-windows.js"
import { createSharedFetch } from "./limitwatch-quota/shared-fetch.js"

test("shared quota work cancels only after the last consumer leaves", async () => {
  let signal
  let finish
  const fetcher = createSharedFetch((value) => {
    signal = value
    return new Promise((resolve) => { finish = resolve })
  })
  const first = fetcher.attach()
  const second = fetcher.attach()
  const pending = fetcher.get()
  assert.equal(fetcher.get(), pending)
  await Promise.resolve()
  first()
  assert.equal(signal.aborted, false)
  second()
  assert.equal(signal.aborted, true)
  finish({ lines: ["stale"] })
  await assert.rejects(pending, /cancelled/)
})

test("shared cache honors cooldown and a failed refresh can retry", async () => {
  let now = 100
  let attempts = 0
  const fetcher = createSharedFetch(async () => {
    attempts++
    if (attempts === 2) throw new Error("offline")
    return { lines: [String(attempts)] }
  }, () => now, 15)
  const detach = fetcher.attach()
  assert.deepEqual((await fetcher.get()).lines, ["1"])
  now = 110
  assert.deepEqual((await fetcher.get()).lines, ["1"])
  now = 120
  await assert.rejects(fetcher.get(), /offline/)
  assert.deepEqual((await fetcher.get()).lines, ["3"])
  detach()
})

const quota = (display_name, window_seconds) => ({ source_type: "OpenAI Codex", display_name, window_seconds })

test("OpenAI windows follow the response rather than primary/secondary assumptions", () => {
  const week = quota("Primary (7d)", 604800)
  const five = quota("Secondary (5h)", 18000)
  assert.equal(openAiWindow(week), "7d")
  assert.deepEqual(visibleQuotas([week]), [week])
  assert.deepEqual(visibleQuotas([week, five]), [week, five])
  assert.deepEqual(visibleQuotas([week]), [week])
})

test("additional OpenAI limits and credits are hidden even with matching durations", () => {
  const week = quota("Secondary (7d)", 604800)
  const other = { source_type: "GitHub Copilot", display_name: "Personal" }
  assert.deepEqual(visibleQuotas([week, quota("Cloud Tasks (5h)", 18000), quota("Credits"), quota("Primary (1h)", 3600), other]), [week, other])
})

test("legacy explicit durations work but missing windows are never invented", () => {
  assert.equal(openAiWindow(quota("Primary (5h)")), "5h")
  assert.equal(openAiWindow(quota("Primary")), undefined)
  assert.equal(openAiWindow(quota("Primary (5h)", 0)), undefined)
})
