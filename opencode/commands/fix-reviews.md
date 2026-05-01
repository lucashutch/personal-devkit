---
description: Address PR review feedback and ship the fix
---
I want you to use your `bash` tool to perform the following pipeline in order:

1. Inspect the current branch, the open PR, and all unresolved Copilot review comments/threads using the `gh` CLI.
2. Make the required code changes to address every actionable review comment.
3. Amend the last commit so the fix stays in a single changeset.
4. Push the branch with `--force-with-lease`.
5. Mark the addressed review threads as resolved using the `gh` CLI.

If any review comment cannot be safely resolved, explain why before taking further action.
