import { describe, expect, it } from "vitest";
import { BENCHMARK_GROUPS } from "../data/baseline.js";
import { jsonSchemaValid, receiptValuesCorrect } from "../src/evaluators.js";

const receipt = BENCHMARK_GROUPS.find((group) => group.id === "receipt-extraction")!.cases[0]!;
const expected = receipt.expected;

describe("receipt evaluators", () => {
  it("accepts schema-valid JSON", async () => {
    const result = await jsonSchemaValid.evaluate({
      input: {}, output: { response: JSON.stringify(expected.expected_receipt) }, expected,
    });
    expect(result.score).toBe(1);
  });

  it("rejects extra fields and malformed JSON", async () => {
    const withExtra = { ...(expected.expected_receipt as object), note: "extra" };
    const extraResult = await jsonSchemaValid.evaluate({ input: {}, output: { response: JSON.stringify(withExtra) }, expected });
    const malformedResult = await jsonSchemaValid.evaluate({ input: {}, output: { response: "not json" }, expected });
    expect(extraResult.score).toBe(0);
    expect(malformedResult.score).toBe(0);
  });

  it("compares every receipt field to the reference", async () => {
    const correct = await receiptValuesCorrect.evaluate({
      input: {}, output: { response: JSON.stringify(expected.expected_receipt) }, expected,
    });
    const incorrect = await receiptValuesCorrect.evaluate({
      input: {}, output: { response: JSON.stringify({ ...(expected.expected_receipt as object), total: 0 }) }, expected,
    });
    expect(correct.score).toBe(1);
    expect(incorrect.score).toBe(0);
  });
});

describe("baseline dataset", () => {
  it("contains three groups of five stable cases", () => {
    expect(BENCHMARK_GROUPS).toHaveLength(3);
    for (const group of BENCHMARK_GROUPS) expect(group.cases).toHaveLength(5);
  });
});
