Score whether the response fulfills the user's request. Use the request as the primary contract; check the requested task, important constraints, completeness, and whether the response is usable.

Score 5 when it fully completes the task; 4 when it completes the task with only a minor omission; 3 when it is partially useful but misses a material part; 2 when it mostly fails or contains a major error; 1 when it is irrelevant, contradicts the request, or does not attempt the task. Use not_applicable only if the request is not answerable from the prompt and the response appropriately explains that limitation.

Do not reward verbosity. Do not infer facts absent from the request. Return a short explanation grounded in the response.

User request:
{{prompt}}

Response:
{{response}}
