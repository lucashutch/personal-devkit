---
name: repo-map
description: Inspect and report a compact repository map without modifying files.
---
# Repo map

Report repository orientation in the response only. Read an existing `repo-map.md` for drift; never create, update, or delete files.

Inspect tracked paths or search the tree, excluding generated code, dependencies, and vendored files. Verify important paths, entry points, languages, manifests, test/config layout, and workspace boundaries. Verify build/test/lint commands from manifests, make files, or CI; never guess.

Keep the report under ~60 lines:
- `Verified: YYYY-MM-DD` using today's date.
- Purpose and stack.
- Layout: key directories and their roles.
- Entry points: paths and what they start.
- Commands: verified build, test, and lint commands; mark unavailable checks.
- Conventions and gotchas: non-obvious facts that save future searches.

Omit generic advice and obvious details.
