# Subagents

- Pick a model for each fresh subagent. Use a model the user names. Otherwise set `model` explicitly, because omitting it inherits the parent model. Use cheaper models for bounded work with clear checks. Use haiku for search, file listing, reading and summarizing code, and mechanical edits where a wrong result is easy to spot. Use opus for ambiguous reasoning, debugging with an unclear cause, and reviews.

Models (cost/code/reasoning/UI, relative 1-10):
- haiku 1/6/5/5
- sonnet 5/8/8/8
- opus 8/9/10/9
