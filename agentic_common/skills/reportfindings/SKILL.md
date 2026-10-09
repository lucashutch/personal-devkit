---
name: reportfindings
description: Use when reporting code-review or security-review findings. Format verified findings as Markdown instead of a structured findings tool.
---
# Report findings

Report review results in the conversation. This skill formats findings; it does not replace the review or verify claims by itself.

- Use only findings supported by the review evidence. Do not invent issues, severity, verification results, or line numbers.
- Order findings by severity. Number them so the user can refer to each one.
- Keep each title short and specific. Include the file and line, category, explanation, and a concrete failure scenario.
- Include a suggested fix when supported. Include verification status only when a check actually ran. Separate unverified concerns from confirmed findings.
- Follow any finding limit or scope specified by the user. Do not apply fixes, post comments, or publish files unless requested.
- Print Markdown directly. Do not call a structured findings tool or create an artifact as a substitute for the report.

## Format

```text
## Findings

### 1. [Short title]
Location: path/to/file:line
Category: correctness

Summary: Explain the defect and its consequence.

Failure scenario: State the input or conditions that expose it.

Suggested fix: Describe the smallest supported correction.
```

Omit unsupported optional fields. When no findings survive review, state "No findings in the reviewed scope." Mention material coverage limits or checks that could not run. Do not imply that no findings proves the code is defect-free.
