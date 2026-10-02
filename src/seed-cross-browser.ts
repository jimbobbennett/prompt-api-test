import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDataset } from "@arizeai/phoenix-client/datasets";
import { loadConfig } from "./config.js";

const SOURCE_URL = "https://docs.google.com/spreadsheets/d/1dIeO5oyMF59UeYW6eMKX3PU73TH3IDtotSGdnGzsb9U/edit?gid=0#gid=0";
const SOURCE_TITLE = "Chrome Built-in AI cross-browser quality test data set";
const CSV_PATH = resolve("data/chrome-built-in-ai-cross-browser.csv");
const SCORE_NAMES = [
  "task_success",
  "formatting",
  "intent_understanding",
  "clarity_coherence",
  "language",
  "factuality",
  "introductory_sentence",
  "groundedness",
  "label_correctness",
] as const;

/** Parse RFC 4180-style CSV, including quoted commas and newlines. */
function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (quoted) throw new Error("CSV ended inside a quoted field.");
  return rows;
}

function valueAt(row: string[], index: number): string | null {
  const value = row[index]?.trim() ?? "";
  return value === "" ? null : value;
}

function parseAnnotation(value: string | null): string | number | boolean | null {
  if (value === null) return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  return value;
}

function scoreSet(row: string[], start: number): Record<string, string | number | null> {
  return Object.fromEntries(
    SCORE_NAMES.map((name, offset) => [name, parseAnnotation(valueAt(row, start + offset))])
  );
}

const { client, datasetPrefix } = loadConfig();
const csv = (await readFile(CSV_PATH, "utf8")).replace(/^\uFEFF/, "");
const rows = parseCsv(csv);
// The source export begins with a merged title row; its second row contains column names.
const examples = rows.slice(2).filter((row) => row.some((value) => value.trim() !== "")).map((row, index) => {
  const prompt = valueAt(row, 3);
  const chromeResponse = valueAt(row, 5);
  const edgeResponse = valueAt(row, 6);
  if (!prompt || chromeResponse === null || edgeResponse === null) {
    throw new Error(`Source row ${index + 3} is missing a prompt or browser response.`);
  }

  return {
    id: `chrome-built-in-ai-${String(index + 1).padStart(4, "0")}`,
    input: {
      prompt,
      api: valueAt(row, 4),
      use_case: valueAt(row, 1),
      rubric_category: valueAt(row, 2),
    },
    output: {
      chrome: { response: chromeResponse, source_scores: scoreSet(row, 7), average_score: parseAnnotation(valueAt(row, 27)) },
      edge: { response: edgeResponse, source_scores: scoreSet(row, 16), average_score: parseAnnotation(valueAt(row, 28)) },
      comparison: {
        similarity_score: parseAnnotation(valueAt(row, 25)),
        comment: valueAt(row, 26),
        double_punctuations: parseAnnotation(valueAt(row, 29)),
        unlabeled_source_value: parseAnnotation(valueAt(row, 30)),
      },
    },
    metadata: {
      source_title: SOURCE_TITLE,
      source_url: SOURCE_URL,
      source_sheet_gid: "0",
      source_row: index + 3,
      evaluator: valueAt(row, 0),
      benchmark_version: "source-snapshot-2026-10-01",
    },
  };
});

if (examples.length !== 200) {
  throw new Error(`Expected 200 data rows in the source snapshot, found ${examples.length}. Check the CSV before importing.`);
}

const datasetName = `${datasetPrefix}-cross-browser-quality-v1`;
const { datasetId } = await createDataset({
  client,
  name: datasetName,
  description: `${SOURCE_TITLE}. Imported from the publicly shared spreadsheet export. Includes 200 prompt/response pairs and the source's browser ratings and comparison annotations. These source ratings are retained as annotations, not treated as ground truth. Source: ${SOURCE_URL}`,
  examples,
});
console.log(`${datasetName}: ${datasetId} — ${examples.length} examples`);
console.log("Repeated runs update this dataset to match the checked-in CSV snapshot.");
