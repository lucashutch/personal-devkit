---
name: advisor
description: Get a bounded advisor second opinion on an uncertain plan, stalled debugging, or risky change.
---
# Advisor

Consult when the user asks, a consequential approach is uncertain, debugging stalls, or a risky change needs a second opinion. Skip routine edits.

1. Select the `Advisor` role with the `advisor` execution profile. If either is unavailable, report the limitation; never silently substitute or change configuration.
2. Send one bounded question: goal, constraints, current hypothesis, relevant paths and short excerpts or diff, validation results, and uncertainty. Aim for under 1,000 words; omit transcripts, full files, and unrelated logs. Supply evidence directly because the advisor cannot run commands or browse.
3. Request a read-only recommendation, up to three evidence-backed findings, and the next useful check, usually within 250 words. No implementation, delegation, or broad exploration.
4. Wait before acting on the reviewed decision. Verify material claims, implement within scope, and run checks yourself. The primary owns final judgment; ask the user about product choices or scope changes.
5. Default to one consultation. Follow up only on a material unresolved point with new evidence, reusing the advisor session and preserving its model. Stop if advice and validation still conflict; report the blocker rather than looping.
