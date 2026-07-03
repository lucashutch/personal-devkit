---
name: pr-description
description: Write or update a clean, concise PR title and description covering everything changed on the branch. Use whenever creating a PR or refreshing its description after new commits.
---
# PR description

Write PR descriptions that are clean and concise, covering the whole branch — never just the latest commit.

## Gather the full branch scope
1. Find the branch point: `git merge-base HEAD origin/<default-branch>`.
2. Review everything since then: `git log --oneline <merge-base>..HEAD` and `git diff --stat <merge-base>..HEAD`; read the full diff for anything you didn't author in this session.
3. If a PR already exists, read its current description and update it to reflect the full diff, not append to it.

## Format
Title: imperative, specific, under ~70 chars.

Body:
```
[1-3 sentence summary: what this PR does and why]

## Changes
- [main feature/change/fix, grouped by theme, not by commit]
- [...]
```

Add a `Fixes #N` / issue link line when applicable.

## Rules
1. Group by feature/change/fix, never by commit; nobody should need the commit list to understand the PR.
2. Do NOT include "Testing done", test plans, checklists, screenshots-placeholder sections, or boilerplate headings.
3. Concise beats complete: omit mechanical fallout (lockfiles, formatting, renames) unless it is the point of the PR.
4. Mention breaking changes or migration steps explicitly if any exist — this is the one extra section allowed (`## Breaking changes`).
