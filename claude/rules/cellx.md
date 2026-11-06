# CellX local instructions

Apply this file only when the working directory is a CellX checkout: `/home/lucas/0000-work/lib_cellx`, a worktree under it, or a worktree under `/home/lucas/0000-work/lib_cellx-wt/`. Ignore it in other projects.

These instructions add to the repository `AGENTS.md`. For building, formatting and running unit tests, follow this file where it differs from `AGENTS.md`.
## Quality gates

Run these from the root of the checkout you are working in:

- Format code: `cellx_build -f`
- Build code: `cellx_build hpdk -b`. Other boards: `9151dk`, `stratus`, `sim`.
- Run one unit test suite: `cellx_build sim -t --test-dir tests/unit_tests/<suite>`, for example `cellx_build sim -t --test-dir tests/unit_tests/message_handler`.
- Run the full unit test suite: `cellx_build sim -t`

## Unit tests

- Run only the suites for the modules you changed. Run the full suite only when the user asks, or once before you finish a change that touches more than one module.
- Do not run raw `west twister` or `west build`. `cellx_build` reuses build directories for incremental builds, while the raw `--clobber-output` commands in `AGENTS.md` rebuild every suite from scratch.
- Do not use `-p` (pristine) unless an incremental build fails for a reason a clean build would fix.
- Run one test command at a time. Do not start a test run in the background and then start another.

## Notes for cellx_build

- The tool is the `cellx_build` Python package in `tools/build_scripts`. Use `cellx_build --help` for options.
- Do not source any NCS or Zephyr environment scripts. `cellx_build` sets up the environment itself.
- `cellx_build` builds the checkout it is run from, including git worktrees. Do not change the `~/ncs/v3.2.0/modules/lib/myriota-cellx` symlink. Other agents share it.
- If a change affects formatting or test discovery, rerun the relevant gate before you finish.

## Worktrees

Create git worktrees under `/home/lucas/0000-work/lib_cellx-wt/`, one directory per task, named `<topic>_wt`:

```sh
git worktree add /home/lucas/0000-work/lib_cellx-wt/storage_sorted_wt -b feature/storage-sorted-index origin/main
git -C /home/lucas/0000-work/lib_cellx-wt/storage_sorted_wt submodule update --init --recursive
```

Do not create worktrees as siblings of the main clone (the older `lib_cellx-<topic>` layout).
