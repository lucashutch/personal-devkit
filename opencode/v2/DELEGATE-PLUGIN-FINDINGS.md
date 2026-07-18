# V2 delegate model-profile findings

## Decision

Do **not** port the V1 `delegate` plugin to V2 yet. The desired feature is a
replacement for the native `task` tool that accepts `fast`, `standard`, or
`deep`, then starts/resumes a child session on the chosen model. The V2 public
plugin API does not expose the two capabilities needed to implement that
replacement:

1. replacing the native `task` tool; and
2. launching a subagent child session with an explicitly selected model.

This was assessed against `@opencode-ai/cli@0.0.0-next-15788` on 2026-07-18.
V2 is beta software; repeat the checks below after upgrading.

## V1 implementation being preserved

[`../v1/shared/plugins/delegate.ts`](../v1/shared/plugins/delegate.ts)
registers a plugin tool named `task`, which shadows the V1 built-in tool. It
then uses the V1 client API to create or resume a child session and prompt it
with a selected provider/model plus variant. Its `model_profile` argument is
one of `fast`, `standard`, `deep`, or `inherit`; preset definitions live in
[`../v1/shared/plugins/delegate/settings.json`](../v1/shared/plugins/delegate/settings.json).

That implementation is intentionally V1-only. Do not copy it into the V2
plugin directory: its plugin factory, client API, tool registration semantics,
and prompt model/variant request shape are V1-specific.

## V2 findings

### Native task tool

V2 owns the native `task`/subagent tool internally. Its public task input has
`description`, `prompt`, `subagent_type`, and optional continuation/background
fields. It has no `model_profile`, `model`, `providerID`, or `modelID` input.

### Server plugins

V2 server plugins can register additional custom tools and session hooks. A
custom tool gets an execution context (session/message IDs, agent, working
directory, abort signal, metadata, and question support), but no public
subagent-launch client. In particular, it cannot create and prompt a child
session with a per-call model selection.

The `tool.execute.before` and `tool.execute.after` hooks can inspect the native
tool invocation and alter its arguments or displayed result. They do not
provide a result replacement, a cancellation/takeover mechanism, or a model
selection parameter for native `task`.

Custom-tool registration is not a supported native-tool override mechanism in
V2. Registering a second tool named `task` must therefore not be relied on as
the V1-style shadowing technique: even if a preview happens to accept a name
collision, it is unsupported and does not give the replacement tool a native
subagent executor.

### Conclusion

A V2 plugin can expose a *separate* tool with a `fast|standard|deep` argument,
but cannot implement its action through supported APIs. Model-pinned agent
aliases are possible through configuration, but are deliberately not added as
a replacement because they make model choice leak into agent names and do not
meet the requested tool-level interface.

## What must land upstream

Any one of these API designs would unblock a supported V2 implementation:

1. **Task override registration:** allow a plugin to explicitly replace the
   native `task` executor while retaining the native task renderer and
   permission behavior.
2. **Child-session API:** expose a plugin-context method to create/resume and
   prompt a child session, accepting `{ providerID, modelID }` (and any V2
   reasoning/variant equivalent).
3. **Native task model parameter:** add an optional validated model/profile
   argument to the native task schema and pass it to the child-session prompt.
4. **Task execution interception:** let `tool.execute.before` replace/short-
   circuit native execution with a typed tool result. This still needs a
   supported child-session launch API or native model-selection argument.

The first or third option gives the best user experience because the existing
native subagent UI and permission boundary remain authoritative.

## Revalidation checklist for a future V2 release

1. Record `opencode2 --version` in `README.md`.
2. Read the release-matched plugin declarations and documentation for custom
   tool registration, `tool.execute.before`, and `tool.execute.after`.
3. Inspect the release-matched native `task` schema for a model/profile field.
4. In the isolated `v2/test` XDG profile, register a no-op custom `task` tool
   and verify whether it is rejected, coexists, or replaces the native tool.
   Do not perform this test in a home/work profile.
5. If a replacement is accepted, verify that a custom executor can safely
   create a parent-owned child session, prompt it on an explicit model, resume
   it, propagate cancellation, and preserve native task permission and UI
   metadata behavior.
6. Only after all checks pass, port the V1 settings parser and add capture-
   proxy/integration tests before enabling the plugin in a profile.

## References

- V1 implementation: [`../v1/shared/plugins/delegate.ts`](../v1/shared/plugins/delegate.ts)
- OpenCode custom-tools documentation: <https://opencode.ai/docs/custom-tools/>
- Current upstream plugin API source: <https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts>
- Current upstream native task implementation: <https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts>

The upstream links are useful for discovery, but a future port must validate
against the exact installed preview release rather than assuming `dev` matches
it.
