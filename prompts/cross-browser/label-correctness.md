Score whether a requested classification, sentiment, tag, category, or other label is correct for the user's input. Use only labels that are stated or clearly implied by the prompt; do not invent a hidden label set.

Score 5 when the requested label(s) are correct; 4 when correct with a minor omission; 3 when partly correct or incomplete; 2 when the main label is likely wrong; 1 when it is clearly wrong or absent. Use not_applicable when the task does not ask for a label or classification, or when correctness cannot be determined from the prompt. Return a short explanation.

User request:
{{prompt}}

Response:
{{response}}
