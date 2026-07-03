---
name: start
description: Start a feature or fix end-to-end - understand the issue, branch, plan, implement via the Director wave loop, and ship a draft PR. Use when the user asks to start, pick up, or take an issue/feature from scratch.
---
# Start

Run this pipeline:

1. **Understand** — inspect issue/feature with `gh` if given; otherwise ask with `question`.
2. **Prepare** — check status, fetch default branch, then create/switch to a kebab-case branch.
3. **Plan** — route non-trivial work to @planner for `plan.md`.
4. **Implement** — run the Director wave loop; make validated atomic commits.
5. **Ship** — pass quality gates, push, and `gh pr create --draft` with title/body/issue link per the `pr-description` skill.
