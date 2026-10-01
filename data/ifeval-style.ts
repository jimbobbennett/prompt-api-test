export type InstructionCheck =
  | { id: string; type: "exact_bullet_count"; count: number }
  | { id: string; type: "min_words"; count: number }
  | { id: string; type: "max_words"; count: number }
  | { id: string; type: "required_phrase"; phrase: string }
  | { id: string; type: "forbidden_phrase"; phrase: string }
  | { id: string; type: "phrase_count_min"; phrase: string; count: number }
  | { id: string; type: "starts_with"; text: string }
  | { id: string; type: "ends_with"; text: string };

export type InstructionCase = {
  id: string;
  prompt: string;
  expected: { checks: InstructionCheck[] };
  metadata: {
    group: "instruction-following";
    source: "ifeval-style";
    task: string;
    constraint_types: InstructionCheck["type"][];
  };
};

function makeCase(
  id: string,
  task: string,
  prompt: string,
  checks: InstructionCheck[],
): InstructionCase {
  return {
    id,
    prompt,
    expected: { checks },
    metadata: {
      group: "instruction-following",
      source: "ifeval-style",
      task,
      constraint_types: checks.map((check) => check.type),
    },
  } as InstructionCase;
}

export const IFEVAL_STYLE_CASES: InstructionCase[] = [
  makeCase("ifeval-001", "constrained-summary", "Summarize this notice using exactly two dash bullets. Include the exact phrase ‘maintenance window’. Notice: The pool closes Monday morning for cleaning and reopens at noon.", [
    { id: "two-bullets", type: "exact_bullet_count", count: 2 },
    { id: "maintenance-window", type: "required_phrase", phrase: "maintenance window" },
  ]),
  makeCase("ifeval-002", "project-update", "Write a project update as exactly three dash bullets. Keep the whole response to at most 45 words. The design review is complete, two accessibility fixes remain, and testing starts Friday.", [
    { id: "three-bullets", type: "exact_bullet_count", count: 3 },
    { id: "under-45-words", type: "max_words", count: 45 },
  ]),
  makeCase("ifeval-003", "plain-language-explanation", "Explain this message to a nontechnical customer in at least 25 words: ‘Your request timed out after 30 seconds.’ Do not say ‘definitely caused by’.", [
    { id: "at-least-25-words", type: "min_words", count: 25 },
    { id: "avoid-certain-cause", type: "forbidden_phrase", phrase: "definitely caused by" },
  ]),
  makeCase("ifeval-004", "status-report", "Summarize this update. Start the response with ‘Status:’ and end it with ‘Owner: Ana.’ Update: The migration is on schedule. Ana will verify the backup before the team switches traffic.", [
    { id: "status-prefix", type: "starts_with", text: "Status:" },
    { id: "owner-suffix", type: "ends_with", text: "Owner: Ana." },
  ]),
  makeCase("ifeval-005", "appointment-reminder", "Write a friendly reminder using the exact phrase ‘next appointment’. Use the phrase ‘follow up’ at least twice. The appointment is Thursday at 2 p.m.; arrive ten minutes early.", [
    { id: "appointment-phrase", type: "required_phrase", phrase: "next appointment" },
    { id: "follow-up-twice", type: "phrase_count_min", phrase: "follow up", count: 2 },
  ]),
  makeCase("ifeval-006", "notice-rewrite", "Rewrite this notice in no more than 30 words. Do not use the word ‘free’. Notice: The museum is open late on Friday, and visitors can reserve timed entry online.", [
    { id: "under-30-words", type: "max_words", count: 30 },
    { id: "avoid-free", type: "forbidden_phrase", phrase: "free" },
  ]),
  makeCase("ifeval-007", "rollout-summary", "Summarize the plan as exactly three dash bullets and include the exact phrase ‘rollout plan’. The pilot begins in June, support staff get training first, and the full launch follows the pilot review.", [
    { id: "three-bullets", type: "exact_bullet_count", count: 3 },
    { id: "rollout-phrase", type: "required_phrase", phrase: "rollout plan" },
  ]),
  makeCase("ifeval-008", "product-description", "Describe a reusable notebook in at least 35 words. Include the exact phrase ‘recycled paper’ at least twice.", [
    { id: "at-least-35-words", type: "min_words", count: 35 },
    { id: "recycled-paper-twice", type: "phrase_count_min", phrase: "recycled paper", count: 2 },
  ]),
  makeCase("ifeval-009", "decision-summary", "Summarize this decision. Start with ‘Decision:’ and mention the exact date ‘April 20’. The team chose the downtown room because it is near the train station and fits 40 people.", [
    { id: "decision-prefix", type: "starts_with", text: "Decision:" },
    { id: "date-phrase", type: "required_phrase", phrase: "April 20" },
  ]),
  makeCase("ifeval-010", "two-step-instructions", "Give exactly two dash bullets explaining what to do: save the draft, then email the link to Morgan. Keep the answer to at most 32 words.", [
    { id: "two-bullets", type: "exact_bullet_count", count: 2 },
    { id: "under-32-words", type: "max_words", count: 32 },
  ]),
  makeCase("ifeval-011", "clinic-call-follow-up", "Write a reassuring message of at least 20 words about calling the clinic to ask when test results will be ready. End with ‘Next step: call the clinic.’", [
    { id: "at-least-20-words", type: "min_words", count: 20 },
    { id: "clinic-call-suffix", type: "ends_with", text: "Next step: call the clinic." },
  ]),
  makeCase("ifeval-012", "support-response", "Write a short response that includes the exact phrase ‘support desk’. Do not use the word ‘password’. A customer cannot sign in and needs help restoring access.", [
    { id: "support-desk-phrase", type: "required_phrase", phrase: "support desk" },
    { id: "avoid-password", type: "forbidden_phrase", phrase: "password" },
  ]),
  makeCase("ifeval-013", "estimate-summary", "Summarize the estimate and include ‘cost estimate’. Keep the response to no more than 40 words. The repair is expected to take two hours, with parts billed separately after approval.", [
    { id: "cost-estimate-phrase", type: "required_phrase", phrase: "cost estimate" },
    { id: "under-40-words", type: "max_words", count: 40 },
  ]),
  makeCase("ifeval-014", "issue-tracker-update", "Summarize the bug as exactly three dash bullets. End the response with ‘Status: open.’ The team reproduced the issue on Tuesday and is checking the latest logs.", [
    { id: "three-bullets", type: "exact_bullet_count", count: 3 },
    { id: "open-status-suffix", type: "ends_with", text: "Status: open." },
  ]),
  makeCase("ifeval-015", "event-invitation", "Write an invitation of at least 25 words and no more than 45 words for a neighborhood garden meeting next Saturday at 10 a.m. Bring gloves if you have them.", [
    { id: "at-least-25-words", type: "min_words", count: 25 },
    { id: "under-45-words", type: "max_words", count: 45 },
  ]),
  makeCase("ifeval-016", "schedule-change", "Explain the schedule change. Begin with ‘Update:’ and include the exact phrase ‘Tuesday morning.’ The delivery moved from Monday afternoon because of a road closure.", [
    { id: "update-prefix", type: "starts_with", text: "Update:" },
    { id: "new-time-phrase", type: "required_phrase", phrase: "Tuesday morning" },
  ]),
  makeCase("ifeval-017", "checklist-summary", "Explain why the team should verify the release checklist. Use the word ‘checklist’ at least twice and do not use ‘impossible’.", [
    { id: "checklist-twice", type: "phrase_count_min", phrase: "checklist", count: 2 },
    { id: "avoid-impossible", type: "forbidden_phrase", phrase: "impossible" },
  ]),
  makeCase("ifeval-018", "handoff-note", "Write a handoff note about the open dashboard issue. Keep it to 30 words or fewer and finish with ‘Owner: Sam.’", [
    { id: "under-30-words", type: "max_words", count: 30 },
    { id: "owner-suffix", type: "ends_with", text: "Owner: Sam." },
  ]),
  makeCase("ifeval-019", "option-comparison", "Compare the two plans in exactly two dash bullets. Mention ‘Option A’ at least once. Option A starts sooner; Option B costs less.", [
    { id: "two-bullets", type: "exact_bullet_count", count: 2 },
    { id: "option-a-phrase", type: "phrase_count_min", phrase: "Option A", count: 1 },
  ]),
  makeCase("ifeval-020", "care-instructions", "Explain how to care for a new houseplant in at least 25 words. Do not use the word ‘always’.", [
    { id: "at-least-25-words", type: "min_words", count: 25 },
    { id: "avoid-always", type: "forbidden_phrase", phrase: "always" },
  ]),
  makeCase("ifeval-021", "meeting-summary", "Summarize these notes. Begin with ‘Summary:’ and include the exact phrase ‘meeting notes’. The team agreed to draft a proposal, then review it with finance next week.", [
    { id: "summary-prefix", type: "starts_with", text: "Summary:" },
    { id: "meeting-notes-phrase", type: "required_phrase", phrase: "meeting notes" },
  ]),
  makeCase("ifeval-022", "shipping-update", "Summarize this shipping update in exactly three dash bullets. Do not use the word ‘urgent’. The package is delayed by weather and is now expected Friday.", [
    { id: "three-bullets", type: "exact_bullet_count", count: 3 },
    { id: "avoid-urgent", type: "forbidden_phrase", phrase: "urgent" },
  ]),
  makeCase("ifeval-023", "venue-follow-up", "Write a concise follow-up of at most 40 words. Include the exact phrase ‘contact the venue’. The event organizer needs to confirm the room setup and accessibility arrangements.", [
    { id: "under-40-words", type: "max_words", count: 40 },
    { id: "contact-venue-phrase", type: "required_phrase", phrase: "contact the venue" },
  ]),
  makeCase("ifeval-024", "recommendation-with-uncertainty", "Recommend whether to delay the launch given that one important test is still failing. Start with ‘Recommendation:’ and end with ‘Confidence: low.’", [
    { id: "recommendation-prefix", type: "starts_with", text: "Recommendation:" },
    { id: "confidence-suffix", type: "ends_with", text: "Confidence: low." },
  ]),
];
