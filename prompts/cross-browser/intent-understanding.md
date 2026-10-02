Score whether the response understood the user's intent, including the desired outcome, relevant context, and constraints.

Score 5 when it clearly addresses the intended outcome and constraints; 4 when it understands the main intent with a minor miss; 3 when it addresses the general topic but misses an important part of the intent; 2 when it substantially misunderstands the request; 1 when it responds to a different intent. Use not_applicable only when the prompt provides no interpretable user intent.

Judge the response, not whether it used the exact wording of the request. Return a short explanation.

User request:
{{prompt}}

Response:
{{response}}
