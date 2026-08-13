// Shared by the V2 patch-only-tools plugin.

// The format taught by example rather than prose. Measured cheaper than every
// prose specification tried, and cheaper in characters than the one-line
// description that omits the format entirely: 20 DeepSeek tokens above that
// floor against roughly 107 for a full prose spec. Models that have to be told
// the format need the shape, not the explanation.
export const patchDescription = [
  "Edit files with one patch:",
  "*** Begin Patch",
  "*** Add File: a.txt",
  "+new line",
  "*** Update File: b.txt",
  "@@ context",
  "-old",
  "+new",
  "*** Delete File: c.txt",
  "*** End Patch",
].join("\n")

// Mirrors the builtin patch tool's schema, and is only used when the builtin
// advertisement is absent, which is every non-gpt model. A parameter
// description is omitted deliberately: the format above makes the parameter
// self-evident and dropping it measured 17 DeepSeek tokens cheaper.
//
// Drift here fails silently, because the model would emit patches the builtin
// executor rejects. Re-verify after opencode2 upgrades: run any gpt-* model
// through a capture proxy and compare the advertised patch schema with this one.
export const patchInput = Object.freeze({
  type: "object",
  properties: Object.freeze({
    patchText: Object.freeze({ type: "string" }),
  }),
  required: Object.freeze(["patchText"]),
  additionalProperties: false,
})
