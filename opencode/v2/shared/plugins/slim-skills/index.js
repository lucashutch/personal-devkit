import { Plugin } from "@opencode-ai/plugin"

const skillsBlockPattern = /Skills provide specialized[\s\S]*?<available_skills>([\s\S]*?)<\/available_skills>/

export function compactSkillsBlock(text) {
  return text.replace(skillsBlockPattern, (match, inner) => {
    const skills = []
    const entry = /<skill>\s*<id>([\s\S]*?)<\/id>[\s\S]*?<description>([\s\S]*?)<\/description>\s*<\/skill>/g
    let found
    while ((found = entry.exec(inner))) {
      const id = found[1].trim()
      const description = found[2].trim().replace(/\s+/g, " ")
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
