import "dotenv/config";

import { createClient } from "@arizeai/phoenix-client";

export type AppConfig = {
  baseUrl: string;
  datasetPrefix: string;
  evalTimeoutMs: number;
  client: ReturnType<typeof createClient>;
};

/** Load local configuration and construct an authenticated Phoenix client. */
export function loadConfig(): AppConfig {
  const baseUrl = (process.env.PHOENIX_BASE_URL ?? "http://localhost:6006").replace(/\/$/, "");
  const datasetPrefix = process.env.PHOENIX_DATASET_PREFIX ?? "prompt-api-demo";
  const evalTimeoutMs = Number(process.env.PHOENIX_EVAL_TIMEOUT_MS ?? 180_000);
  if (!Number.isFinite(evalTimeoutMs) || evalTimeoutMs < 1_000) {
    throw new Error("PHOENIX_EVAL_TIMEOUT_MS must be at least 1000.");
  }
  const apiKey = process.env.PHOENIX_API_KEY;
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const client = createClient({ options: { baseUrl, ...(headers ? { headers } : {}) } });
  return { baseUrl, datasetPrefix, evalTimeoutMs, client };
}
