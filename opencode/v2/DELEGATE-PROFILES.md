# V2 delegate model profiles

## Status

`personal.delegate-profiles` is enabled for the V2 home, work, and test
profiles on `@opencode-ai/cli@0.0.0-next-15788`. It adds a required
`model_profile` argument to the native `subagent` tool while retaining the
native child-session executor.

The supported profiles are `fast`, `standard`, `deep`, and `inherit`.
`standard` uses the model stored as `balanced` in the shared V1 settings file;
the naming adapter keeps the V2 tool vocabulary stable without changing the V1
tool interface.

## Model settings

The model presets have one source of truth:

[`../v1/shared/plugins/delegate/settings.json`](../v1/shared/plugins/delegate/settings.json)

V2 reaches that file through the repository symlink at
[`shared/plugins/delegate/settings.json`](shared/plugins/delegate/settings.json).
Do not replace the link with a copied file. A model or variant update should
therefore affect both plugin generations after their services restart.

Profile configs may override only the provider while retaining the shared
model IDs and variants:

- home uses the settings file's `openai` provider;
- work overrides it with `github-copilot`; and
- test overrides it with `prompt-capture-openai` and disables variants because
  the synthetic capture models do not declare them.

## How it works

The implementation is
[`shared/plugins/delegate-profiles.js`](shared/plugins/delegate-profiles.js).
It deliberately adapts the native tool instead of registering a replacement:

1. The `session.context` hook modifies the provider-facing native `subagent`
   schema. It adds required `model_profile`, constrains `agent` to visible
   configured subagent roles, and explains that profiles are not agent names.
2. The `tool.execute.before` hook removes `model_profile` before native input
   decoding.
3. For `fast`, `standard`, or `deep`, the hook lazily clones the selected agent
   into a hidden alias and pins that alias to the selected V2 model reference
   `{ providerID, id, variant? }`.
4. The native executor receives the hidden alias. It still owns permission
   checks, child creation, foreground/background jobs, cancellation, result
   injection, and TUI session metadata.
5. `inherit` removes the extra argument and passes the original agent through,
   allowing the native `agent.model ?? parent.model` behavior to decide.

The alias is created during execution rather than plugin setup because external
plugins load before OpenCode's config-agent post phase. At execution time the
configured source agent is available, so its prompt, permissions, mode, request
options, and other fields can be cloned safely. Aliases are cached for the
plugin generation and disposed when it unloads.

`delegate-profiles` must be listed after `slim-tools` in profile configuration.
Both mutate the provider-facing tool definition; running delegate last ensures
its profile guidance and dynamic agent-role enum are not replaced by the slim
description.

## Beta dependencies

This implementation relies on behavior present in V2 release `next-15788`:

- the native tool is named `subagent`;
- the session hook runtime name is `context` even though older public docs used
  `request`;
- the context hook may mutate tool descriptions and JSON schemas;
- `tool.execute.before` may replace `event.input` before native schema decoding;
- agent transforms may create hidden agents at runtime; and
- native subagent model selection reads the selected agent's pinned model.

Release-matched source references:

- [release run 15788](https://github.com/anomalyco/opencode/actions/runs/29630441419)
- [native subagent](https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/core/src/tool/subagent.ts)
- [V2 plugin tool API](https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/plugin/src/v2/effect/tool.ts)
- [session model-request hook](https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/core/src/session/model-request.ts)
- [tool hook settlement](https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/core/src/tool/registry.ts)

## Validation

Run the local tests:

```sh
node --test opencode/v2/shared/plugins/delegate-profiles.test.mjs
python3 -m unittest scripts.tests.test_link_config
```

The deterministic integration test sends every provider request through
`context-proxy-forward` while avoiding dependence on a model choosing the
expected tool call:

```sh
# Terminal 1, from this repository
python3 opencode/v2/test/delegate-profile-upstream.py

# Terminal 2
CAPTURE=/tmp/opencode-v2-delegate-profile-captures
rm -rf "$CAPTURE"
cd /home/lucas/9999-personal/context-proxy-forward
uv run python context_proxy_forward.py \
  --host 127.0.0.1 --port 1234 \
  --out "$CAPTURE" \
  --upstream http://127.0.0.1:1235

# Terminal 3, from this repository
CAPTURE=/tmp/opencode-v2-delegate-profile-captures
o2t service restart
o2t run --auto --agent General \
  --model prompt-capture-openai/gpt-5.6-luna \
  'Run the requested profile routing probe.'
python3 opencode/v2/test/check-delegate-profile-captures.py "$CAPTURE"
```

The checker verifies the provider-facing schema, the exact `Researcher` plus
`deep` call, the `gpt-5.6-sol` child request, the retained Researcher system
prompt, and the native child result returned to the parent.

The released configuration was also validated live through `o2h` with OpenAI
Luna as the General orchestrator. The final parent session contained three
completed calls with `agent: Researcher` and profiles `fast`, `standard`, and
`deep`. Inspection of the three child sessions confirmed:

| Profile | Child model |
|---|---|
| `fast` | `openai/gpt-5.6-luna#low` |
| `standard` | `openai/gpt-5.6-terra#medium` |
| `deep` | `openai/gpt-5.6-sol#high` |

Each child was parent-owned, stored the corresponding hidden Researcher alias,
and returned the requested result to the parent.

## Upgrade checklist

After every V2 CLI upgrade:

1. Update the version in [`README.md`](README.md).
2. Recheck the release-matched native `subagent`, plugin tool declarations,
   session-context hook, tool registry, and plugin activation order.
3. Run unit and linker tests.
4. Run the capture integration test and inspect the final parent and child
   requests.
5. Run one live home-profile delegation and inspect the final session to verify
   the requested agent role and each selected model profile.

## Known limitations

- Native V2 `subagent` always creates a fresh child. It cannot resume an
  existing delegated session as the V1 replacement can.
- Native permission checks see the generated hidden alias ID. The current
  General and Director wildcard rules allow aliases, but per-agent allowlists
  must include `delegate-profile--<profile>--<agent>` IDs.
- The hidden alias remains the stored child session's agent ID, although its
  display name and behavior are cloned from the requested role.
- All hook and agent-transform APIs used here are beta and must be revalidated
  against the exact installed release.
