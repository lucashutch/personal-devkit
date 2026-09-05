import { Plugin } from "@opencode-ai/plugin"

const skillsBlockPattern = /Skills provide specialized[\s\S]*?<available_skills>([\s\S]*?)<\/available_skills>/

export function compactSkillsBlock(text) {
  return text.replace(skillsBlockPattern, (match, inner) => {
    const skills = []
    const entries = [...inner.matchAll(/<skill>([\s\S]*?)<\/skill>/g)]
    if (entries.length === 0 || inner.replace(/<skill>[\s\S]*?<\/skill>/g, "").trim()) return match
    let found
    for (found of entries) {
      const ids = [...found[1].matchAll(/<id>([\s\S]*?)<\/id>/g)]
      const descriptions = [...found[1].matchAll(/<description>([\s\S]*?)<\/description>/g)]
      if (ids.length !== 1 || descriptions.length !== 1 || /<\/?skill(?:\s|>)/.test(found[1])) return match
      const idMatch = ids[0]
      const descriptionMatch = descriptions[0]
      const id = idMatch[1].trim()
      const description = descriptionMatch[1].trim().replace(/\s+/g, " ")
      if (!id || !description) return match
      skills.push(`- ${id}: ${description}`)
    }
    if (skills.length === 0) return match
    return [
      "Load a skill with the skill tool when a task matches its description. Available skills:",
      ...skills,
    ].join("\n")
  })
}

export default Plugin.define({
  id: "personal.slim-skills",
  setup: async (ctx) => {
    // Replace parts rather than assign through `part.text`: the host declares
    // a system part read-only and only the `system` array itself mutable.
    await ctx.session.hook("context", (event) => {
      if (!Array.isArray(event.system)) return
      event.system = event.system.map((part) =>
        part?.type === "text" && typeof part.text === "string"
          ? { ...part, text: compactSkillsBlock(part.text) }
          : part,
      )
    })
  },
})
