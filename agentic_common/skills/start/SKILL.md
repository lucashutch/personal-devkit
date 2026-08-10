---
name: start
description: Take a feature or fix from issue to validated draft PR on a new branch.
---
# Start

Run this pipeline:

1. **Understand** — inspect a referenced issue with `gh`; otherwise use the supplied requirements and ask the user to clarify only material ambiguity.
2. **Prepare** — check status and do not disturb unrelated changes. Create a kebab-case branch from the current remote default branch — never from whatever HEAD happens to be. Prefix `feat/` or `fix/` and include the issue number when there is one (e.g. `fix/123-widget-crash`). If a matching branch already exists, switch to it and bring it current with the default branch first.
3. **Orchestrate** — load the `orchestrate` skill and use its lightest suitable workflow; explicit `/start` does not by itself require subagents.
4. **Implement** — follow that workflow, then run the repo's tests/lint for the touched area so ship's gate step is a confirmation, not the first run.
5. **Ship** — load and follow the `ship` skill to gate, commit, push, and create the draft PR.
