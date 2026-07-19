---
name: pr-description
description: Write/update PR title and body for the full branch diff. Use when creating or refreshing a PR description.
---
# PR description

Write PR descriptions that are clean and concise, covering the whole branch — never just the latest commit.

## Gather the full branch scope
1. Describe everything since the branch diverged from the *current remote* default branch (fetch first — stale refs give a wrong diff). Read the full diff for anything you didn't author in this session.
2. If a PR already exists, read its current description and rewrite it to reflect the full diff — don't append to it. Preserve any `Fixes #N` links and reviewer-added sections.

## Format
Title: imperative, specific, under ~70 chars.

Body:
```
[1-3 sentence summary: what this PR does and why]

## Changes
- [main feature/change/fix, grouped by theme, not by commit]
- [...]
```

For a one-change PR, the summary paragraph alone is enough — skip the bullet list.

Add a `Fixes #N` / issue link line when applicable.

## Apply it
Create new PRs as drafts. Write the body to a temp file and pass `--body-file` — inlining markdown in `--body` gets mangled by shell quoting/backticks.

## Rules
1. Group by feature/change/fix, never by commit; nobody should need the commit list to understand the PR.
2. Do NOT include "Testing done", test plans, checklists, screenshots-placeholder sections, or boilerplate headings.
3. Concise beats complete: omit mechanical fallout (lockfiles, formatting, renames) unless it is the point of the PR.
4. Mention breaking changes or migration steps explicitly if any exist (`## Breaking changes`). This and preserved reviewer-managed sections are the only extra sections allowed.
