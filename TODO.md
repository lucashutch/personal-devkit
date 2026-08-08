# TODO

- Revisit V2 TUI slot invalidation after `0.0.0-next-17028`. A minimal external
  component with a local Solid signal and one-second timer stayed at `0s` until
  the sidebar was hidden and shown. Keep the unregister/register workaround
  until the host runtime propagates external component updates.
