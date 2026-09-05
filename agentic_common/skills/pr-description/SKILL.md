---
name: pr-description
description: Write or update a concise PR title and body for the full branch diff.
---
# PR description

Describe the full branch diff, not just the latest commit.

1. Fetch refs; stop on failure rather than infer scope from stale refs. Use the existing PR's actual base, including stack or release targets; otherwise use the repository's integration target. Read the full diff, including others' changes.
2. Read the existing description and template. Preserve issue links, required sections, and reviewer-added content; rewrite the rest rather than append.
3. Use a specific imperative title under ~70 characters. Summarize what and why in 1-3 sentences. For larger PRs, add `Changes` bullets grouped by feature, not commit. Omit incidental formatting, lockfiles, and renames.
4. Do not add a `Validation` section or validation details, including test commands and results. State breaking changes and migration steps under `Breaking changes`; add applicable issue links. No boilerplate test plans, checklists, placeholders, or other optional sections. A one-change PR may need only the summary.
5. When a PR is required, create a draft or update the existing PR. Submit multiline bodies through file-based input to preserve quoting.
