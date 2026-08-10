---
name: pr-triage
description: Survey open PRs and report them tiered by staleness, with issue-link gaps and revive/drop calls.
---
# PR triage

Produce a decision-ready overview of open PRs: which are current, which need a rebase, which to drop, and where issue links are missing. Read-only unless the user asks for follow-up action.

Perform this pipeline in order:

1. Scope the survey. Default to PRs authored by the current user (`gh api user --jq .login`, then `gh pr list --author <login>`); survey all authors only when asked. Pass `--limit 100` — the default caps at 30 and silently hides PRs. State the scope in the report.

2. Fetch first: `git fetch -q origin`. Then measure drift **only against `origin/<branch>`, never a local branch of the same name** — stale local checkouts inflate the count badly. Compute `git rev-list --count origin/<head>..origin/main` per PR.

3. Collect per PR in one batched call (`gh pr list --json number,title,headRefName,isDraft,mergeable,updatedAt,url`) rather than per-PR queries: number, title, head branch, draft state, `mergeable` (flag `CONFLICTING` explicitly), last commit date, and behind-count.

4. Resolve issue links authoritatively via GraphQL `closingIssuesReferences`, not by grepping the body for `#\d+`. Bodies cite stacked PRs, workflow runs and unrelated numbers, so text matching produces false links in both directions.

5. Tier by behind-count, and treat the thresholds as guidance rather than law — weigh diff size and blast radius too. A one-line Kconfig change 80 commits behind is trivial to rebase; a broad refactor 10 behind may not be.
   - **Warm** (≲10 behind): land as-is.
   - **Stale** (10–150): needs a real rebase; judge whether the work still justifies it.
   - **Drop candidates** (≳150, or superseded): recommend closing, with the reason.

6. Cross-reference unlinked PRs against the open issue list by keyword on the issue titles, and split the finding two ways: *has a matching open issue but no link* (name the issue and your confidence) versus *no issue at all*. For finished, self-justifying work, recommend merging over retro-filing a ticket.

7. Detect stacks (PRs whose bodies say "stacked on" / "PR n/m", or that share a topic prefix) and report them in merge order with the blocking member called out. Check for the **close-ordering hazard**: when `Closes #X` sits on a PR that is not last in the stack, the issue auto-closes early — say so and propose moving the keyword.

8. Report open issues that have a branch but no PR, and branches ahead of main with no PR at all — unlanded work rots invisibly. Ignore branches with `ahead=0`.

9. Escalate anything that looks superseded: a merged PR or a commit on `main` that already did the job. Verify by grepping `origin/main` for the change rather than trusting the PR description.

Present the result as short tables grouped by tier, each row carrying the issue link and behind-count. Finish with a suggested order of work, highest value first, and offer to start on the top item. Correct any figures you previously reported and got wrong, explicitly.
