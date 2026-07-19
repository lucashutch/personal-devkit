---
name: ship
description: Validate, commit, push, and create or refresh a PR for completed work.
---
# Ship

Use the `bash` tool to perform this pipeline in order:

1. Inspect the working-tree status and diff. Do not disturb or include unrelated changes; use `question` when they prevent safe shipping.
2. Ensure the repository's quality gates pass.
3. Ensure you are on a feature branch; create one if needed.
4. Commit the intended uncommitted changes (prefer amends for small changes). Read the diff to write a clear, succinct commit message. Make one or more atomic commits if needed.
5. Push to the remote repository, using force-with-lease only when history was rewritten.
6. Load the `pr-description` skill and use it to produce the title and body for the full branch diff.
7. Check for an existing PR for the branch. Refresh its title and body if present; otherwise create a draft PR.
