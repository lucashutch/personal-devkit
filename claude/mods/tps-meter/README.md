# tps-meter

Shows the main model's output speed for the last turn at the end of the dim hint line under the prompt (`? for shortcuts`). It takes no row of its own. The figure appears when a turn completes, for example `75.0 tok/s`, and stays until the next turn completes.

## How the figure is computed

It matches OpenCode's `session.tps` figure. For each main-loop model request (one `turn.step`) in a turn, the mod records `usage.output_tokens` and the time from the request being sent to its stream ending. When the turn completes, it divides the turn's total output tokens by the total request time. Summing before dividing weights each request by how long it took.

The request time includes the wait for the first token, so the figure reads lower than a pure generation rate when the API is slow to start. Time spent running tools between requests is not counted.

If any request in the turn has no usage (an error, an interrupt), the turn shows no figure: a partial figure would mislead.

## Caveats

- `output_tokens` includes thinking tokens, so the rate counts thinking too.
- There is no live figure while a response streams. The API reports output tokens only when a response ends, and counting characters gives figures that are far off, mostly because the stream carries a summary of the model's thinking, not all of it.
- Only main-loop requests count. Subagent requests are ignored.
- The terminal cuts the hint line where the row ends, so a narrow terminal can hide the figure.

## Tests

```
claude plugin test claude/mods/tps-meter
```
