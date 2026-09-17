# Estimated API costs

Restores API-equivalent OpenAI pricing when a subscription-backed model reports
zero cost. The server then includes an estimated dollar cost in future session
usage updates even though the subscription does not incur that API charge.

The plugin copies normalized prices from OpenCode's immutable provider catalog,
which is sourced from models.dev. It does not fetch pricing at startup. Existing
nonzero prices are preserved. Subscription-only `-fast` model IDs use the price
of their base model when the catalog has no exact entry.

Existing session history is not recalculated. Prices apply to usage recorded
after the plugin loads.
