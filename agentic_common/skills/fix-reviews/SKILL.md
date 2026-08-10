---
name: fix-reviews
description: Address unresolved PR feedback, validate and amend fixes, push safely, then resolve threads.
---
# Fix reviews

Perform this pipeline in order:

1. Inspect the current branch, working-tree status, open PR, and all unresolved review comments/threads using the `gh` CLI. Do not disturb or include unrelated changes.
2. Classify the feedback before editing. Ask the user about comments that are ambiguous, contradictory, obsolete, unsafe, or materially expand scope.
3. Make focused code changes to address every actionable review comment.
4. Run the relevant practical tests and quality gates. Do not push or resolve threads when required validation fails.
5. Amend the most recent commit with only the intended fixes so the work stays in a single changeset.
6. Push the rewritten branch with `--force-with-lease`.
7. Mark only the confirmed-addressed review threads as resolved using the `gh` CLI.
8. If the fixes changed the PR's scope or behavior, load the `pr-description` skill and refresh the PR title and body.

If any review comment cannot be safely resolved, explain why before taking further action.
