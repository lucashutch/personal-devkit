# Subagents

Always set `model`; use a model the user names.
- haiku: search, reading/summarizing code, PR diffs and comments, CI logs, changelogs, build/test pass-fail, mechanical edits. Return facts; judge in the main session.
- sonnet: well-specified implementation that a test or build verifies.
- opus: ambiguous reasoning, unclear debugging, reviews.
Send to haiku: commands likely to print >300 lines, and further exploration once context passes ~100k tokens.
Cost: haiku 1, sonnet 5, opus 8.
