import { createDataset } from "@arizeai/phoenix-client/datasets";
import { BENCHMARK_GROUPS, getDatasetName } from "../data/baseline.js";
import { loadConfig } from "./config.js";

const { client, datasetPrefix } = loadConfig();
const availableGroupIds = BENCHMARK_GROUPS.map((group) => group.id);
const requestedGroups = process.argv.find((arg) => arg.startsWith("--groups="))?.split("=")[1];
const groups = requestedGroups
  ? requestedGroups.split(",").map((value) => value.trim()).filter(Boolean)
  : availableGroupIds;
const unknownGroups = groups.filter((group) => !availableGroupIds.includes(group as (typeof availableGroupIds)[number]));
if (groups.length === 0 || unknownGroups.length > 0) {
  throw new Error(`Unknown or empty benchmark group selection. Available groups: ${availableGroupIds.join(", ")}.`);
}
const selectedGroups = BENCHMARK_GROUPS.filter((group) => groups.includes(group.id));

for (const group of selectedGroups) {
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
