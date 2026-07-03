---
name: fix-reviews
description: Address unresolved PR review comments - fix the code, amend, force-push with lease, and resolve the review threads via gh. Use when the user asks to handle, address, or fix PR review feedback.
---
# Fix reviews

Use the `bash` tool to perform this pipeline in order:

1. Inspect the current branch, the open PR, and all unresolved review comments/threads using the `gh` CLI.
2. Make the required code changes to address every actionable review comment.
3. Amend the last commit so the fix stays in a single changeset.
4. Push the branch with `--force-with-lease`.
5. Mark the addressed review threads as resolved using the `gh` CLI.

If any review comment cannot be safely resolved, explain why before taking further action.
