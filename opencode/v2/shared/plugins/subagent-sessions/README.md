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
- Child lookup: the TUI session cache plus session info retained from events,
  with a one-second server reconciliation filtered by `parentID`
- Refresh: `session.created`, `session.updated`, `session.deleted`, and
  `session.status` events

The event handlers explicitly request a renderer frame after changing reactive
state and remount the external slot. The remount is necessary because this
external plugin's Solid runtime is not the host's runtime: signal updates are
visible on the next mount but do not invalidate the existing host render tree.

V2's `data.session.list()` is a local cache and can lag behind a newly created
child. Session events include the complete session info, so the plugin retains
that payload and merges it with the cache. It also reconciles with the session
list endpoint once per second because the host does not always project child
session events into an already-mounted external slot.

## Troubleshooting

- `Loading sessions…`: restart the active OpenCode service and confirm the
  plugin is loaded from `shared/cli.json`. The sidebar should settle without a
  network sync.
- `Subagents (0)`: verify the session is the parent session and that child
  sessions have `parentID` set. Check the host data API in
  `node_modules/@opencode-ai/plugin/dist/tui/context.d.ts` after upgrades.
- `Model unavailable`: inspect the child session's `model` field and confirm
  the profile plugin created the expected model-pinned alias.
