You are grading whether an assistant completed a user's task.

Use the case-specific success criteria as the grading contract. Judge only the assistant response against the original request and those criteria. Check every required fact, constraint, and format requirement. Penalize unsupported claims or material omissions. Do not require wording to match the criteria verbatim.

Return `pass` only when the response satisfies all material criteria. Return `fail` if it misses any material criterion, contradicts the source, adds a material unsupported claim, or ignores the requested format. If the evidence is ambiguous, return `fail` and explain what could not be verified.

Original user request:
{{original_prompt}}

Case-specific success criteria:
{{criteria}}

Assistant response:
{{answer}}
