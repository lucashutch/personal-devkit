---
name: render-markdown
description: Render a Markdown file in a new sibling Herdr pane with glowm. Use when the user asks to view or render Markdown in Herdr.
---
# Render Markdown

Render the requested Markdown file in a new sibling Herdr pane with `glowm -no-pager`.

## Process

1. Resolve the requested file relative to the current working directory. If no file is specified, ask which Markdown file to render.
2. Always create the renderer as a right-hand sibling of the calling pane; do not choose a direction from the layout or fall back to a downward split. Run the split command from the calling pane's working directory, preserving that directory and leaving focus in the calling pane:

   ```sh
   herdr pane split --current --direction right --cwd "$PWD" --no-focus
   ```

3. Require a successful JSON response from the split command. Read the new pane ID at `result.pane.pane_id`, then run the renderer in that exact pane:

   ```sh
   herdr pane run <pane-id> "glowm -no-pager <markdown-file>"
   ```

4. Read the new pane's visible output to confirm that the document rendered. Do not close the pane when rendering finishes. If splitting fails, report the failure rather than rendering in the calling pane or using another split direction.

Use an explicit pane ID when one is available.
