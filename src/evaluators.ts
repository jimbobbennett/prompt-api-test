import { Ajv } from "ajv";
import { asExperimentEvaluator } from "@arizeai/phoenix-client/experiments";

import { RECEIPT_SCHEMA } from "../data/baseline.js";

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

export function isValidExperimentOutput(value: unknown): value is ExperimentOutput {
  return isRecord(value) && typeof value.response === "string";
}
