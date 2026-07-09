---
name: start
description: End-to-end feature/fix — branch, plan, wave loop, draft PR. Use when user says start / pick up / take an issue from scratch.
---
# Start

Run this pipeline:

1. **Understand** — inspect issue/feature with `gh` if given; otherwise ask with `question`.
2. **Prepare** — check status, fetch default branch, then create/switch to a kebab-case branch.
3. **Plan** — route non-trivial work to @Planner for `plan.md`.
4. **Implement** — run the Director wave loop; make validated atomic commits.
5. **Ship** — pass quality gates, push, and `gh pr create --draft` with title/body/issue link per the `pr-description` skill.
