import { Ajv } from "ajv";
import { asExperimentEvaluator } from "@arizeai/phoenix-client/experiments";

import { RECEIPT_SCHEMA } from "../data/baseline.js";
import type { InstructionCheck } from "../data/ifeval-style.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const validateReceipt = ajv.compile(RECEIPT_SCHEMA);

type ReceiptShape = {
  merchant: string;
  date: string | null;
  currency: string;
  total: number;
  items: Array<{ description: string; quantity: number; amount: number }>;
};

type ExperimentOutput = { response: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readResponse(output: unknown): string | null {
  return isRecord(output) && typeof output.response === "string" ? output.response : null;
}

function parseJsonResponse(output: unknown): { parsed: unknown; error: string | null } {
  const response = readResponse(output);
  if (response === null) return { parsed: null, error: "Experiment output has no response string." };
  try {
    return { parsed: JSON.parse(response) as unknown, error: null };
  } catch (error) {
    return { parsed: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export const jsonSchemaValid = asExperimentEvaluator({
  name: "json_schema_valid",
  kind: "CODE",
  evaluate: async ({ output }) => {
    const result = parseJsonResponse(output);
    if (result.error !== null) {
      return { score: 0, label: "invalid_json", explanation: result.error };
    }
    if (!validateReceipt(result.parsed)) {
      const errors = (validateReceipt.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "failed validation"}`).join("; ");
      return { score: 0, label: "schema_invalid", explanation: errors };
    }
    return { score: 1, label: "valid", explanation: "Response is raw JSON matching receipt-v1." };
  },
});

function isReceiptShape(value: unknown): value is ReceiptShape {
  return validateReceipt(value);
}

function compareReceiptValues(actual: ReceiptShape, expected: unknown): string[] {
  if (!isRecord(expected)) return ["Reference output is missing expected_receipt."];
  const mismatches: string[] = [];
  for (const key of ["merchant", "date", "currency", "total"] as const) {
    if (actual[key] !== expected[key]) mismatches.push(`${key}: expected ${String(expected[key])}, received ${String(actual[key])}`);
  }
  const expectedItems = expected.items;
  if (!Array.isArray(expectedItems)) return [...mismatches, "Reference output has no items array."];
  if (actual.items.length !== expectedItems.length) {
    mismatches.push(`items: expected ${expectedItems.length} item(s), received ${actual.items.length}`);
  }
  const itemCount = Math.min(actual.items.length, expectedItems.length);
  for (let index = 0; index < itemCount; index++) {
    const actualItem = actual.items[index];
    const expectedItem = expectedItems[index];
    if (!actualItem || !isRecord(expectedItem)) {
      mismatches.push(`items[${index}] is malformed.`);
      continue;
    }
    for (const key of ["description", "quantity", "amount"] as const) {
      if (actualItem[key] !== expectedItem[key]) {
        mismatches.push(`items[${index}].${key}: expected ${String(expectedItem[key])}, received ${String(actualItem[key])}`);
      }
    }
  }
  return mismatches;
}

export const receiptValuesCorrect = asExperimentEvaluator({
  name: "receipt_values_correct",
  kind: "CODE",
  evaluate: async ({ output, expected }) => {
    const result = parseJsonResponse(output);
    if (result.error !== null || !isReceiptShape(result.parsed)) {
      return { score: 0, label: "not_scored", explanation: "Value comparison requires valid receipt-v1 JSON." };
    }
    const mismatches = compareReceiptValues(result.parsed, expected?.expected_receipt);
    return mismatches.length === 0
      ? { score: 1, label: "match", explanation: "All receipt fields match the reference." }
      : { score: 0, label: "mismatch", explanation: mismatches.join("; ") };
  },
});

export type InstructionCheckResult = {
  id: string;
  type: InstructionCheck["type"];
  passed: boolean;
  explanation: string;
};

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function phraseOccurrences(text: string, phrase: string): number {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedPhrase = phrase.trim().toLocaleLowerCase();
  if (!normalizedPhrase) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = normalizedText.indexOf(normalizedPhrase, offset)) !== -1) {
    count++;
    offset += normalizedPhrase.length;
  }
  return count;
}

export function checkInstruction(text: string, check: InstructionCheck): InstructionCheckResult {
  let passed = false;
  let explanation = "Unsupported instruction check.";
  switch (check.type) {
    case "exact_bullet_count": {
      const count = (text.match(/^\s*-\s+.+$/gmu) ?? []).length;
      passed = count === check.count;
      explanation = `Expected ${check.count} dash bullets; found ${count}.`;
      break;
    }
    case "min_words": {
      const count = wordCount(text);
      passed = count >= check.count;
      explanation = `Expected at least ${check.count} whitespace-delimited words; found ${count}.`;
      break;
    }
    case "max_words": {
      const count = wordCount(text);
      passed = count <= check.count;
      explanation = `Expected at most ${check.count} whitespace-delimited words; found ${count}.`;
      break;
    }
    case "required_phrase":
      passed = phraseOccurrences(text, check.phrase) > 0;
      explanation = passed ? `Included required phrase '${check.phrase}'.` : `Missing required phrase '${check.phrase}'.`;
      break;
    case "forbidden_phrase":
      passed = phraseOccurrences(text, check.phrase) === 0;
      explanation = passed ? `Avoided forbidden phrase '${check.phrase}'.` : `Found forbidden phrase '${check.phrase}'.`;
      break;
    case "phrase_count_min": {
      const count = phraseOccurrences(text, check.phrase);
      passed = count >= check.count;
      explanation = `Expected phrase '${check.phrase}' at least ${check.count} time(s); found ${count}.`;
      break;
    }
    case "starts_with":
      passed = text.trimStart().toLocaleLowerCase().startsWith(check.text.toLocaleLowerCase());
      explanation = passed ? `Started with '${check.text}'.` : `Did not start with '${check.text}'.`;
      break;
    case "ends_with":
      passed = text.trimEnd().toLocaleLowerCase().endsWith(check.text.toLocaleLowerCase());
      explanation = passed ? `Ended with '${check.text}'.` : `Did not end with '${check.text}'.`;
      break;
    default: {
      const exhaustiveCheck: never = check;
      throw new Error(`Unsupported instruction check: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
  return { id: check.id, type: check.type, passed, explanation };
}

function evaluateInstructionChecks(output: unknown, expected: unknown): {
  checks: InstructionCheckResult[];
  invalidReason: string | null;
} {
  const response = readResponse(output);
  if (response === null) return { checks: [], invalidReason: "Experiment output has no response string." };
  if (!isRecord(expected) || !Array.isArray(expected.checks) || expected.checks.length === 0) {
    return { checks: [], invalidReason: "Reference output must contain a non-empty checks array." };
  }
  const checks = expected.checks as InstructionCheck[];
  return { checks: checks.map((check) => checkInstruction(response, check)), invalidReason: null };
}

export const ifevalPromptLevel = asExperimentEvaluator({
  name: "ifeval_prompt_level",
  kind: "CODE",
  evaluate: async ({ output, expected }) => {
    const evaluation = evaluateInstructionChecks(output, expected);
    if (evaluation.invalidReason) {
      return { score: 0, label: "invalid_reference", explanation: evaluation.invalidReason };
    }
    const failed = evaluation.checks.filter((check) => !check.passed);
    return failed.length === 0
      ? { score: 1, label: "pass", explanation: `All ${evaluation.checks.length} instruction checks passed.` }
      : { score: 0, label: "fail", explanation: failed.map((check) => `${check.id}: ${check.explanation}`).join("; ") };
  },
});

export const ifevalInstructionLevel = asExperimentEvaluator({
  name: "ifeval_instruction_level",
  kind: "CODE",
  evaluate: async ({ output, expected }) => {
    const evaluation = evaluateInstructionChecks(output, expected);
    if (evaluation.invalidReason) {
      return { score: 0, label: "invalid_reference", explanation: evaluation.invalidReason };
    }
    const passed = evaluation.checks.filter((check) => check.passed).length;
    const score = passed / evaluation.checks.length;
    const label = passed === evaluation.checks.length ? "all_pass" : passed === 0 ? "none_pass" : "partial";
    const details = evaluation.checks.map((check) => `${check.id}=${check.passed ? "pass" : "fail"}`).join(", ");
    return { score, label, explanation: `${passed}/${evaluation.checks.length} instruction checks passed (${details}).` };
  },
});

export function isValidExperimentOutput(value: unknown): value is ExperimentOutput {
  return isRecord(value) && typeof value.response === "string";
}
