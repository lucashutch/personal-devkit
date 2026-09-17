# Delegate model selection

The default and test profiles enable `personal.delegate-profiles`. Configure
`models` and optional role `defaults` in the plugin options in each profile's
`opencode.json`. The plugin exposes separate `model` and `effort` arguments on
the native subagent tool. Model aliases are `luna`, `sol`, `astra`, and `muse`;
efforts are always `low`, `medium`, and `high`.

Each model defines an explicit mapping for all three efforts. Several efforts
may map to the same native variant. A `null` mapping selects the model's default
settings without a named variant. Missing mappings are configuration errors.
The parent model's reasoning level does not determine an explicitly selected
child's variant.

```json
{
  "models": {
    "luna": {
      "model": "openai/gpt-5.6-luna",
      "efforts": { "low": "low", "medium": "medium", "high": "high" },
      "description": "Cost-conscious routine coding and tests.",
      "scores": { "coding": 7, "complex": 6, "visual": 6 }
    }
  }
}
```

The default configuration maps Luna, Sol, Astra, and Muse directly to native
`low`/`medium`/`high`. These mappings are editable independently of tool inputs.
The test profile maps all efforts to `null` on local fake models.

The tool description contains a task-fit matrix generated from `scores`.
Scores are subjective initial routing estimates out of 10, not measured
benchmarks or guarantees. They describe a medium-effort baseline. Cost and
latency are not capability scores; the descriptions supply qualitative selection
guidance. Update scores from repository task results rather than treating small
differences as established facts. Missing scores mean unrated, not incapable.
The columns cover routine `coding`, `complex` engineering, `debugging`, defect
`review`, `research`, `long_tasks`, and `visual`/document work.

The default role mapping selects Astra at medium effort for a new Advisor child.
Explicit model selection overrides that default. Other roles retain native
agent/parent inheritance when no model is supplied. An explicit model without
effort uses medium.

The shared `advisor` skill guides read-only second opinions and reviews using
this model choice while leaving implementation and final decisions with the primary agent.

Select `agent: "Advisor"` with `model: "astra"` and `effort: "medium"`. The role permits only
`read`, `glob`, and `grep`, and denies external-directory access and `.env*` reads.
Shell, edits, network tools, skills,
delegation, and Code Mode are denied by default. Supply short diffs and test
results in the request. Targeted lookups and a 250-word response are prompt
guidance, not hard step or token limits. Model selection never changes the role's
permissions or prompt.

The plugin adds `model` and `effort` to the native subagent schema and wraps the
native Effect executor. It keeps the real Worker/Reviewer agent ID. At the
executor's awaited child-progress callback, it persists the selected model
before native prompt admission. No hidden alias agents are required.

Resuming with `sessionID` and omitted model/effort preserves the child's settings.
Explicit selections must resolve to the same model and native variant. Effort
alone cannot select a resumed model. Different settings require a new child.
Native execution retains
permission checks, foreground/background jobs, cancellation, and notifications.
Invocation-local state and child locks prevent overlapping wrapper calls from
switching each other's models.

## Validation and compatibility

<The model/effort interface was validated against CLI beta-19242 using an isolated
standalone process and loopback fake provider. Captures confirmed the five-alias
schema, Sol selection with `high` mapped to `null`, the Worker prompt, retained
read-only child permissions, and the child's response reaching the parent.
No live model request was made. The default profile's five model references and
15 effort mappings were also checked against the live catalog.
The capture check was repeated with global configuration and the installed
`extensions/` layout, including schema compaction. Shared-server plugin status
confirmed activation after migration and restart.

The previous preset interface was verified for new-child foreground and
background routing against CLI beta-19135 with SDK beta-19129 using a loopback
fake provider. Captures confirmed the
selected child model, Worker prompt, and read permission. Unit tests cover
variant selection, resume policy, concurrent calls, cancellation cleanup, and
native result/error forwarding:

```sh
node --test opencode/plugins/delegate-profiles.test.mjs
```

That earlier local capture harness also verified an Astra parent sending `low` reasoning
while Luna children sent `xhigh` and `medium`. After each standalone process
exited, a fresh process resumed the same child with `inherit`. SQLite records
and provider requests retained the Worker role, model, and reasoning variant,
without creating another session.

The awaited progress-before-prompt ordering is release-specific. Revalidate it
after CLI upgrades. Unit tests are not substitutes for these integration checks.

Installed plugins live under `extensions/`, not the auto-discovered `plugins/`
directory. This prevents an optionless duplicate load and preserves explicit
configuration order. Sources remain under repository `opencode/plugins/`.
When migrating an existing installation, remove an old global `plugins` symlink
only after confirming it points to this repository and installing the replacement
`extensions` link. The linker does not prune obsolete links automatically.

Keep this plugin after `slim-tools` so its schema guidance survives compaction.
Restart the relevant service to load server-plugin changes. The linker installs the
SDK on its `latest` channel plus its declared peers; it does not guarantee a
matching CLI build. No live provider call is required for the deterministic checks.
