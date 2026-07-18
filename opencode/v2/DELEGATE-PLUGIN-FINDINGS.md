# V2 delegate model-profile findings

## Decision

A model-profile prototype is **working** on
`@opencode-ai/cli@0.0.0-next-15788`. It extends the native V2 `subagent` tool
with `fast`, `standard`, `deep`, and `inherit` while retaining the native child
session executor. The prototype is enabled only in the isolated `v2/test`
profile; it is not yet enabled for home or work.

V2 still cannot reproduce every V1 behavior. In particular, native `subagent`
always creates a fresh child and has no task/session ID for resumption.

## Corrected V2 findings

- The V2 native tool is `subagent`, not `task`. Its native input is `agent`,
  `description`, `prompt`, and optional `background`.
- The plugin session-context hook can reshape the model-facing schema of a
  registered tool. The runtime name in this release is `context`.
- `tool.execute.before` can replace the input before native schema decoding.
- V2 agents can be pinned to `{ providerID, id, variant? }` model references.
- The native executor creates a parent-owned child, applies subagent permission
  checks, runs foreground/background jobs, propagates cancellation, and returns
  the structured session ID used by the TUI.
- `tool.execute.after` can replace `result`, `output`, and `outputPaths`, though
  there is no typed successful pre-execution short circuit.
- A plugin tool named `task` does not override anything in V2. A later tool
  named `subagent` currently wins registry materialization, but that ordering is
  not a documented override contract and is unnecessary for this prototype.

## Prototype design

[`shared/plugins/delegate-profiles.js`](shared/plugins/delegate-profiles.js):

1. Adds required `model_profile` metadata to the model-facing native
   `subagent` JSON schema.
2. Intercepts native `subagent` execution before input decoding.
3. For a pinned profile, clones the selected configured agent into a hidden,
   model-pinned alias and replaces only the executor-facing `agent` value.
4. Removes `model_profile` so the unchanged native input decoder accepts the
   call.
5. For `inherit`, removes `model_profile` and leaves the original agent intact.

Cloning occurs lazily during execution, after config-defined agents have
loaded. It preserves the selected agent's system prompt, permissions, mode,
request options, and other settings. Alias registrations are cached for the
plugin generation and disposed when the plugin unloads.

The test profile supplies capture-provider presets through plugin options in
[`test/opencode.json`](test/opencode.json). Production profiles can supply
different provider/model references without changing the plugin.

## Validation

Unit validation:

```sh
node --test opencode/v2/shared/plugins/delegate-profiles.test.mjs
python3 -m unittest scripts.tests.test_link_config
```

Capture integration validation uses a deterministic upstream so no provider is
asked to decide whether to call the tool. All model requests still pass through
`context-proxy-forward`, which captures the exact provider payloads:

```sh
# Terminal 1, from this repository:
python3 opencode/v2/test/delegate-profile-upstream.py

# Terminal 2:
CAPTURE=/tmp/opencode-v2-delegate-profile-captures
rm -rf "$CAPTURE"
cd /home/lucas/9999-personal/context-proxy-forward
uv run python context_proxy_forward.py \
  --host 127.0.0.1 --port 1234 \
  --out "$CAPTURE" \
  --upstream http://127.0.0.1:1235

# Terminal 3, from this repository:
CAPTURE=/tmp/opencode-v2-delegate-profile-captures
o2t service restart
o2t run --auto --agent General \
  --model prompt-capture-openai/gpt-5.6-luna \
  'Run the requested profile routing probe.'

python3 opencode/v2/test/check-delegate-profile-captures.py "$CAPTURE"
```

Observed result on 2026-07-18:

- the parent request used `gpt-5.6-luna`;
- its `subagent` schema contained required `model_profile` with all four enum
  values;
- the scripted call selected `Researcher` with `model_profile: deep`;
- the child request used `gpt-5.6-sol` and retained the `Researcher` system
  prompt;
- the native child result returned to the parent, which completed with
  `PROBE_PARENT_OK`; and
- the capture checker passed.

## Limitations before rollout

1. Native V2 subagents cannot resume an existing child session.
2. Native permission checks see the hidden alias ID. Current General/Director
   wildcard rules permit it, but installations with per-agent allowlists must
   allow the generated alias IDs.
3. Hidden aliases can still appear as the stored child session's agent ID.
4. The `context` hook name and mutable schema/input behavior are beta API
   surfaces and require revalidation after every V2 upgrade.
5. Home/work profile model mappings and live-provider behavior have not been
   selected or validated, so the prototype remains test-only.

## Release-matched references

- Release run: <https://github.com/anomalyco/opencode/actions/runs/29630441419>
- V2 native subagent: <https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/core/src/tool/subagent.ts>
- V2 plugin tool API: <https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/plugin/src/v2/effect/tool.ts>
- Session-context request construction: <https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/core/src/session/model-request.ts>
- Tool hook settlement: <https://github.com/anomalyco/opencode/blob/deb5b144c3b0f575e478f02f8b9d979cf8d01b8c/packages/core/src/tool/registry.ts>
