# Delegate tool (OpenCode V1)

The delegate plugin runs a selected subagent in a child session, reports task-like progress, and returns the child session ID so later calls can continue the same work.

## Why the tool is named `task`

Although this plugin is called "delegate", it registers its tool under the name **`task`**, wholesale replacing OpenCode's built-in task tool. There is only one task tool at runtime, and it is this plugin. The name matters because the TUI's rich task rendering — the model chip and click-through into the child session — is hard-registered in the OpenCode binary to the tool *name* `task` and keyed on the `sessionId`/`parentSessionId`/`model` metadata this plugin emits. Renaming the tool back to `delegate` would silently downgrade it to the generic tool renderer.

Consequences of the shared name:

- Anything that refers to the tool (agent permissions, prompts, configs) must use `task`, not `delegate`.
- Do **not** set `tools: { "task": false }` in `opencode.json` to disable the built-in — tool filtering is by name and removes this plugin's tool too. No disable is needed; the name collision alone replaces the built-in.
- You can tell the delegate implementation is active by its extra arguments (`model_profile`, `task_id`) and the "Resumable task ID" line in outputs; the built-in has neither.

Host-side integrations still apply to the shared name: the host appends the live agent list to the description of any tool named `task`, and the `slim-tools` plugin's description override for `task` applies to this tool.

## Restricting which agents can delegate

The V1 UI renders only one level of parent→child sessions, so subagents spawning their own subagents produces invisible grandchildren. The repo profiles therefore set `"task": "deny"` in the global `permission` block of each profile `opencode.json`, and opt the General primary agent back in via frontmatter. Denied agents lose the tool from their tool list entirely, and the host also omits them from the auto-generated description. New subagents inherit the deny by default with nothing to remember.

## Discovery and restart

The discoverable plugin entry is `plugins/delegate.ts`; this directory is its sidecar for settings, tests, and documentation. In this repository, run the normal linker with OpenCode enabled so `opencode/v1/shared/plugins` is linked into each selected V1 profile's configuration directory (for example, `~/.config/opencode-v1-home/opencode/plugins`). Do not copy or edit the linked target directly.

OpenCode loads plugins and their settings at startup. Completely quit and restart the relevant V1 OpenCode profile after linking the plugin or changing the profile's `delegate_config.json`. The tool then appears as `task` (the plugin registration replaces the built-in tool of the same name).

At startup, the plugin calls the public V1 `client.app.agents()` API and appends the currently configured usable agents to the tool description. Only entries with mode `subagent` or `all` are advertised; primary-only agents, malformed entries, and entries explicitly marked disabled, unavailable, or not enabled are omitted. Names are accompanied by whitespace-normalized short descriptions when available. If discovery fails or produces no usable agents, registration still succeeds with the stable generic description; restart after agent configuration changes to regenerate it.

## Arguments

Every new call supplies:

| Argument | Required | Meaning |
| --- | --- | --- |
| `description` | yes | Short title shown in task metadata. |
| `prompt` | yes | Complete instructions sent to the subagent. Include all context needed to work independently. |
| `subagent_type` | yes | Name of the agent that receives the prompt, such as `Worker`, `WebResearcher`, or `Reviewer`. The named agent must exist and be usable in the active profile. |
| `model_profile` | yes | One of `fast`, `balanced`, `deep`, or `inherit`. |
| `task_id` | no | A previously returned delegated session ID. Supplying it resumes that session instead of creating a child. |

Example new task:

```json
{
  "description": "Inspect parser edge cases",
  "prompt": "Review the parser and report concrete malformed-input cases. Do not edit files.",
  "subagent_type": "Reviewer",
  "model_profile": "fast"
}
```

The result metadata includes `status` and `task_id`; `output` also prints the resumable task ID before the subagent text so the model can retain it. Keep that ID to continue the task:

```json
{
  "description": "Check one more parser case",
  "prompt": "Continue the prior investigation and check nested arrays.",
  "subagent_type": "Reviewer",
  "model_profile": "balanced",
  "task_id": "<task_id from the first result>"
}
```

On resume, `delegate` does not create another session. The new prompt, selected agent, and selected model profile are applied to the existing session; use an agent appropriate for that continuation.

## Model profiles and inheritance

Each profile owns a `delegate_config.json` beside its `opencode.json`. The linker installs it at the active configuration root, and the plugin reads `$XDG_CONFIG_HOME/opencode/delegate_config.json`; no profile names or provider choices are hard-coded in the plugin. Edit the relevant profile file and restart that profile. Each of `fast`, `balanced`, and `deep` takes any well-formed `provider/model` pair and a non-empty variant string; the parser validates shape only, not specific models. Every delegation must select a model profile explicitly, including `inherit` when matching the parent is intentional.

The intended routing is:

- `fast`: the starting point, and enough for bounded lookup, extraction, or mechanical work.
- `balanced`: work that needs judgement or spans several files.
- `deep`: ambiguous, high-stakes, or multi-step reasoning where quality outweighs latency and cost.
- `inherit`: deliberately match the parent model and reasoning level.

Task length alone does not require `deep`: large but mechanical work may still fit `fast` or `balanced`.

`inherit` uses the parent request's model **and variant**, rather than a preset. The plugin observes `chat.message` events and caches these values by message, with a session-level fallback. A newer event missing either value clears the relevant cache rather than reusing stale settings. Consequently, inheritance works only after the running plugin has observed a parent message carrying both values. If no cached value exists (commonly immediately after a restart or for an older session), the call returns an actionable `Cannot inherit` error; send a new parent message or choose an explicit preset.

OpenCode V1 runtimes accept a top-level prompt `variant`, but older public SDK typings do not declare it. The implementation isolates that compatibility difference in one runtime-supported cast; all other client request construction remains typed.

## Progress, cancellation, and errors

For a new task, metadata progresses from `starting` to `running` and then `completed`, and includes the stable `task_id` (plus `sessionId`, `parentSessionId`, `model`, and `variant`) as soon as the child exists. A resumed task starts with the supplied ID. The final `ToolResult.metadata` replaces the progress metadata in the stored part state, so it carries the same keys.

Known host limitation: the V1 host drops plugin `context.metadata()` updates while the tool is executing (verified against the persisted part state — `state.metadata` stays null until the tool returns). Click-through into the child session therefore works only once the delegation completes, errors, or is cancelled; use `ctrl+x` navigation to inspect a delegation that is still running. Fixing this requires an upstream change; the plugin already emits the right keys.

Cancelling the parent tool call propagates its abort signal to child creation and prompting. The result and metadata become `cancelled`; if cancellation happened after creation, retain the returned `task_id` for a possible later resume. API failures become `error` results with normalized status/message text and preserve any known `task_id`.

The active profile's settings are validated when the plugin starts. A missing `delegate_config.json` fails registration with a message pointing at `scripts/link-config.py` — link the profile and restart. Malformed preset objects, a model that is not an unambiguous `provider/model` pair, or an empty variant causes plugin registration to fail with a `delegate ...` error naming the bad field. Recover by fixing the named preset, validating the JSON, and restarting OpenCode:

```sh
for file in opencode/v1/{home,work,test}/delegate_config.json; do
  python3 -m json.tool "$file" >/dev/null
done
```

## Compatibility and permission boundaries

- This is a V1 plugin using the public V1 client and the runtime-supported prompt `variant` compatibility adapter described above. A runtime that does not support that field is not compatible with model-profile variants.
- `inherit` depends on the in-memory `chat.message` cache; it is not reconstructed from session history and does not survive a plugin restart.
- New children are created through public `session.create`, which can set `parentID` but cannot reproduce the built-in `task` tool's private child permission overrides. The selected subagent and the active OpenCode configuration therefore determine effective permissions. Review agent permissions before delegating sensitive or mutating work.
- Resume IDs are sensitive capabilities. The plugin uses public `session.get` to verify that a supplied ID belongs to the current parent session and rejects mismatches; do not disclose or reuse IDs outside that parent context.
- The plugin replaces the built-in `task` tool entirely (see "Why the tool is named `task`"). If exact built-in child-session permission behavior is required, unlink this plugin from the profile.

## Manual smoke test

After linking and restarting a V1 profile:

1. Confirm the tool list contains exactly one `task` tool and that its schema includes `model_profile` and `task_id` (proving the plugin replaced the built-in).
2. Run the new-task example above from a primary agent. Confirm completion returns text and a `task_id`, the completed item shows the selected model, and clicking it opens the child session.
3. Run the resume example with that ID. Confirm it reuses the same ID and continues the prior context.
4. From a fresh parent message, delegate a small task with `model_profile: "inherit"`; confirm it uses the parent's model and variant. Restarting first should instead demonstrate the documented missing-cache error until a new parent message is observed.
5. Start a longer delegation and cancel it. Confirm the visible/result status becomes `cancelled` and that a child ID is retained if creation had completed.
6. Delegate to a subagent and ask it to list its tools; confirm `task` is absent (global permission deny) while the primary agent retains it (frontmatter allow).

To verify the tool and description on the wire, start `context-proxy-forward`, invoke OpenCode with the isolated V1 test XDG profile and capture provider, then inspect the newest capture (replace the argument with a configured subagent name):

```sh
jq -e --arg agent '<configured-subagent-name>' '.tools[]? | select((.function.name // .name) == "task") | (.function.description // .description) | contains($agent)' "$capture/request.raw.json"
```
