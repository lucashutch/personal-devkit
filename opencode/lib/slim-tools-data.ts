// Shared by the slim-tools plugin and scripts/update-slim-schemas.ts.
export const slimDescriptions: Record<string, string> = {
  bash:
    "Execute a shell command in the current working directory or optional workdir. Returns stdout and stderr. Optionally provide a timeout in milliseconds.",
  task:
    "Launch or resume a subagent for work that should be delegated. Provide the agent type, short description, and full prompt.",
  read: "Read a file or directory. Use absolute filePath. Supports offset and limit for large files.",
  edit:
    "Edit an existing file by exact string replacement. Read first. oldString must match exactly; use replaceAll only when replacing every match.",
  write: "Create or overwrite a file. Prefer edit for existing files.",
  glob: "Find files by glob pattern, sorted by modified time.",
  grep: "Search file contents by regex. Returns matching file paths and line numbers.",
  skill:
    "Load a skill's full instructions by name when its description matches the current task. Follow the loaded instructions.",
  question: "Ask the user a clarifying question when blocked.",
  apply_patch:
    "Edit files with a patch envelope. Include Begin/End Patch, then Add/Delete/Update File sections. Prefix added lines with +, including new files.",
}

export const slimParamDescriptions: Record<string, Record<string, string>> = {
  bash: {
    command: "Command to execute",
    timeout: "Optional timeout in milliseconds",
    workdir: "Working directory; use instead of cd",
    description: "Short description of the command",
  },
  task: {
    description: "Short task label",
    prompt: "Full subagent instructions",
    subagent_type: "Agent type",
    task_id: "Existing task to resume",
    command: "Triggering command",
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
  write: { filePath: "Absolute path to write", content: "File contents" },
  glob: { pattern: "Glob pattern to match files", path: "Directory to search from" },
  grep: {
    pattern: "Regex pattern to search for",
    path: "Directory or file to search",
    include: "File glob to include",
  },
  apply_patch: { patchText: "Patch envelope with file operations" },
}
