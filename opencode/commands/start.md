---
description: Plan, implement, and ship a feature or fix on a branch with a draft PR
---

Run this pipeline:

1. **Understand** — inspect issue/feature with `gh` if given; otherwise ask with `question`.
2. **Prepare** — check status, fetch default branch, then create/switch to a kebab-case branch.
3. **Plan** — route non-trivial work to @planner for `plan.md`.
4. **Implement** — run the Director wave loop; make validated atomic commits.
5. **Ship** — pass quality gates, push, and `gh pr create --draft` with title/body/issue link.
