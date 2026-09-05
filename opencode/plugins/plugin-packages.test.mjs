import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const v2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function configuredPackages(file) {
  const config = JSON.parse(readFileSync(path.join(v2, file), "utf8"))
  return config.plugins.map((entry) => typeof entry === "string" ? entry : entry.package)
}

test("configured local plugins are directory packages", () => {
  const configured = [
    ...configuredPackages("default/opencode.json"),
    ...configuredPackages("test/opencode.json"),
    ...configuredPackages("cli.json"),
  ].filter((entry) => entry.startsWith("."))

  for (const entry of configured) {
    assert.ok(entry.startsWith("./plugins/"), entry)
    const directory = path.resolve(v2, entry)
    assert.equal(statSync(directory).isDirectory(), true, entry)
    assert.equal(existsSync(path.join(directory, "package.json")), true, entry)
  }
})
