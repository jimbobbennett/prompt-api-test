import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const JUDGE_SPECS = [
  {
    groupId: "intent-task-success",
    evaluatorName: "task_success",
    promptFile: "task-success.md",
    criterionKey: "success_criteria",
    criterionPath: "reference.success_criteria",
    description: "Grades whether a Prompt API response meets its task-specific success criteria.",
  },
  {
    groupId: "safety",
    evaluatorName: "safety_appropriate",
    promptFile: "safety-appropriate.md",
    criterionKey: "expected_behavior",
    criterionPath: "reference.expected_behavior",
    description: "Grades safe handling of the request against case-specific expected behavior.",
  },
] as const;

export type JudgeSpec = (typeof JUDGE_SPECS)[number];

export async function readJudgePrompt(spec: JudgeSpec): Promise<string> {
  return (await readFile(join(process.cwd(), "prompts", spec.promptFile), "utf8")).trim();
}

export function buildInlineJudge(spec: JudgeSpec, prompt: string, modelProvider: string, modelName: string) {
  const invocationParameters = modelProvider === "ANTHROPIC"
    ? { anthropic: { maxTokens: 512, temperature: 0 } }
    : modelProvider === "GOOGLE"
      ? { google: { maxOutputTokens: 512, temperature: 0 } }
      : modelProvider === "AWS"
        ? { aws: { maxTokens: 512, temperature: 0 } }
        : { openai: { maxTokens: 512 } };
  return {
    name: spec.evaluatorName,
    description: spec.description,
    outputConfigs: [{
      categorical: {
        name: spec.evaluatorName,
        description: spec.description,
        optimizationDirection: "MAXIMIZE",
        values: [{ label: "pass", score: 1 }, { label: "fail", score: 0 }],
      },
    }],
    promptVersion: {
      modelProvider,
      modelName,
      invocationParameters,
      templateFormat: "MUSTACHE",
      template: { messages: [{ role: "USER", content: [{ text: { text: prompt } }] }] },
      tools: {
        tools: [{ function: {
          name: spec.evaluatorName,
          description: spec.description,
          parameters: {
            type: "object",
            properties: {
              label: { type: "string", enum: ["pass", "fail"], description: spec.evaluatorName },
              explanation: { type: "string", description: `Reason for the ${spec.evaluatorName} label` },
            },
            required: ["label", "explanation"],
          },
          strict: null,
        } }],
        toolChoice: { oneOrMore: true },
      },
      responseFormat: null,
    },
  };
}
