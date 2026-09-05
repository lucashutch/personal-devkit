---
name: start
description: Take a feature or fix from issue to a validated change and appropriate integration.
---
# Start

1. Read the referenced issue or supplied requirements; clarify material ambiguity.
2. Inspect status, branch, upstream, base, and existing PR. Fetch refs and discover the remote default from metadata. Before switching or reusing a branch, verify ownership and check conflicts or at-risk commits; preserve unrelated work and ask if intent is unclear.
3. Honor direct-default-branch policies without forcing a branch or PR. Otherwise use a kebab-case `feat/` or `fix/` branch from the fetched default, including the issue number when available. Reuse only verified task-owned branches and update without losing work.
4. Load `orchestrate` and use its lightest workflow; invoking `start` alone does not require delegation. Implement and run relevant tests and lint before shipping.
5. Load `ship` for policy-appropriate commit, push, CI, and PR handling.
