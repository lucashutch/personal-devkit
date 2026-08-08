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

export default {
  id: "personal.slim-skills",
  setup: async (ctx) => {
    await ctx.session.hook("context", (event) => {
      if (!Array.isArray(event.system)) return
      for (const part of event.system) {
        if (part?.type === "text" && typeof part.text === "string") {
          part.text = compactSkillsBlock(part.text)
        }
      }
    })
  },
}
