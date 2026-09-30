import { createDataset } from "@arizeai/phoenix-client/datasets";
import { BENCHMARK_GROUPS, getDatasetName } from "../data/baseline.js";
import { loadConfig } from "./config.js";

const { client, datasetPrefix } = loadConfig();

for (const group of BENCHMARK_GROUPS) {
  const { datasetId } = await createDataset({
    client,
    name: getDatasetName(group, datasetPrefix),
    description: `${group.description} Dataset version: v1. Cases: ${group.cases.length}.`,
    examples: group.cases.map((example) => ({
      id: example.id,
      input: { prompt: example.prompt },
      output: example.expected,
      metadata: { ...example.metadata, benchmark_version: "v1" },
    })),
  });
  console.log(`${group.id}: ${getDatasetName(group, datasetPrefix)} (${datasetId}) — ${group.cases.length} cases`);
}

console.log("Datasets are ready. Configure the Phoenix UI evaluators described in README.md before running the benchmark.");
