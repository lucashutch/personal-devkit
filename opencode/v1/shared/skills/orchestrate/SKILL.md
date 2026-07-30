---
name: orchestrate
description: Plan and coordinate large, risky, or parallel work with bounded delegation and review.
---
# Orchestrate

Coordinate work without delegating by default. Preserve the primary session's user and repository context; child sessions pay for fresh context and repeated file reads.

## Choose the lightest workflow

- **Small/cohesive:** implement directly; no plan file or subagent.
- **Medium/coupled:** make a short plan and implement directly. Delegate only substantial external research (@WebResearcher) or a fresh-eyes review that would genuinely change the outcome.
- **Large/high-risk/parallel:** use the workflow below. This includes migrations, security-sensitive changes, public API changes, broad architectural work, or genuinely independent workstreams.

If the user explicitly requests the full workflow, treat the task as large. Resolve material product and scope questions in the primary session before delegation.

## Large-task workflow

1. Ensure `repo-map.md` exists and is materially current; load `repo-map` when needed.
2. Inspect the relevant code and write a concise `plan.md` yourself. Batch material clarification questions to the user before writing it. Use the fewest useful phases and no more than five without justification; combine small, tightly coupled, or same-file work and split only for real independence or risk isolation.
3. Keep tightly coupled or overlapping-file work in one session. Dispatch only isolated or genuinely independent phases to @Worker; send @WebResearcher bounded queries for substantial external facts and request concise cited findings.
4. Launch independent phases concurrently only when their owned files are disjoint. Verify each Worker's diff and validation evidence before marking its phase done, then dispatch newly unblocked phases; the primary agent alone writes status.
5. Run one @Reviewer pass for high-risk work and when an ordinary multi-phase change has meaningful regression risk. Send one consolidated @Worker fix request if needed, then run final quality gates directly.
6. Own all branch, commit, rebase, push, conflict, and pull-request operations.

## Delegation contract

Every Worker prompt must contain only what that worker needs:

- Objective and acceptance criteria.
- Relevant findings and constraints.
- Assigned phase and explicit owned files.
- Exact validation command, or explicit manual verification criteria when no command applies.
- Expected `done` or `blocked` response.

Do not paste full transcripts or the full plan.

## `plan.md` format

```md
# Task Implementation Plan
Objective: [brief goal]

## Phases
### Phase 1: [name] (standalone)
- Files: `path`
- [bounded task]
- Testing: `[exact command]`
### Phase 2A: [name] (parallel with Phase 2B, depends: Phase 1)
...

## Status
- Phase 1: pending
```

Status values are `pending`, `done — [one-line result]`, or `blocked — [reason]`. When re-planning, preserve existing `done` Status entries unless the re-plan invalidates that work.

When a phase is blocked, reassess its dependencies and scope before redispatching. Resolve it directly, re-plan, or ask the user when a material decision is required; do not retry unchanged instructions.

## Review contract

Delegated review is mandatory for migrations, security-sensitive changes, public APIs, and other high-risk work. Use it for ordinary multi-phase work only when a fresh context is likely to catch meaningful regressions; skip it for small work. Send Reviewer the requirements, relevant plan/diff scope, and validation evidence — what was run, what passed, and what remains unverified. Apply at most one consolidated fix pass.

Stop and surface the blocker if delegated work churns without converging.
