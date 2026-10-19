---
name: pr-review
description: Review someone else's PR and report findings. Use when the user links a PR they did not write and asks for a review.
---
# PR review

Review a PR the user did not write. Report findings to the user. Do not edit code, post comments, or submit a review unless the user asks.

## Gather

Delegate fetching to a subagent on the cheapest model. Keep raw diffs and logs out of the main context. Ask it to return:

1. The PR title, body, base, and linked issues, with the stated reason for the change.
2. The changed files with line counts, grouped by area.
3. Existing review threads: author, file and line, and a one-line summary, so that you do not repeat them.
4. Failing CI checks, each with the failing step and the first relevant error line.

## Review

1. Read the diff for each changed file yourself, with enough surrounding code to understand it. Read callers and callees when a change alters a contract.
2. Check that the change does what the PR body says, and nothing it does not say.
3. Look for correctness, error handling, concurrency, resource leaks, API and compatibility breaks, and missing tests for new behavior.
4. Verify each finding against the code before you report it. When a claim depends on behavior you cannot confirm by reading, say so, or ask a subagent to build or test it.
5. Skip style points that a formatter or linter would catch, and points already raised in existing threads.

## Report

Format findings with the `reportfindings` skill. Then add:

- A one-line verdict: approve, approve with nits, or request changes.
- A draft comment for each finding, one to three sentences, written to the PR author. Write a question when you are not sure the finding is a defect.
