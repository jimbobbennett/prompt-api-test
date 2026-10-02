import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataset } from "@arizeai/phoenix-client/datasets";
import { loadConfig } from "./config.js";

const { client, baseUrl, datasetPrefix } = loadConfig();
const datasetName = `${datasetPrefix}-cross-browser-quality-v1`;
const apiKey = process.env.PHOENIX_API_KEY;
const modelProvider = (process.env.PHOENIX_JUDGE_MODEL_PROVIDER ?? "OPENAI").toUpperCase();
const modelName = process.env.PHOENIX_JUDGE_MODEL_NAME ?? "gpt-6-luna";

const supportedProviders = new Set([
  "ANTHROPIC", "AWS", "AZURE_OPENAI", "CEREBRAS", "DEEPSEEK", "FIREWORKS", "GOOGLE",
  "GROQ", "META", "MINIMAX", "MOONSHOT", "OLLAMA", "OPENAI", "PERPLEXITY", "TOGETHER", "XAI", "ZAI",
]);
if (!supportedProviders.has(modelProvider)) {
  throw new Error(`Unsupported Phoenix judge provider '${modelProvider}'. Set a provider configured in Phoenix.`);
}

type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string }> };
async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(new URL("/graphql", baseUrl), {
    method: "POST", headers, body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Phoenix GraphQL request failed (${response.status}): ${await response.text()}`);
  const body = await response.json() as GraphQLResponse<T>;
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  if (!body.data) throw new Error("Phoenix GraphQL response did not contain data.");
  return body.data;
}

const criteria = [
  { key: "task_success", promptFile: "task-success.md", description: "Proposed 1–5 judge rubric for task success." },
  { key: "formatting", promptFile: "formatting.md", description: "Proposed 1–5 judge rubric for formatting quality." },
  { key: "intent_understanding", promptFile: "intent-understanding.md", description: "Proposed 1–5 judge rubric for intent understanding." },
  { key: "clarity_coherence", promptFile: "clarity-coherence.md", description: "Proposed 1–5 judge rubric for clarity and coherence." },
  { key: "language", promptFile: "language.md", description: "Proposed 1–5 judge rubric for language quality." },
  { key: "factuality", promptFile: "factuality.md", description: "Proposed 1–5 judge rubric for factuality." },
  { key: "introductory_sentence", promptFile: "introductory-sentence.md", description: "Proposed 1–5 judge rubric for the introductory sentence." },
  { key: "groundedness", promptFile: "groundedness.md", description: "Proposed 1–5 judge rubric for groundedness in the supplied prompt." },
  { key: "label_correctness", promptFile: "label-correctness.md", description: "Proposed 1–5 judge rubric for requested label correctness." },
] as const;

type Browser = "chrome" | "edge";
const browsers: Browser[] = ["chrome", "edge"];
const judgeSpecs = browsers.flatMap((browser) => criteria.map((criterion) => ({
  name: `${browser}_${criterion.key}_v1`,
  description: `${criterion.description} Browser response: ${browser}. The sheet did not include the original rating rubric; this is a documented proposed rubric.`,
  promptFile: criterion.promptFile,
  pathMapping: {
    prompt: "input.prompt",
    response: `output.${browser}.response`,
  },
})));
judgeSpecs.push({
  name: "response_similarity_v1",
  description: "Proposed 1–5 judge rubric comparing the Chrome and Edge responses. The sheet did not include the original similarity rubric.",
  promptFile: "similarity.md",
  pathMapping: {
    prompt: "input.prompt",
    chrome_response: "output.chrome.response",
    edge_response: "output.edge.response",
  },
});

const dataset = await getDataset({ client, dataset: { datasetName } });
const existing = await graphql<{
  node: { datasetEvaluators?: { edges: Array<{ node: { name: string } }> } } | null;
}>(`query DatasetEvaluatorNames($id: ID!) {
  node(id: $id) { ... on Dataset { datasetEvaluators(first: 100) { edges { node { name } } } } }
}`, { id: dataset.id });
if (!existing.node?.datasetEvaluators) throw new Error(`Could not read evaluators for Phoenix dataset '${datasetName}'.`);
const existingNames = new Set(existing.node.datasetEvaluators.edges.map(({ node }) => node.name));

function invocationParameters() {
  if (modelProvider === "ANTHROPIC") return { anthropic: { maxTokens: 512, temperature: 0 } };
  if (modelProvider === "GOOGLE") return { google: { maxOutputTokens: 512, temperature: 0 } };
  if (modelProvider === "AWS") return { aws: { maxTokens: 512, temperature: 0 } };
  return { openai: { maxTokens: 512 } };
}

const scoreLabels = ["1", "2", "3", "4", "5", "not_applicable"];
function buildLlmEvaluator(name: string, description: string, prompt: string) {
  return {
    name,
    description,
    outputConfigs: [{ categorical: {
      name,
      description: "Judge score from 1 (poor) to 5 (excellent); not_applicable has no numeric score.",
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
        name,
        description,
        parameters: {
          type: "object",
          properties: {
            label: { type: "string", enum: scoreLabels, description: name },
            explanation: { type: "string", description: "Brief evidence-based reason for the rating" },
          },
          required: ["label", "explanation"],
        },
        strict: null,
      } }], toolChoice: { oneOrMore: true } },
      responseFormat: null,
    },
  };
}

for (const spec of judgeSpecs) {
  if (existingNames.has(spec.name)) {
    console.log(`${datasetName}: '${spec.name}' already exists; left unchanged.`);
    continue;
  }
  const prompt = (await readFile(join(process.cwd(), "prompts", "cross-browser", spec.promptFile), "utf8")).trim();
  const input = {
    ...buildLlmEvaluator(spec.name, spec.description, prompt),
    datasetId: dataset.id,
    inputMapping: { literalMapping: {}, pathMapping: spec.pathMapping },
    promptVersionId: null,
  };
  const result = await graphql<{ createDatasetLlmEvaluator: { evaluator: { id: string; name: string } } }>(
    `mutation CreateDatasetJudge($input: CreateDatasetLLMEvaluatorInput!) {
      createDatasetLlmEvaluator(input: $input) { evaluator { id name } }
    }`, { input });
  const created = result.createDatasetLlmEvaluator.evaluator;
  existingNames.add(created.name);
  console.log(`Created judge '${created.name}' (${created.id}) with ${modelProvider}/${modelName}.`);
}

const builtins = await graphql<{ builtInEvaluators: Array<{ id: string; name: string }> }>(
  `query BuiltInEvaluators { builtInEvaluators { id name } }`);
const regexEvaluator = builtins.builtInEvaluators.find(({ name }) => name.toLowerCase() === "regex");
if (!regexEvaluator) throw new Error("Phoenix does not expose the built-in regex evaluator.");

for (const browser of browsers) {
  const name = `${browser}_double_punctuation_v1`;
  if (existingNames.has(name)) {
    console.log(`${datasetName}: '${name}' already exists; left unchanged.`);
    continue;
  }
  const result = await graphql<{ createDatasetBuiltinEvaluator: { evaluator: { id: string; name: string } } }>(
    `mutation CreateDatasetBuiltin($input: CreateDatasetBuiltinEvaluatorInput!) {
      createDatasetBuiltinEvaluator(input: $input) { evaluator { id name } }
    }`,
    { input: {
      datasetId: dataset.id,
      evaluatorId: regexEvaluator.id,
      name,
      description: "Code-based check for repeated terminal punctuation (two or more consecutive periods, exclamation marks, or question marks).",
      inputMapping: {
        literalMapping: { pattern: "[.!?]{2,}", full_match: false },
        pathMapping: { text: `output.${browser}.response` },
      },
      outputConfigs: [{ categorical: {
        name,
        description: "Whether the browser response contains repeated consecutive punctuation.",
        optimizationDirection: "MINIMIZE",
        values: [{ label: "true", score: 1 }, { label: "false", score: 0 }],
      } }],
    } });
  const created = result.createDatasetBuiltinEvaluator.evaluator;
  existingNames.add(created.name);
  console.log(`Created code evaluator '${created.name}' (${created.id}).`);
}

console.log(`Evaluator setup complete for '${datasetName}'. These evaluators are attached to the dataset and will score future Phoenix experiments.`);
