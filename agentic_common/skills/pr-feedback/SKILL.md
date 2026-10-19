---
name: pr-feedback
description: Triage and address review comments on the user's own PR. Use when the user links a PR and asks to look at, address, or respond to its review feedback.
---
# PR feedback

Address open review feedback on the user's PR. Make the fixes locally and draft replies. Do not post, resolve threads, or push unless the user asks.

## Gather

Delegate fetching to a subagent on the cheapest model. Keep raw diffs, threads, and logs out of the main context. Ask it to return:

1. The PR base, head branch, and whether the local checkout matches the head.
2. Each unresolved review thread and top-level review comment: author, file and line, a one-line summary, and the exact quote when the wording matters. Skip resolved and outdated threads unless the user asks for them.
3. Failing CI checks, each with the failing step and the first relevant error line.

If the local branch is behind or diverged from the PR head, stop and ask the user before you change it.

## Triage

Read the code at each referenced location yourself. Sort each comment into one group:

- Fix: the comment is correct and the change is clear.
- Discuss: the comment is unclear, conflicts with another comment, or you disagree with it. State the reason and your recommendation.
- No change: already addressed, or out of scope. Give the commit or reason.

Show the triage to the user before you edit when any comment is in Discuss, or when a fix changes behavior beyond what the reviewer asked for. Otherwise, continue.

## Fix

1. Make one fix per comment where practical, so that each reply can point to its change.
2. Delegate the build and tests to a subagent on the cheapest model. Ask for pass or fail and the first failure only.
3. Commit only when the user asks.

## Report

Give the user:

- A table of comments with their group, and the file and line changed for each fix.
- A draft reply for each thread, one or two sentences. Say what changed, or why nothing changed. Do not thank the reviewer or restate the comment.
- The build and test result.
- Any Discuss items that still need a decision.
