import { getDatasetExamples } from "@arizeai/phoenix-client/datasets";
import { runExperiment } from "@arizeai/phoenix-client/experiments";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BENCHMARK_GROUPS, getDatasetName } from "../data/baseline.js";
import { openChat, askInNewChat, type BrowserChannel } from "./browser-chat.js";
import { loadConfig } from "./config.js";
import { jsonSchemaValid, receiptValuesCorrect } from "./evaluators.js";
import { buildInlineJudge, JUDGE_SPECS, readJudgePrompt } from "./judge-config.js";

const { client, baseUrl, datasetPrefix, evalTimeoutMs } = loadConfig();
const apiKey = process.env.PHOENIX_API_KEY;
const judgeModelProvider = process.env.PHOENIX_JUDGE_MODEL_PROVIDER?.toUpperCase() ?? "OPENAI";
const judgeModelName = process.env.PHOENIX_JUDGE_MODEL_NAME ?? "gpt-6-luna";
const requested = process.argv.find((arg) => arg.startsWith("--browsers="))?.split("=")[1] ?? "chrome,msedge";
const browsers = requested.split(",").map((value) => value.trim()).filter(Boolean) as BrowserChannel[];
if (browsers.some((browser) => !["chrome", "msedge"].includes(browser))) {
  throw new Error("Supported browser channels are chrome and msedge. Example: pnpm eval -- --browsers=chrome,msedge");
}

const reports: Array<Record<string, unknown>> = [];

async function runPhoenixJudge({ spec, experimentRunId, input, output, reference, metadata }: {
  spec: (typeof JUDGE_SPECS)[number];
  experimentRunId: string;
  input: Record<string, unknown>;
  output: unknown;
  reference: Record<string, unknown> | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const prompt = await readJudgePrompt(spec);
  const response = await fetch(new URL("/graphql", baseUrl), {
    method: "POST", headers,
    signal: AbortSignal.timeout(evalTimeoutMs),
    body: JSON.stringify({
      query: `mutation RunJudge($input: EvaluatorPreviewsInput!) {
        evaluatorPreviews(input: $input) {
          results { evaluatorName error annotation { name score label explanation } }
        }
      }`,
      variables: {
        input: {
          previews: [{
            evaluator: { inlineLlmEvaluator: buildInlineJudge(spec, prompt, judgeModelProvider, judgeModelName) },
            context: { input, output, reference: reference ?? {}, metadata: metadata ?? {} },
            inputMapping: {
              literalMapping: {},
              pathMapping: {
                original_prompt: "input.prompt",
                answer: "output.response",
                criteria: spec.criterionPath,
              },
            },
          }],
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Phoenix evaluator request failed (${response.status}): ${await response.text()}`);
  const body = await response.json() as {
    data?: { evaluatorPreviews?: { results?: Array<{ evaluatorName: string; error: string | null; annotation: { name: string; score: number | null; label: string | null; explanation: string | null } | null }> } };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) throw new Error(`Phoenix evaluator request failed: ${body.errors.map((error) => error.message).join("; ")}`);
  const judgeResult = body.data?.evaluatorPreviews?.results?.[0];
  if (!judgeResult) throw new Error(`Phoenix did not return a result for '${spec.evaluatorName}'.`);
  if (judgeResult.error) throw new Error(`Phoenix judge '${spec.evaluatorName}' failed: ${judgeResult.error}`);
  if (!judgeResult.annotation) throw new Error(`Phoenix judge '${spec.evaluatorName}' returned no annotation.`);

  const now = new Date().toISOString();
  const recorded = await fetch(new URL("/v1/experiment_evaluations", baseUrl), {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(evalTimeoutMs),
    body: JSON.stringify({
      experiment_run_id: experimentRunId,
      name: judgeResult.annotation.name,
      annotator_kind: "LLM",
      start_time: now,
      end_time: now,
      result: {
        score: judgeResult.annotation.score,
        label: judgeResult.annotation.label,
        explanation: judgeResult.annotation.explanation,
      },
      metadata: { model_provider: judgeModelProvider, model_name: judgeModelName },
    }),
  });
  if (!recorded.ok) throw new Error(`Failed to record '${spec.evaluatorName}' on the Phoenix experiment (${recorded.status}): ${await recorded.text()}`);
  return {
    evaluator: judgeResult.annotation.name,
    score: judgeResult.annotation.score,
    label: judgeResult.annotation.label,
    explanation: judgeResult.annotation.explanation,
  };
}

for (const browser of browsers) {
  const { page, close } = await openChat(browser, baseUrl);
  try {
    for (const group of BENCHMARK_GROUPS) {
      const datasetName = getDatasetName(group, datasetPrefix);
      const { examples, versionId } = await getDatasetExamples({ client, dataset: { datasetName } });
      if (examples.length !== group.cases.length) {
        throw new Error(`${datasetName}: expected ${group.cases.length} dataset examples, found ${examples.length}; run pnpm seed.`);
      }
      const startedAt = new Date().toISOString();
      const experiment = await runExperiment({
        client,
        experimentName: `${group.id}-${browser}-${new Date().toISOString().replaceAll(":", "-")}`,
        experimentDescription: `Prompt API browser benchmark, ${group.id}, ${browser}, dataset v1.`,
        experimentMetadata: {
          benchmark: "prompt-api-demo",
          benchmarkVersion: "v1",
          group: group.id,
          browser,
          channel: browser,
          model: "phoenix-browser-ai",
          datasetName,
          datasetVersionId: versionId,
          startedAt,
        },
        dataset: { datasetName },
        concurrency: 1,
        task: async (example) => {
          const prompt = example.input.prompt;
          if (typeof prompt !== "string") throw new Error(`Example ${example.id} has no prompt string.`);
          const answer = await askInNewChat(page, prompt);
          reports.push({ group: group.id, browser, exampleId: example.id, ...answer });
          return answer;
        },
        evaluators: group.id === "receipt-extraction" ? [jsonSchemaValid, receiptValuesCorrect] : [],
      });
      console.log(`${group.id} / ${browser}: ${experiment.successfulRunCount}/${experiment.exampleCount} runs; experiment ${experiment.id}`);
      const caseIdByDatasetExampleId = new Map(examples.map((example) => [example.nodeId ?? example.id, example.id]));
      const caseIdByRunId = new Map(Object.values(experiment.runs).map((run) => [
        run.id,
        caseIdByDatasetExampleId.get(run.datasetExampleId) ?? run.datasetExampleId,
      ]));
      for (const evaluation of experiment.evaluationRuns ?? []) {
        reports.push({
          group: group.id,
          browser,
          exampleId: caseIdByRunId.get(evaluation.experimentRunId) ?? "unknown",
          evaluator: evaluation.name,
          score: evaluation.result?.score ?? null,
          label: evaluation.result?.label ?? null,
          explanation: evaluation.result?.explanation ?? null,
        });
      }
      if (group.phoenixJudgeName) {
        const judgeSpec = JUDGE_SPECS.find((spec) => spec.evaluatorName === group.phoenixJudgeName);
        if (!judgeSpec) throw new Error(`No prompt configuration found for Phoenix judge '${group.phoenixJudgeName}'.`);
        for (const example of examples) {
          const datasetExampleId = example.nodeId ?? example.id;
          const run = Object.values(experiment.runs).find((candidate) => candidate.datasetExampleId === datasetExampleId);
          if (!run) throw new Error(`Could not find the Phoenix experiment run for dataset example ${example.id}.`);
          const score = await runPhoenixJudge({
            spec: judgeSpec,
            experimentRunId: run.id,
            input: example.input,
            output: run.output,
            reference: example.output,
            metadata: example.metadata,
          });
          reports.push({ group: group.id, browser, exampleId: example.id, ...score });
          console.log(`${group.id} / ${browser} / ${example.id}: ${score.evaluator}=${score.label} (${score.score ?? "no score"})`);
        }
      }
    }
  } finally {
    await close();
  }
}

const reportDir = join(process.cwd(), "results");
await mkdir(reportDir, { recursive: true });
const reportFile = join(reportDir, `benchmark-${new Date().toISOString().replaceAll(":", "-")}.json`);
const scoreGroups = new Map<string, number[]>();
for (const row of reports) {
  const evaluator = row.evaluator;
  const score = row.score;
  if (typeof evaluator !== "string" || typeof score !== "number") continue;
  const key = `${String(row.group)}:${String(row.browser)}:${evaluator}`;
  scoreGroups.set(key, [...(scoreGroups.get(key) ?? []), score]);
}
const summary = [...scoreGroups].map(([key, scores]) => ({
  group: key.split(":")[0],
  browser: key.split(":")[1],
  evaluator: key.split(":").slice(2).join(":"),
  scoredCases: scores.length,
  meanScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
}));
await writeFile(reportFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), browsers, summary, cases: reports }, null, 2)}\n`);
console.log(`Browser timing report written to ${reportFile}`);
