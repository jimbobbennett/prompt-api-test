import { getDataset } from "@arizeai/phoenix-client/datasets";
import { BENCHMARK_GROUPS, getDatasetName } from "../data/baseline.js";
import { loadConfig } from "./config.js";
import { buildInlineJudge, JUDGE_SPECS, readJudgePrompt } from "./judge-config.js";

const { client, baseUrl, datasetPrefix } = loadConfig();
const apiKey = process.env.PHOENIX_API_KEY;
const modelProvider = process.env.PHOENIX_JUDGE_MODEL_PROVIDER?.toUpperCase();
const modelName = process.env.PHOENIX_JUDGE_MODEL_NAME;
if (!modelProvider || !modelName) {
  throw new Error("Set PHOENIX_JUDGE_MODEL_PROVIDER and PHOENIX_JUDGE_MODEL_NAME in .env to a model configured in Phoenix.");
}

const supportedProviders = new Set([
  "ANTHROPIC", "AWS", "AZURE_OPENAI", "CEREBRAS", "DEEPSEEK", "FIREWORKS", "GOOGLE",
  "GROQ", "META", "MINIMAX", "MOONSHOT", "OLLAMA", "OPENAI", "PERPLEXITY", "TOGETHER", "XAI", "ZAI",
]);
if (!supportedProviders.has(modelProvider)) {
  throw new Error(`Unsupported Phoenix judge provider '${modelProvider}'. Set a provider key supported by Phoenix.`);
}

type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string }> };
async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(new URL("/graphql", baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Phoenix GraphQL request failed (${response.status}): ${await response.text()}`);
  const body = await response.json() as GraphQLResponse<T>;
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  if (!body.data) throw new Error("Phoenix GraphQL response did not contain data.");
  return body.data;
}

for (const spec of JUDGE_SPECS) {
  const group = BENCHMARK_GROUPS.find((candidate) => candidate.id === spec.groupId);
  if (!group) throw new Error(`Missing benchmark group '${spec.groupId}'.`);
  const datasetName = getDatasetName(group, datasetPrefix);
  const dataset = await getDataset({ client, dataset: { datasetName } });
  const prompt = await readJudgePrompt(spec);

  const existing = await graphql<{
    node: { datasetEvaluators?: { edges: Array<{ node: { name: string } }> } } | null;
  }>(
    `query DatasetEvaluatorNames($id: ID!) {
      node(id: $id) { ... on Dataset {
        datasetEvaluators(first: 100) { edges { node { name } } }
      } }
    }`,
    { id: dataset.id },
  );
  if (!existing.node?.datasetEvaluators) throw new Error(`Could not read evaluators for Phoenix dataset '${datasetName}'.`);
  if (existing.node.datasetEvaluators.edges.some(({ node }) => node.name === spec.evaluatorName)) {
    console.log(`${datasetName}: '${spec.evaluatorName}' already exists; left unchanged.`);
    continue;
  }

  const input = {
    ...buildInlineJudge(spec, prompt, modelProvider, modelName),
    datasetId: dataset.id,
    inputMapping: {
      literalMapping: {},
      pathMapping: {
        original_prompt: "input.prompt",
        answer: "output.response",
        criteria: spec.criterionPath,
      },
    },
    promptVersionId: null,
  };
  const created = await graphql<{
    createDatasetLlmEvaluator: { evaluator: { id: string; name: string } };
  }>(
    `mutation CreateDatasetJudge($input: CreateDatasetLLMEvaluatorInput!) {
      createDatasetLlmEvaluator(input: $input) { evaluator { id name } }
    }`,
    { input },
  );
  const evaluator = created.createDatasetLlmEvaluator.evaluator;
  console.log(`${datasetName}: created '${evaluator.name}' (${evaluator.id}) using ${modelProvider}/${modelName}`);
}
