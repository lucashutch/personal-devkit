---
name: orchestrate
description: Plan and coordinate large, risky, or parallel work with bounded delegation and review.
---
# Orchestrate

Keep product, scope, integration, and requested primary judgments in the primary session. Delegates supply evidence, not decisions. Batch material questions before delegation; follow user and repository requirements.

Read-only, analysis, and review requests leave no artifacts. Keep plans in the response; do not edit code or maps.

## Choose the workflow

- Small/cohesive: implement directly, without a plan file or delegation.
- Medium/coupled: plan briefly and implement directly; delegate only substantial research or useful independent review.
- Large, high-risk, independently parallel, or explicitly requested full workflow: follow the steps below. Keep coupled work together; fresh delegate contexts cost tokens.

## Execute

1. Inspect relevant code; use `repo-map` for read-only orientation if needed.
2. Write `plan.md` using the format below. Use at most five phases unless justified. Leave it uncommitted and remove on completion unless retention is required.
3. Before parallel implementation, verify shared assumptions with one end-to-end check when practical. Delegate isolated phases to Worker; parallelize only disjoint edits. Supply the objective, acceptance criteria, constraints, necessary context, owned files, and validation. Request `done` or `blocked`, changed paths, exact results, and caveats. Never send full transcripts or plans. Research tasks are read-only and return sources, retrieval dates, and uncertainties.
4. Verify each diff and validation result before advancing dependencies. Only the primary updates status. Preserve completed work when replanning unless invalidated. Reassess blockers before redispatching; never repeat unchanged instructions.
5. Review as below, then run final quality gates. The primary owns all Git, conflict, and PR operations.

## Review

Require delegated review for migrations, security-sensitive changes, public APIs, and other high-risk work. For ordinary multi-phase work, use Reviewer when it can catch meaningful regressions; skip small changes.

Supply requirements, plan/diff scope, validation results, and unverified areas. Consolidate substantive fixes into one Worker pass, then recheck affected requirements and original failure scenarios. Do not repeat full reviews for style or reopen resolved nitpicks. Stop and report blockers if work fails to converge.

## Plan format
```md
# Task implementation plan
Objective: [goal]

## Phase 1: [name; repeat per phase]
Owned files: [paths]
Dependencies: [phase IDs or none]
Tasks: [bounded changes]
Validation: [exact commands or manual checks]
Status: pending | done [result] | blocked [reason]
```
