---
name: ship
description: Gates, commit, push, draft PR. Use when user says ship / publish / PR.
---
# Ship

Use the `bash` tool to perform this pipeline in order:

1. Ensure the repository's quality gates pass.
2. Ensure you are on a feature branch; create one if needed.
3. Commit any unstaged changes (prefer amends for small changes). Read the diff to write a clear, succinct commit message. Make one or more atomic commits if needed.
4. Push to the remote repository, using force-with-lease if needed.
5. Create a draft Pull Request using the `gh` CLI, writing the title/body per the `pr-description` skill.
