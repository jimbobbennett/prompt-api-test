import { readFile } from "node:fs/promises";
import { getDatasetExamples } from "@arizeai/phoenix-client/datasets";
import { asExperimentEvaluator, runExperiment } from "@arizeai/phoenix-client/experiments";
import { loadConfig } from "./config.js";

const { client, baseUrl, datasetPrefix, evalTimeoutMs } = loadConfig();
const datasetName = `${datasetPrefix}-cross-browser-quality-v1`;
const apiKey = process.env.PHOENIX_API_KEY;
const modelProvider = (process.env.PHOENIX_JUDGE_MODEL_PROVIDER ?? "OPENAI").toUpperCase();
const modelName = process.env.PHOENIX_JUDGE_MODEL_NAME ?? "gpt-6-luna";
const requestedConcurrency = Number(process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] ?? 3);
if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > 8) {
  throw new Error("--concurrency must be an integer from 1 to 8 (default: 3).");
}

const criteria = [
  { key: "task_success", promptFile: "task-success.md" },
  { key: "formatting", promptFile: "formatting.md" },
  { key: "intent_understanding", promptFile: "intent-understanding.md" },
  { key: "clarity_coherence", promptFile: "clarity-coherence.md" },
  { key: "language", promptFile: "language.md" },
  { key: "factuality", promptFile: "factuality.md" },
  { key: "introductory_sentence", promptFile: "introductory-sentence.md" },
  { key: "groundedness", promptFile: "groundedness.md" },
  { key: "label_correctness", promptFile: "label-correctness.md" },
] as const;
const browserSpecs = (["chrome", "edge"] as const).flatMap((browser) =>
  criteria.map((criterion) => ({
    name: `${browser}_${criterion.key}_v1`,
    promptFile: criterion.promptFile,
    pathMapping: { prompt: "input.prompt", response: `output.${browser}.response` },
  }))
);
const judgeSpecs = [
  ...browserSpecs,
  {
    name: "response_similarity_v1",
    promptFile: "similarity.md",
    pathMapping: {
      prompt: "input.prompt",
      chrome_response: "output.chrome.response",
      edge_response: "output.edge.response",
    },
  },
];

function invocationParameters() {
  if (modelProvider === "ANTHROPIC") return { anthropic: { maxTokens: 512, temperature: 0 } };
  if (modelProvider === "GOOGLE") return { google: { maxOutputTokens: 512, temperature: 0 } };
  if (modelProvider === "AWS") return { aws: { maxTokens: 512, temperature: 0 } };
  return { openai: { maxTokens: 512 } };
}

type JudgeSpec = (typeof judgeSpecs)[number];
type GraphQLBody = {
  data?: { evaluatorPreviews?: { results?: Array<{ evaluatorName: string; error: string | null; annotation: { name: string; score: number | null; label: string | null; explanation: string | null } | null }> } };
  errors?: Array<{ message: string }>;
};

async function previewJudge(spec: JudgeSpec, prompt: string, context: Record<string, unknown>) {
  const description = `Proposed 1–5 rubric judge ${spec.name}; source spreadsheet rubric was unavailable.`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(new URL("/graphql", baseUrl), {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(evalTimeoutMs),
    body: JSON.stringify({
      query: `mutation RunCrossBrowserJudge($input: EvaluatorPreviewsInput!) {
        evaluatorPreviews(input: $input) {
          results { evaluatorName error annotation { name score label explanation } }
        }
      }`,
      variables: {
        input: {
          previews: [{
            evaluator: { inlineLlmEvaluator: {
              name: spec.name,
              description,
              outputConfigs: [{ categorical: {
                name: spec.name,
                description: `Score from 1 to 5, or not_applicable, for ${spec.name}.`,
                optimizationDirection: "MAXIMIZE",
                values: [...[1, 2, 3, 4, 5].map((score) => ({ label: String(score), score })), { label: "not_applicable" }],
              } }],
              promptVersion: {
                modelProvider,
                modelName,
                invocationParameters: invocationParameters(),
                templateFormat: "MUSTACHE",
                template: { messages: [{ role: "USER", content: [{ text: { text: prompt } }] }] },
                tools: { tools: [{ function: {
                  name: spec.name,
                  description,
                  parameters: {
                    type: "object",
                    properties: {
                      label: { type: "string", enum: ["1", "2", "3", "4", "5", "not_applicable"], description: spec.name },
                      explanation: { type: "string", description: "Brief evidence-based reason for the rating" },
                    },
                    required: ["label", "explanation"],
                  },
                  strict: null,
                } }], toolChoice: { oneOrMore: true } },
                responseFormat: null,
              },
            } },
            context,
            inputMapping: { literalMapping: {}, pathMapping: spec.pathMapping },
          }],
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`${spec.name} preview failed (${response.status}): ${await response.text()}`);
  const body = await response.json() as GraphQLBody;
  if (body.errors?.length) throw new Error(`${spec.name} preview failed: ${body.errors.map((error) => error.message).join("; ")}`);
  const result = body.data?.evaluatorPreviews?.results?.[0];
  if (!result) throw new Error(`${spec.name} preview returned no result.`);
  if (result.error) throw new Error(`${spec.name} judge failed: ${result.error}`);
  if (!result.annotation) throw new Error(`${spec.name} judge returned no annotation.`);
  return {
    score: result.annotation.score,
    label: result.annotation.label,
    explanation: result.annotation.explanation,
    metadata: { model_provider: modelProvider, model_name: modelName, rubric_version: "proposed-v1" },
  };
}

const evaluators = await Promise.all(judgeSpecs.map(async (spec) => {
  const evaluatorPrompt = (await readFile(new URL(`../prompts/cross-browser/${spec.promptFile}`, import.meta.url), "utf8")).trim();
  const description = `Proposed 1–5 rubric judge ${spec.name}; source spreadsheet rubric was unavailable.`;
  return asExperimentEvaluator({
    name: spec.name,
    kind: "LLM",
    evaluate: async ({ input, output, expected, metadata }) => previewJudge(spec, evaluatorPrompt, {
      input,
      output,
      reference: expected ?? {},
      metadata: metadata ?? {},
    }),
  });
}));

for (const browser of ["chrome", "edge"] as const) {
  evaluators.push(asExperimentEvaluator({
    name: `${browser}_double_punctuation_v1`,
    kind: "CODE",
    evaluate: async ({ output }) => {
      if (typeof output !== "object" || output === null || !(browser in output)) {
        return { score: 0, label: "missing_response", explanation: `Missing ${browser} response.` };
      }
      const browserOutput = (output as Record<string, unknown>)[browser];
      const response = typeof browserOutput === "object" && browserOutput !== null
        ? (browserOutput as Record<string, unknown>).response
        : null;
      if (typeof response !== "string") return { score: 0, label: "missing_response", explanation: `Missing ${browser} response string.` };
      const hasDoublePunctuation = /[.!?]{2,}/u.test(response);
      return {
        score: hasDoublePunctuation ? 1 : 0,
        label: String(hasDoublePunctuation),
        explanation: hasDoublePunctuation ? "Found consecutive terminal punctuation." : "No consecutive terminal punctuation found.",
      };
    },
  }));
}

const { examples, versionId } = await getDatasetExamples({ client, dataset: { datasetName } });
if (examples.length !== 200) throw new Error(`Expected 200 examples; found ${examples.length}. Run pnpm seed:cross-browser first.`);
const experimentName = `cross-browser-sheet-replay-${new Date().toISOString().replaceAll(":", "-")}`;
console.log(`Running ${experimentName}: ${examples.length} saved response pairs, ${evaluators.length} evaluators, judge model ${modelProvider}/${modelName}.`);
console.log("This makes 3,800 LLM judge calls. Browser models are not invoked; the saved sheet responses are replayed.");

const experiment = await runExperiment({
  client,
  experimentName,
  experimentDescription: "Re-score the saved Chrome and Edge responses from the proposal spreadsheet using the attached proposed Phoenix evaluators.",
  experimentMetadata: {
    benchmark: "chrome-built-in-ai-cross-browser-sheet",
    rubricVersion: "proposed-v1",
    sourceDatasetVersionId: versionId,
    judgeModelProvider: modelProvider,
    judgeModelName: modelName,
    browserGeneration: "replay-source-responses",
  },
  dataset: { datasetName },
  concurrency: requestedConcurrency,
  task: async (example) => example.output ?? {},
  evaluators,
});

console.log(`Experiment complete: ${experiment.id}`);
console.log(`Successful task runs: ${experiment.successfulRunCount}; failed task runs: ${experiment.failedRunCount}.`);
console.log(`Evaluation records returned by SDK: ${experiment.evaluationRuns?.length ?? 0}.`);
console.log(`Open Phoenix at ${baseUrl}/datasets/${encodeURIComponent(datasetName)}/experiments to inspect scores.`);
