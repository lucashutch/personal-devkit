# Delegate model profiles

The default and test profiles enable `personal.delegate-profiles`. Configure
`fast`, `standard` (also accepted as `balanced`), `deep`, and `advisor` presets in each
profile's `opencode.json`. Each preset selects a model and optional reasoning
variant. The parent model's reasoning level does not determine that variant.

The default `advisor` preset uses `openai/gpt-6-astra` with `medium` reasoning.
Select it with `model_profile: "advisor"`. The test profile routes it to the
fake Astra capture model, without a reasoning variant, like its other presets.

The shared `advisor` skill guides read-only second opinions and reviews using
this tier while leaving implementation and final decisions with the primary agent.

Select `agent: "Advisor"` with `model_profile: "advisor"`. The role permits only
`read`, `glob`, and `grep`, and denies external-directory access and `.env*` reads.
Shell, edits, network tools, skills,
delegation, and Code Mode are denied by default. Supply short diffs and test
results in the request. Targeted lookups and a 250-word response are prompt
guidance, not hard step or token limits. The agent inherits model selection unless
the caller supplies a profile; its model is not pinned separately.

The plugin adds `model_profile` to the native subagent schema and wraps the
native Effect executor. It keeps the real Worker/Reviewer agent ID. At the
executor's awaited child-progress callback, it persists the selected model
before native prompt admission. No hidden alias agents are required.

Resuming with `sessionID` accepts an explicit profile matching the child's model
and reasoning level, or `inherit` to keep them without selecting a profile.
A different profile requires a new child. Native execution retains
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
