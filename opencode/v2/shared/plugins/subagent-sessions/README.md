# Subagent sessions TUI plugin

## Purpose

Adds a `Subagents` section to the session sidebar. It lists direct child
sessions, shows their execution state and selected model, and navigates to a
child when clicked.

Rows use this format:

```text
Fast · Worker
gpt-5.6-luna · idle
```

The effort and role are recovered from generated agent IDs such as
`delegate-profile--fast--Worker`. The model comes from the child session's
`model` field; cached message metadata is a fallback.

## Configuration

- Plugin entry: `shared/cli.json` → `./shared/plugins/subagent-sessions/tui.tsx`
- Slot: `sidebar.content`
- Child lookup: `context.data.session.family(parentID)` plus cached sessions
- Refresh: `session.created`, `session.updated`, and `session.deleted` events

The loader intentionally does not await `session.sync()` or message syncs.
Those requests can remain pending for active children and would leave the UI
stuck on `Loading sessions…`; the host's live family/session cache is used
instead.

## Troubleshooting

- `Loading sessions…`: restart the active OpenCode service and confirm the
  plugin is loaded from `shared/cli.json`. The sidebar should settle without a
  network sync.
- `Subagents (0)`: verify the session is the parent session and that child
  sessions have `parentID` set. Check the host data API in
  `node_modules/@opencode-ai/plugin/dist/tui/context.d.ts` after upgrades.
- `Model unavailable`: inspect the child session's `model` field and confirm
  the profile plugin created the expected model-pinned alias.
