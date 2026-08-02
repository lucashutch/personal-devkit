# TODO

- Revisit the V2 TUI plugins after upgrading `@opencode-ai/plugin` and the
  OpenCode V2 CLI from `0.0.0-next-16671`. Check whether external plugin Solid
  state can invalidate mounted host slots correctly. If it can, remove the
  unregister/register redraw workarounds from `subagent-sessions` and
  `limitwatch-quota` and restore ordinary reactive updates. Also check whether
  the supported solution is a host-owned reactive primitive such as
  `context.storage.memory()` rather than slot remounting.
