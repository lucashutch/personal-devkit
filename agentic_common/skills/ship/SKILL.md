---
name: ship
description: Validate and integrate completed work according to the repository policy.
---
# Ship

1. Inspect status, diff, and repository policy. Exclude unrelated changes; ask if they block safe shipping. Run relevant quality gates without expanding scope.
2. Fetch refs; identify remote, default branch, actual base, and existing PR. Stop if discovery fails. Honor direct-default-branch policies without creating a branch or PR; otherwise verify task ownership and intended base. Resolve ambiguity before proceeding.
3. Commit only intended changes with a diff-based message. Prefer amending small fixes when the latest commit and branch belong to this work and rewriting is safe; otherwise make an atomic commit.
4. Push to the verified remote and branch. Use force-with-lease only for a safe history rewrite; stop on unexpected remote state.
5. For PR workflows, load `pr-description` to update or create a draft against the actual base. Report the commit and exact local results separately from remote CI, including pending or unavailable checks. Report unverified requirements explicitly; passing checks do not imply full completion.
