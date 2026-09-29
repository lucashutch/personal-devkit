---
name: pr-description
description: Write or update a concise PR title and body for the full branch diff.
---
# PR description

Describe the full branch diff, not just the latest commit. A reviewer must understand the change and its reason from the body before they open the diff.

## Gather

1. Fetch refs; stop on failure rather than infer scope from stale refs. Use the existing PR's actual base, including stack or release targets; otherwise use the repository's integration target. Read the full diff, including others' changes.
2. Read the existing description and template. Preserve issue links, required sections, and reviewer-added content; rewrite the rest rather than append.
3. Find the reason for the change in the linked issue, commit messages, and code comments. If you cannot find it, ask the user. Do not invent one.

## Title

Use `type(scope): summary`, for example `fix(init): start library tasks only after init completes`. Write it in plain English: short, simple, and easy to understand.

## Body

Write in plain English: short, simple, and easy to understand. Write these parts in order.

1. Issue links, one per line (`Closes #N`), when they apply. Put references to replaced or related PRs in the summary.
2. Summary, 1-2 sentences. Say what changes and for whom. Then name the concrete problem it solves: the failure, constraint, or requirement. Do not give general benefits such as "improves robustness".
3. Flat bullets of changes, with no heading.
   - One observable change per bullet: a command, API, behavior, or caller obligation. One line each, two at most.
   - State the effect, not the edit: "`start()` no longer schedules the task", not "modified `start()`".
   - Put identifiers in backticks. Merge related edits into one bullet.
   - Order by importance to the reviewer, not by commit or file.
   - Omit formatting, lockfiles, renames, test additions, and internal refactors with no observable effect, unless the refactor is the point of the PR.
4. Skip the bullets when one sentence covers the whole change.

State breaking changes and migration steps under `Breaking changes`.

Do not add a `Validation` section or validation details, including test commands and results. No boilerplate test plans, checklists, placeholders, or other optional sections.

Example:

```
Closes #123

Create worker tasks suspended and start them only after `lib_init()` finishes, so a low-priority caller cannot be preempted by a task that uses uninitialised state.

- `TASK_create()` no longer schedules the task. Callers must call the new `TASK_start()`.
- The network and storage managers get `_start()` functions, called at the end of init.
```

## Publish

When a PR is required, create a draft or update the existing PR. Submit multiline bodies through file-based input to preserve quoting.
