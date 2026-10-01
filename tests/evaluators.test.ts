import { describe, expect, it } from "vitest";
import { BENCHMARK_GROUPS } from "../data/baseline.js";
import { IFEVAL_STYLE_CASES } from "../data/ifeval-style.js";
import {
  checkInstruction,
  ifevalInstructionLevel,
  ifevalPromptLevel,
  jsonSchemaValid,
  receiptValuesCorrect,
} from "../src/evaluators.js";
import { restoreListMarkers } from "../src/browser-chat.js";

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
  it("contains three original groups of five and 24 IFEval-style cases", () => {
    expect(BENCHMARK_GROUPS).toHaveLength(4);
    for (const group of BENCHMARK_GROUPS.filter((item) => item.id !== "instruction-following")) {
      expect(group.cases).toHaveLength(5);
    }
    expect(IFEVAL_STYLE_CASES).toHaveLength(24);
    expect(new Set(IFEVAL_STYLE_CASES.map((example) => example.id)).size).toBe(24);
    for (const example of IFEVAL_STYLE_CASES) expect(example.expected.checks).toHaveLength(2);
  });
});

describe("IFEval-style constraint checkers", () => {
  it("restores rendered Markdown list markers when reading Phoenix chat text", () => {
    const visibleText = "Intro\nFirst point\nSecond point";
    const items = [
      { text: "First point", marker: "- " },
      { text: "Second point", marker: "- " },
    ];
    expect(restoreListMarkers(visibleText, items)).toBe("Intro\n- First point\n- Second point");
    expect(restoreListMarkers("First\nSecond", [
      { text: "First", marker: "1. " },
      { text: "Second", marker: "2. " },
    ])).toBe("1. First\n2. Second");
  });

  it("counts dash bullets exactly", () => {
    expect(checkInstruction("Intro\n- one\n- two", { id: "bullets", type: "exact_bullet_count", count: 2 }).passed).toBe(true);
    expect(checkInstruction("- one\n- two\n- three", { id: "bullets", type: "exact_bullet_count", count: 2 }).passed).toBe(false);
  });

  it("counts whitespace-delimited words for inclusive minimum and maximum limits", () => {
    expect(checkInstruction("one two three", { id: "min", type: "min_words", count: 3 }).passed).toBe(true);
    expect(checkInstruction("one two three", { id: "max", type: "max_words", count: 2 }).passed).toBe(false);
  });

  it("matches required and forbidden phrases without case sensitivity", () => {
    expect(checkInstruction("The GREEN FOLDER is ready.", { id: "required", type: "required_phrase", phrase: "green folder" }).passed).toBe(true);
    expect(checkInstruction("The password is missing.", { id: "forbidden", type: "forbidden_phrase", phrase: "PASSWORD" }).passed).toBe(false);
  });

  it("counts repeated phrases without case sensitivity", () => {
    const check = { id: "twice", type: "phrase_count_min" as const, phrase: "follow up", count: 2 };
    expect(checkInstruction("Follow up today and follow up tomorrow.", check).passed).toBe(true);
    expect(checkInstruction("Follow up today.", check).passed).toBe(false);
  });

  it("checks trimmed prefixes and suffixes without case sensitivity", () => {
    expect(checkInstruction("  STATUS: ready", { id: "prefix", type: "starts_with", text: "Status:" }).passed).toBe(true);
    expect(checkInstruction("ready. OWNER: Ana.  ", { id: "suffix", type: "ends_with", text: "Owner: Ana." }).passed).toBe(true);
  });

  it("reports strict prompt success separately from the fraction of constraints met", async () => {
    const expected = {
      checks: [
        { id: "bullets", type: "exact_bullet_count" as const, count: 2 },
        { id: "phrase", type: "required_phrase" as const, phrase: "meeting notes" },
      ],
    };
    const output = { response: "- First point\n- Second point" };
    const promptScore = await ifevalPromptLevel.evaluate({ input: {}, output, expected });
    const instructionScore = await ifevalInstructionLevel.evaluate({ input: {}, output, expected });
    expect(promptScore.score).toBe(0);
    expect(promptScore.label).toBe("fail");
    expect(instructionScore.score).toBe(0.5);
    expect(instructionScore.label).toBe("partial");
    expect(instructionScore.explanation).toContain("phrase=fail");
  });
});
