import assert from "node:assert/strict"
import test from "node:test"

import plugin, { compactSkillsBlock } from "./slim-skills/index.js"

const block = `Before
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <id>ship</id>
    <name>Ship</name>
    <description>Validate, commit,
      push, and create a PR.</description>
  </skill>
</available_skills>
After`

test("compactSkillsBlock preserves skill IDs and descriptions", () => {
  assert.equal(
    compactSkillsBlock(block),
    `Before
Load a skill with the skill tool when a task matches its description. Available skills:
- ship: Validate, commit, push, and create a PR.
After`,
  )
})

test("compactSkillsBlock leaves unknown formats unchanged", () => {
  assert.equal(compactSkillsBlock("No skills here"), "No skills here")
  assert.equal(compactSkillsBlock("<available_skills>invalid</available_skills>"), "<available_skills>invalid</available_skills>")
})

test("compacts metadata and escaped text only when every entry parses", () => {
  const valid = `Skills provide specialized help.<available_skills><skill><description>Use &lt;safe&gt;.</description><metadata>x</metadata><id>a&amp;b</id></skill></available_skills>`
  assert.match(compactSkillsBlock(valid), /- a&amp;b: Use &lt;safe&gt;\./)
  const mixed = `Skills provide specialized help.<available_skills><skill><id>a</id><description>A</description></skill><skill><id>b</id></skill></available_skills>`
  assert.equal(compactSkillsBlock(mixed), mixed)
  const duplicate = `Skills provide specialized help.<available_skills><skill><id>a</id><id>b</id><description>A</description></skill></available_skills>`
  assert.equal(compactSkillsBlock(duplicate), duplicate)
  const nested = `Skills provide specialized help.<available_skills><skill><id>a</id><description>A</description><skill><id>b</id><description>B</description></skill></skill></available_skills>`
  assert.equal(compactSkillsBlock(nested), nested)
})

test("plugin transforms text system parts", async () => {
  let hook
  await plugin.setup({ session: { hook: async (_name, callback) => { hook = callback } } })
  const original = { type: "text", text: block }
  const event = { system: [original, { type: "image", data: "unchanged" }] }

  hook(event)

  assert.match(event.system[0].text, /- ship: Validate, commit, push, and create a PR\./)
  assert.equal(original.text, block)
  assert.deepEqual(event.system[1], { type: "image", data: "unchanged" })
})
