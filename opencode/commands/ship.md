---
description: Ship changes after repo quality gates pass
agent: build
---
I want you to use your `bash` tool to perform the following pipeline in order:

1. Ensure the repository's quality gates pass.
2. Ensure you are on a feature branch; create one if needed.
3. Commit any unstaged changes (prefer amends for small changes). Read the diff to write a clear, succinct commit message.
4. Push to the remote repository, using force-with-lease if needed.
5. Create a draft Pull Request using the `gh` CLI.
