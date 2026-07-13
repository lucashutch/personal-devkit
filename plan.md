# Task Implementation Plan
Objective: Add a V1 `delegate` custom tool that closely follows built-in task UX while safely creating or resuming subagent sessions with configurable strength presets.

Planning Notes: Keep all work additive under the in-progress V1 shared tree so existing migration edits remain untouched. Use a top-level plugin entry for OpenCode discovery and a dedicated sidecar directory for configuration, tests, and documentation; register only `delegate`, never `task`. The Director owns amending Phase 7 into delegate feature commit `7e0a885` via safe history rewrite and force-push-with-lease; this plan performs no git operations and preserves all other files.

## Affected Files
- `opencode/v1/shared/plugins/delegate.ts`
- `opencode/v1/shared/plugins/delegate/settings.json`
- `opencode/v1/shared/plugins/delegate/delegate.test.ts`
- `opencode/v1/shared/plugins/delegate/README.md`

## Phases
### Phase 1: Configuration contract and behavioral coverage (standalone)
- Files: `opencode/v1/shared/plugins/delegate/settings.json`, `opencode/v1/shared/plugins/delegate/delegate.test.ts`
- [ ] Define `fast/simple`, `standard`, and `deep` presets using whitelisted `openai/gpt-5.4-mini`, `openai/gpt-5.5`, and `openai/gpt-5.6-sol` models plus supported thinking variants; reserve `inherit` for the caller's cached model and variant.
- [ ] Add focused tests for valid/default strength resolution, malformed or missing settings, unknown presets, and an isolated runtime compatibility adapter that adds `variant` without spreading untyped access through the plugin.
- [ ] Cover create versus `task_id` resume behavior, agent forwarding/selection, parent model fallback/cache behavior, abort propagation, progress metadata, and normalized API errors with mocked V1 client calls.
- Testing: `python3 -m json.tool opencode/v1/shared/plugins/delegate/settings.json >/dev/null`

### Phase 2: Delegate plugin implementation (depends: Phase 1)
- Files: `opencode/v1/shared/plugins/delegate.ts`
- [ ] Register a plugin tool named `delegate` with task-like description and arguments (`description`, `prompt`, `subagent_type`, optional `task_id`) plus required `strength` enum (`fast/simple`, `standard`, `deep`, `inherit`), without overriding the built-in `task` definition.
- [ ] Parse the sidecar settings defensively at plugin startup, validate exact provider/model and variant strings, reject unsafe/ambiguous configuration with actionable errors, and resolve preset or inherited model data deterministically.
- [ ] Cache parent model and variant by session/message from `chat.message`, keeping the typed-API exception for prompt `variant` in one documented compatibility cast and handling absent cache data explicitly.
- [ ] Implement new child session creation and existing-session resume through the public V1 client, forward selected subagent identity, explain/accept the public `session.create` permission limitation, and preserve stable `task_id` semantics in tool results.
- [ ] Wire execution abort signals, task-like metadata/status updates, concise progress reporting, final response extraction, and useful cancellation/API failure results for both create and resume paths.
- Testing: `bun test opencode/v1/shared/plugins/delegate/delegate.test.ts`

### Phase 3: Usage documentation and integrated validation (depends: Phase 2)
- Files: `opencode/v1/shared/plugins/delegate/README.md`
- [ ] Document installation/discovery, restart requirements, arguments and task-like examples, strength-to-model configuration, agent selection, resume via returned `task_id`, inheritance behavior, and cancellation/progress behavior.
- [ ] State compatibility boundaries: variant uses a localized runtime-supported cast, inherited values depend on `chat.message` cache, and custom children cannot exactly reproduce built-in child permissions through public `session.create`.
- [ ] Document settings validation/recovery and a manual smoke test that creates a delegated task, observes metadata, resumes it, checks inherit, and confirms built-in `task` remains available.
- [ ] Verify the final diff adds only the owned delegate files and does not alter the repository's existing V1/V2 migration work.
- Testing: `python3 -m json.tool opencode/v1/shared/plugins/delegate/settings.json >/dev/null && bun test opencode/v1/shared/plugins/delegate/delegate.test.ts && git diff --check`

### Phase 4: V1 runtime loading follow-up (depends: Phase 3)
- Files: `opencode/v1/shared/plugins/delegate.ts`, `opencode/v1/shared/plugins/delegate/delegate.test.ts`
- [ ] Remove the runtime `@opencode-ai/plugin` package load from `delegate.ts`: retain erased type-only imports, and source the schema/tool helper from the V1 runtime helper available to discovered plugins, matching the other V1 plugins' no-runtime-package-import convention.
- [ ] Add focused registration coverage that exercises plugin construction and asserts the returned tool map contains `delegate`, while retaining the existing typed executor and localized prompt-variant compatibility boundary.
- [ ] Run the delegate unit suite, then start `context-proxy-forward`, invoke OpenCode with the isolated V1 test XDG profile and capture provider, and assert the newest raw request advertises a tool named `delegate`.
- [ ] Inspect `git diff --check` and `git status --short` to ensure the fix touches only the delegate files and preserves all in-progress V1/V2 migration changes.
- Testing: `bun test opencode/v1/shared/plugins/delegate/delegate.test.ts && (cd /home/lucas/9999-personal/context-proxy-forward && uv run python context_proxy_forward.py --host 127.0.0.1 --port 1234 > /tmp/context-proxy-forward.log 2>&1 & echo $! > /tmp/context-proxy-forward.pid) && trap 'kill "$(cat /tmp/context-proxy-forward.pid)" 2>/dev/null || true' EXIT && XDG_CONFIG_HOME="$HOME/.config/opencode-v1-test" XDG_DATA_HOME="$HOME/.local/share/opencode-v1-test" OPENCODE_EXPERIMENTAL_WEBSOCKETS=true opencode run --model prompt-capture-openai/gpt-5.4-mini "Reply with OK without calling tools" || test $? -eq 1; capture=$(find /home/lucas/9999-personal/context-proxy-forward/proxy-captures -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-); jq -e 'any(.tools[]?; (.function.name // .name) == "delegate")' "$capture/request.raw.json" && git diff --check && git status --short`

### Phase 5: DeepSWE-informed preset update (depends: Phase 4)
- Files: `opencode/v1/shared/plugins/delegate.ts`, `opencode/v1/shared/plugins/delegate/settings.json`, `opencode/v1/shared/plugins/delegate/delegate.test.ts`, `opencode/v1/shared/plugins/delegate/README.md`
- [ ] Update the parser allowlist and sidecar settings so `fast/simple` remains `openai/gpt-5.4-mini` with `low`, `standard` becomes `openai/gpt-5.6-terra` with `high`, and `deep` remains `openai/gpt-5.6-sol` but uses `medium`.
- [ ] Adjust preset-resolution and prompt-forwarding tests to assert the exact new model/variant combinations while retaining malformed-settings and non-whitelisted-value coverage.
- [ ] Update the README preset table and rationale: DeepSWE has no comparable current evidence for the fast preset; v1.1 reports terra medium at 35.1%/$0.58 versus terra high at 53.8%/$1.13, and sol medium at 61.1%/$1.86 as a strong quality/cost point.
- [ ] Validate JSON, focused behavior, and diff hygiene without altering the existing migration changes.
- Testing: `python3 -m json.tool opencode/v1/shared/plugins/delegate/settings.json >/dev/null && bun test opencode/v1/shared/plugins/delegate/delegate.test.ts && git diff --check`

### Phase 6: Final benchmark-informed delegate presets (depends: Phase 5)
- Files: `opencode/v1/shared/plugins/delegate.ts`, `opencode/v1/shared/plugins/delegate/settings.json`, `opencode/v1/shared/plugins/delegate/delegate.test.ts`, `opencode/v1/shared/plugins/delegate/README.md`
- [ ] Update the implementation allowlist and sidecar to the final exact mappings: `fast/simple` = `openai/gpt-5.6-luna`/`low`, `standard` = `openai/gpt-5.6-terra`/`high`, and `deep` = `openai/gpt-5.6-sol`/`high`.
- [ ] Adjust preset-resolution, forwarding, and rejected-configuration expectations to cover the final whitelisted model/variant combinations.
- [ ] Revise the README preset table and benchmark rationale to explain the final speed, standard-quality, and deep-quality choices without changing delegate behavior or migration work.
- Testing: `python3 -m json.tool opencode/v1/shared/plugins/delegate/settings.json >/dev/null && bun test opencode/v1/shared/plugins/delegate/delegate.test.ts && git diff --check`

### Phase 7: Optional model profile contract rename (depends: Phase 6)
- Files: `opencode/v1/shared/plugins/delegate.ts`, `opencode/v1/shared/plugins/delegate/settings.json`, `opencode/v1/shared/plugins/delegate/delegate.test.ts`, `opencode/v1/shared/plugins/delegate/README.md`
- [ ] Rename the public `strength` argument and internal resolution terminology to optional `model_profile`, with the exact enum `fast`, `standard`, `deep`, and `inherit`; resolve an omitted value through the same cached-parent path and errors as explicit `inherit`, never through `defaultStrength`.
- [ ] Rename the `fast/simple` preset/settings key to `fast`, remove obsolete default-selection configuration if no longer used, and retain the current exact Luna/Terra/Sol model and variant mappings and strict validation.
- [ ] Update unit coverage for explicit profiles, omission-as-inherit, missing inherited context, forwarding/resume behavior, registration schema optionality, and schema/context-token expectations; assert neither legacy `strength` nor `fast/simple` remains in the public contract.
- [ ] Update README argument tables, examples, preset/inheritance behavior, validation guidance, compatibility notes, and smoke tests to match the optional `model_profile` contract.
- Testing: `python3 -m json.tool opencode/v1/shared/plugins/delegate/settings.json >/dev/null && bun test opencode/v1/shared/plugins/delegate/delegate.test.ts`; then repeat the isolated V1 capture flow from Phase 4 and run `jq -e '.tools[]? | select((.function.name // .name) == "delegate") | (.function.parameters // .parameters) as $schema | (($schema.properties.model_profile.enum == ["fast","standard","deep","inherit"]) and (($schema.required // []) | index("model_profile") | not) and ($schema.properties | has("strength") | not))' "$capture/request.raw.json"`

### Phase 8: Dynamic subagent discovery in tool description (depends: Phase 7)
- Files: `opencode/v1/shared/plugins/delegate.ts`, `opencode/v1/shared/plugins/delegate/delegate.test.ts`, `opencode/v1/shared/plugins/delegate/README.md`
- [ ] Load agents at plugin initialization through the public V1 `client.app.agents()` API, normalize its API result, and build a concise task-like `delegate` description from agent names and short descriptions without hard-coded agent identities.
- [ ] Advertise only agents whose API mode is `subagent` or `all`; apply any additional disabled/unavailable signal exposed by the runtime response, and define a stable generic-description fallback when lookup fails, returns no usable agents, or contains malformed entries.
- [ ] Add focused Bun coverage for filtering, dynamic description formatting, API errors/empty data, and registration fallback while leaving the `model_profile` schema, inheritance, resolution, and prompt forwarding unchanged.
- [ ] Document runtime discovery/filtering, startup-time description generation, fallback behavior, and the restart/live-capture verification procedure.
- Testing: `bun test opencode/v1/shared/plugins/delegate/delegate.test.ts`; then start `context-proxy-forward`, invoke OpenCode with the isolated V1 test XDG profile and capture provider as in Phase 4, and run `jq -e --arg agent '<configured-subagent-name>' '.tools[]? | select((.function.name // .name) == "delegate") | (.function.description // .description) | contains($agent)' "$capture/request.raw.json"`

## Status
- Phase 1: done — presets and contract tests added; JSON/diff checks passed before implementation
- Phase 2: done — delegate plugin implemented; 7 Bun tests passed
- Phase 3: done — usage/caveats documented; integrated validation passed
- Review fixes: done — V1 result handling, typed ToolResult, inheritance freshness, resume ownership, tests/docs corrected; 10 tests passed
- Phase 4: done — removed unavailable runtime package import; 11 tests pass and live capture advertises `delegate`
- Phase 5: pending
- Phase 6: done — final Luna low / Terra high / Sol high presets implemented; 11 tests pass
- Phase 7: done — renamed to optional `model_profile`; omission inherits; 12 tests pass
- Phase 8: complete — delegate dynamically advertises usable subagents with graceful fallback; 15 tests pass
