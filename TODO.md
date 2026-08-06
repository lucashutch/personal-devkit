# TODO

- Revisit V2 TUI slot invalidation after a future OpenCode upgrade. With
  `0.0.0-next-16902`, neither ordinary Solid signals nor host-owned
  `context.storage.memory()` invalidated mounted external slots in live
  testing. The unregister/register workaround remains necessary pending an
  upstream fix.
