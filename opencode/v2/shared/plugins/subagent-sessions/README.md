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
- Refresh: session creation, rename, model selection, deletion, and status
  events

The event handlers update a host-owned `context.storage.memory()` revision and
remount the slot. Neither ordinary Solid signals nor the host-owned store
invalidated the already-mounted external slot in live testing, despite the
upstream `createComponent` lifecycle fix. Remounting remains necessary until
OpenCode fixes the remaining external Solid-runtime boundary.

Status event payloads are retained directly as well. The host session-status
cache can still contain `running` when the event announcing `idle` triggers the
remount, so rereading only that cache leaves completed subagents looking busy.
The one-second reconciliation also compares each child's cached status and
remounts when it changes. Fresh event status wins briefly so a lagging cache
cannot immediately undo it; afterward polling can recover either a missed
`running` transition or a missed `idle` transition.

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
