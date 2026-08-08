// Shared by the V2 slim-tools plugin. Tool names and parameter names follow
// the V2 builtin tools (shell/subagent/patch, `path` instead of `filePath`);
// verify against proxy captures after opencode2 upgrades.
export const slimDescriptions = Object.freeze({
  shell:
    "Execute a shell command. Use read for files and line ranges instead of nl, sed, head, tail, cat, or awk. Runs in the active Location by default; optional workdir and timeout in milliseconds. Set background=true to run asynchronously.",
  subagent:
    "Spawn a subagent with fresh context for work that should be delegated. Provide the agent type, short description, and full prompt. background=true runs it asynchronously.",
  execute:
    "Run JavaScript in the confined Code Mode runtime to search and call catalog tools. No imports, direct filesystem or network access, processes, or timers. Use exact catalog paths and signatures; await calls and return the result.",
  read: "Read a file, supported image, or directory listing. Supports offset and limit for paging.",
  edit:
    "Edit an existing file by exact string replacement. oldString must match exactly; use replaceAll only when replacing every match.",
  write: "Create or overwrite a file. Prefer edit for existing files.",
  glob: "Find files by glob pattern.",
  grep: "Search file contents by regex. Returns matching files, line numbers, and previews.",
  patch:
    "Edit files with one patch containing add, update, and delete operations. Operations apply sequentially; earlier operations remain applied if a later one fails.",
  skill:
    "Load a skill's full instructions by ID when its description matches the current task. Follow the loaded instructions.",
  question:
    "Ask the user clarifying questions when blocked or to offer direction choices. Answers return as arrays of labels; set multiple:true for multi-select. Put a recommended option first, labelled '(Recommended)'.",
  webfetch:
    "Fetch an HTTP or HTTPS URL as markdown, text, or HTML. Read-only; prefer a more targeted tool when available.",
})

export const slimParamDescriptions = Object.freeze({
  shell: {
    command: "Command to execute",
    workdir: "Working directory; use instead of cd",
    timeout: "Optional timeout in milliseconds (0 unlimited, max 600000)",
    background: "Run asynchronously and notify on completion",
  },
  subagent: {
    agent: "Configured agent role",
    description: "Short task label",
    prompt: "Full subagent instructions",
    background: "Run asynchronously and notify on completion",
    model_profile: "Execution tier: fast, standard, deep, or inherit",
  },
  execute: { code: "JavaScript using only catalog tools" },
  read: {
    path: "Path to read",
    offset: "1-based line or entry offset",
    limit: "Maximum lines or entries to read",
  },
  edit: {
    path: "File path to edit",
    oldString: "Exact text to replace",
    newString: "Replacement text",
    replaceAll: "Replace all matches",
  },
  write: { path: "File path to write", content: "File contents" },
  glob: {
    pattern: "Glob pattern to match files",
    path: "Directory to search from",
    limit: "Maximum results",
  },
  grep: {
    pattern: "Regex pattern to search for",
    path: "Directory or file to search",
    include: "File glob to include",
    limit: "Maximum matches",
  },
  patch: { patchText: "Patch text with add/update/delete operations" },
  skill: { id: "Skill ID from the available skills list" },
  question: {
    questions: "Questions to ask",
    question: "Complete question",
    header: "Short label (max 30 chars)",
    options: "Available choices",
    label: "Choice label (1-5 words)",
    description: "Choice explanation",
    multiple: "Allow multiple choices",
  },
  webfetch: {
    url: "HTTP or HTTPS URL",
    format: "Response format; defaults to markdown",
    timeout: "Optional timeout in seconds (max 120)",
  },
})
