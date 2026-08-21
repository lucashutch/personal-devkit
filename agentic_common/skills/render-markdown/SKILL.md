---
name: render-markdown
description: Render a Markdown file in a new sibling Herdr pane with glowm. Use when the user asks to view or render Markdown in Herdr.
---
# Render Markdown

Render the requested Markdown file in a new sibling Herdr pane with `glowm -no-pager`.

## Process

1. Resolve the requested file relative to the current working directory. If no file is specified, ask which Markdown file to render.
2. Confirm that the file and `glowm` are available. If Herdr did not provide a current pane ID, explain that a Herdr pane is required.
3. Inspect the current pane layout. Split a wide pane to the right; split a narrow or tall pane down. Preserve the working directory and leave focus in the calling pane:

   ```sh
   herdr pane split --current --direction right --cwd "$PWD" --no-focus
   ```

4. Read the new pane ID from the command's JSON result. Run:

   ```sh
   herdr pane run <pane-id> "glowm -no-pager <markdown-file>"
   ```

5. Read the new pane's visible output to confirm that the document rendered. Do not close the pane when rendering finishes.

Use an explicit pane ID when one is available. Do not split a pane that is already too narrow to remain usable.
