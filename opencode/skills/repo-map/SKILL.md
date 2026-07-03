---
name: repo-map
description: Create or refresh repo-map.md, a compact orientation map of the repository used by planner and dev agents. Use before planning in a repo with no repo-map.md, or when the map is stale after structural changes.
---
# Repo map

Produce `repo-map.md` in the project root: a compact orientation map, not documentation.

## Gather
1. Structure: `git ls-files` (or glob) grouped by top-level directory; note the language(s), package/build files, and entry points.
2. Conventions: how tests are laid out, where config lives, any monorepo/workspace boundaries.
3. Commands: the repo's real build/test/lint commands from its manifests, Makefile, or CI config — verify against files, do not guess.

## Write `repo-map.md`
Keep it under ~60 lines. Shape:

```
# Repo Map
Purpose: [one line]
Stack: [languages, key frameworks]

## Layout
- `src/foo/` — [what lives here, one line each; only load-bearing dirs]

## Entry points
- `path` — [what it starts]

## Commands
- Build: `...`
- Test: `...`
- Lint: `...`

## Conventions & gotchas
- [only non-obvious ones worth a line]
```

## Rules
1. Skip generated, vendored, and node_modules-style directories.
2. Every line must save a future agent a search; delete anything derivable in one glob.
3. If a `repo-map.md` exists, update only the stale parts and keep it within the size budget.
