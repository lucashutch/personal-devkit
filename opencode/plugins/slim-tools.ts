import type { Plugin } from "@opencode-ai/plugin"

const slimDescriptions: Record<string, string> = {
  bash:
    "Execute a shell command in the current working directory or optional workdir. Returns stdout and stderr. Optionally provide a timeout in milliseconds.",

  task:
    "Launch a subagent for a complex or independent task. Provide subagent_type, a short description, and a complete prompt. Use task_id only to resume a prior subagent.",

  read:
    "Read a file or directory. Use absolute filePath. Supports offset and limit for large files.",

  edit:
    "Edit an existing file by exact string replacement. Read first. oldString must match exactly; use replaceAll only when replacing every match.",

  write:
    "Create or overwrite a file. Prefer edit for existing files.",

  glob:
    "Find files by glob pattern, sorted by modified time.",

  grep:
    "Search file contents by regex. Returns matching file paths and line numbers.",

  skill:
    "Load a specialized skill when it clearly matches the task.",

  question:
    "Ask the user a clarifying question when blocked.",
}

const slimParamDescriptions: Record<string, Record<string, string>> = {
  bash: {
    command: "Command to execute",
    timeout: "Optional timeout in milliseconds",
    workdir: "Working directory; use instead of cd",
    description: "Short description of the command",
  },

  task: {
    description: "Short task description",
    prompt: "Complete instructions for the subagent",
    subagent_type: "Subagent type to launch",
    task_id: "Prior task_id to resume",
    command: "Slash command that triggered this task",
  },

  read: {
    filePath: "Absolute path to read",
    offset: "Line offset for large files",
    limit: "Maximum lines to read",
  },

  edit: {
    filePath: "Absolute path to edit",
    oldString: "Exact text to replace",
    newString: "Replacement text",
    replaceAll: "Replace all matches",
  },

  write: {
    filePath: "Absolute path to write",
    content: "File contents",
  },

  glob: {
    pattern: "Glob pattern to match files",
    path: "Directory to search from",
  },

  grep: {
    pattern: "Regex pattern to search for",
    path: "Directory or file to search",
    include: "File glob to include",
  },
}

function patchJsonSchemaParamDescriptions(
  tool: any,
  params: Record<string, string>,
) {
  const props = tool?.parameters?.properties
  if (!props) return

  for (const [name, desc] of Object.entries(params)) {
    if (props[name]) props[name].description = desc
  }
}

export const SlimToolsPlugin: Plugin = async () => {
  return {
    "tool.definition": async (input: any, output: any) => {
      const toolID = input.toolID ?? input.tool ?? input.name

      if (slimDescriptions[toolID]) {
        output.description = slimDescriptions[toolID]
      }

      if (slimParamDescriptions[toolID]) {
        patchJsonSchemaParamDescriptions(output, slimParamDescriptions[toolID])
      }
    },
  }
}