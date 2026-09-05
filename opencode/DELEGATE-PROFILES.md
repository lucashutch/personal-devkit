# Delegate model profiles

The default and test profiles enable `personal.delegate-profiles`. Configure
`fast`, `standard` (also accepted as `balanced`), and `deep` presets in each
profile's `opencode.json`. Each preset selects a model and optional reasoning
variant. The parent model's reasoning level does not determine that variant.

The plugin adds `model_profile` to the native subagent schema and wraps the
native Effect executor. It keeps the real Worker/Reviewer agent ID. At the
executor's awaited child-progress callback, it persists the selected model
before native prompt admission. No hidden alias agents are required.

Use `inherit` with `sessionID` when resuming. This preserves the child's model
and reasoning level. A matching explicit profile is accepted without changing
the model; a different profile requires a new child. Native execution retains
permission checks, foreground/background jobs, cancellation, and notifications.
Invocation-local state and child locks prevent overlapping wrapper calls from
switching each other's models.

## Validation and compatibility

Verified new-child foreground and background routing against CLI beta-19135
with SDK beta-19129 using a loopback fake provider. Captures confirmed the
selected child model, Worker prompt, and read permission. Unit tests cover
variant selection, resume policy, concurrent calls, cancellation cleanup, and
native result/error forwarding:

```sh
node --test opencode/plugins/delegate-profiles.test.mjs
```

The local capture harness also verified an Astra parent sending `low` reasoning
while Luna children sent `xhigh` and `medium`. After each standalone process
exited, a fresh process resumed the same child with `inherit`. SQLite records
and provider requests retained the Worker role, model, and reasoning variant,
without creating another session. Evidence is saved under
`/tmp/opencode/agentic-reasoning-evidence.json` on the validation machine.

The awaited progress-before-prompt ordering is release-specific. Revalidate it
after CLI upgrades. Unit tests are not substitutes for these integration checks.

Keep this plugin after `slim-tools` so its schema guidance survives compaction.
Restart the relevant service to load server-plugin changes. The linker installs
a floating SDK beta and its declared peers; it does not guarantee a matching
CLI build. No live provider call is required for the deterministic checks.
