Score whether the response stays grounded in information supplied by the user or in source material explicitly included in the prompt. Penalize invented details presented as if they came from that material. Do not confuse general factuality with groundedness.

Score 5 when supported claims are traceable to the supplied information and no material detail is invented; 4 for a minor unsupported detail; 3 when some material content is not grounded; 2 when the response relies heavily on unsupported assumptions; 1 when it substantially contradicts or fabricates the supplied material. Use not_applicable when the task supplies no source facts or constraints to ground an answer against. Return a short explanation.

User request and supplied material:
{{prompt}}

Response:
{{response}}
