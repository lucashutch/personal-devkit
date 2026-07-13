---
name: fix-reviews
description: Fix PR review comments — code, amend, force-push-with-lease, resolve threads via gh. Use when user says fix reviews / address review feedback.
---
# Fix reviews

Use the `bash` tool to perform this pipeline in order:

1. Inspect the current branch, the open PR, and all unresolved review comments/threads using the `gh` CLI.
2. Make the required code changes to address every actionable review comment.
3. Amend the last commit so the fix stays in a single changeset.
4. Push the branch with `--force-with-lease`.
5. Mark the addressed review threads as resolved using the `gh` CLI.

If any review comment cannot be safely resolved, explain why before taking further action.
