import type { Plugin } from "@opencode-ai/plugin"

const skillsBlockPattern = /Skills provide specialized[\s\S]*?<available_skills>([\s\S]*?)<\/available_skills>/

function compactSkillsBlock(text: string): string {
  return text.replace(skillsBlockPattern, (_match, inner: string) => {
    const skills: string[] = []
    const entry = /<skill>\s*<name>([\s\S]*?)<\/name>\s*<description>([\s\S]*?)<\/description>/g
    let m: RegExpExecArray | null
    while ((m = entry.exec(inner))) {
      const name = m[1].trim()
      const desc = m[2].trim().replace(/\s+/g, " ")
      skills.push(`- ${name}: ${desc}`)
    }
    if (skills.length === 0) return _match
    return [
      "Load a skill with the skill tool when a task matches its description. Available skills:",
      ...skills,
    ].join("\n")
  })
}

function transformNode(node: unknown): unknown {
  if (typeof node === "string") return compactSkillsBlock(node)
  if (Array.isArray(node)) return node.map(transformNode)
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    for (const key of ["content", "text"]) {
      if (typeof obj[key] === "string") obj[key] = compactSkillsBlock(obj[key] as string)
    }
    return obj
  }
  return node
}

export const SlimSkillsPlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (_input: any, output: any) => {
      if (typeof output.system === "string") {
        output.system = compactSkillsBlock(output.system)
      } else if (Array.isArray(output.system)) {
        output.system.forEach((part: unknown, i: number) => {
          output.system[i] = transformNode(part)
        })
      }
    },
  }
}
