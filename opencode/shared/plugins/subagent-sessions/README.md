# Subagent sessions TUI plugin

## Purpose

Adds a `Subagents` section to the session sidebar. It lists direct child
sessions, shows their task title, execution state, role/profile, selected model,
and latest-call token sum, and navigates to a child when clicked.

Rows use this format:

```text
Investigate failing build
Worker · Fast · gpt-5.6-luna · idle · last call 87.9K tok
```

The effort and role are recovered from concise generated agent IDs such as
`Fast-Worker`. Legacy `delegate-profile--fast--Worker` sessions remain
supported. The model comes from the child session's
`model` field; cached message metadata is a fallback. Token usage is the sum
reported on the latest assistant message. It is not a context-window percentage.

## Configuration

- Plugin entry: `cli.json` -> `./shared/plugins/subagent-sessions`
- Slot: `sidebar.content`
- Child lookup: the TUI session cache plus session info retained from events,
  with a one-second server reconciliation filtered by `parentID`
- Refresh: session creation, rename, model selection, deletion, and status
  events

V2 plugin dependencies intentionally track the current `next` channel. Do not
add a lockfile or pin preview builds; run `pdklink --opencode`
after upgrading `opencode2`, which reinstalls the tree at the host's peer
versions.

The event handlers update a plugin-local Solid signal and then call
`context.renderer.requestRender()`. They previously remounted the slot instead,
which discarded sidebar scroll position and the component's known-child set on
every event; a repaint request is sufficient because the component's revision
effect already rebuilds the list.

Status event payloads are retained directly as well. The host session-status
cache can still contain `running` when the event announcing `idle` triggers a
refresh, so rereading only that cache leaves completed subagents looking busy.
The one-second reconciliation also compares each child's cached status and
refreshes when it changes. Retry status is displayed separately from idle.

V2's `data.session.list()` is a local cache and can lag behind a newly created
child. Session events include the complete session info, so the plugin retains
that payload and merges it with the cache. It also reconciles with the session
list endpoint once per second because the host does not always project child
session events into an already-mounted external slot.

## Troubleshooting

- `Loading sessions…`: restart the active OpenCode service and confirm the
  plugin is loaded from `cli.json`. The sidebar should settle without a
  network sync.
- `Subagents (0)`: verify the session is the parent session and that child
  sessions have `parentID` set. Check the host data API in
  `node_modules/@opencode-ai/plugin/dist/tui/context.d.ts` after upgrades.
- `Model unavailable`: inspect the child session's `model` field and confirm
  the profile plugin created the expected model-pinned alias.
