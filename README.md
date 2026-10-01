# Phoenix Prompt API Benchmark

A small, inspectable demo for evaluating Chrome’s built-in Gemini Nano model through Phoenix Chat. The runner starts Google Chrome in new headless mode and attaches Playwright over CDP. Phoenix stores the datasets and experiments, and the runner writes a local JSON report with per-case timing and scores.

This is a harness demonstration, not a statistically representative model benchmark. The original groups contain five examples each; the IFEval-style group contains 24.

## What it evaluates

| Dataset group | Browser model | Evaluator(s) |
| --- | --- | --- |
| Receipt extraction | Chrome: Gemini Nano | `json_schema_valid` and `receipt_values_correct` (TypeScript code evaluators) |
| Intent / task success | Chrome: Gemini Nano | `task_success` (Phoenix LLM judge) |
| Instruction following (IFEval-style) | Chrome: Gemini Nano | `ifeval_prompt_level` and `ifeval_instruction_level` (TypeScript code evaluators) |
| Safety | Chrome: Gemini Nano | `safety_appropriate` (Phoenix LLM judge) |

The judge prompts live in [`prompts/`](prompts/). Dataset examples and their references are in [`data/baseline.ts`](data/baseline.ts), with the original IFEval-style examples in [`data/ifeval-style.ts`](data/ifeval-style.ts). The receipt group shares a JSON Schema and checks both structural validity and extracted values. The intent and safety groups use case-specific criteria in their dataset references.

The IFEval-style group uses 24 original prompts with two explicit, mechanically verifiable constraints per response. It is inspired by [IFEval](https://arxiv.org/abs/2311.07911), but it is not the official IFEval dataset or score. `ifeval_prompt_level` scores 1 only when every constraint for a prompt passes. `ifeval_instruction_level` scores the fraction of that prompt's constraints that pass. Checkers cover dash-bullet counts, whitespace-delimited word limits, case-insensitive required/forbidden phrases and phrase counts, and case-insensitive prefixes/suffixes. The checks are code-based; this group does not use an LLM judge.

Each run creates one Phoenix experiment per dataset. Browser name, model family, benchmark version, dataset name, and dataset version are recorded as experiment metadata. The JSON report under `results/` contains per-case first-token and total response times plus evaluation details.

## Example evaluation results

This historical Chrome / Gemini Nano snapshot was recorded on September 30, 2026, before the IFEval-style group was added. It scored five examples in each of the original groups:

| Evaluation | Result | Scoring method |
| --- | ---: | --- |
| JSON schema valid | 5/5 (100%) | Code evaluator |
| Receipt values correct | 3/5 (60%) | Code evaluator |
| Intent task success | 2/5 (40%) | Phoenix LLM judge |
| Safety appropriate | 5/5 (100%) | Phoenix LLM judge |

This small run is a smoke test of the harness, not a reliable estimate of model quality. It uses only five cases per group, with one generation per case. The results show why the checks are separate: all five receipt responses had valid JSON shape, but two had incorrect extracted values. This report was collected with a visible Chrome session before the runner's automatic headless launch was added; it is not a headless benchmark result. Each run writes its full case-level output to `results/benchmark-<timestamp>.json` locally; generated reports are git-ignored.

### IFEval-style headless results

The corrected headless runs used Chrome / Gemini Nano on October 1, 2026 UTC. The runner restores list markers from Phoenix's rendered list elements before scoring; the 24 prompts each have two checks, so the instruction-level denominator is twice the number of generations:

| Run | Generations | All constraints passed | Individual constraints passed |
| --- | ---: | ---: | ---: |
| First pass, one generation per prompt | 24 | 24/24 (100%) | 48/48 (100%) |
| Stability run, three generations per prompt | 72 | 72/72 (100%) | 144/144 (100%) |

A preliminary run was superseded after we found that reading Phoenix's rendered text omitted Markdown bullet markers. The runner now reconstructs those markers from the rendered list elements. Both runs in the table used the corrected extraction and passed every check. These results are from only 24 original prompts, not the official IFEval set, and are not a general estimate of Gemini Nano performance. Both runs used the headless CDP flow and a temporary clone of the installed model profile; the clone was removed after the runs.

## Requirements

- Node.js 22.12 or newer and pnpm.
- Phoenix running at `http://localhost:6006` (or another URL set in `.env`). Podman Compose is included, but an existing Phoenix instance also works.
- Google Chrome installed locally. The Chrome runner starts the installed Google Chrome binary directly; set `PHOENIX_CHROME_EXECUTABLE_PATH` if Chrome is installed outside its standard location.
- Google Chrome with Gemini Nano available. The first use can require a model download; availability depends on Chrome version, hardware, storage, and settings.
- A Phoenix-side provider credential and model for the LLM judges. The instructions below use OpenAI and `gpt-6-luna`.

## 1. Start Phoenix

From this repository:

```sh
podman compose up -d
```

This starts `arizephoenix/phoenix:latest` on port 6006 and persists Phoenix data in the `phoenix-data` volume. Open [http://localhost:6006](http://localhost:6006).

To stop Phoenix while retaining its data:

```sh
podman compose down
```

You can instead use an existing Phoenix instance by changing `PHOENIX_BASE_URL` in `.env`.

## 2. Install dependencies and configure the runner

```sh
pnpm install
cp .env.example .env
```

The defaults in `.env.example` use local Phoenix, the `prompt-api-demo` dataset prefix, and OpenAI with `gpt-6-luna` for judge calls. Change `PHOENIX_JUDGE_MODEL_PROVIDER` and `PHOENIX_JUDGE_MODEL_NAME` if you use another provider/model.

`PHOENIX_API_KEY` is only needed when Phoenix authentication is enabled. It authenticates this demo to Phoenix; it is separate from the LLM provider credential.

## 3. Configure Phoenix judge credentials

In Phoenix, add the provider credential at **Settings → Secrets** with the key `OPENAI_API_KEY`. Phoenix keeps the value server-side; do not put it in this repository or commit it. A configured Custom AI Provider can be used instead.

The judge prompts and model selection are used by the runner's evaluator preview calls. `pnpm judges` also creates and attaches dataset evaluators named `task_success` and `safety_appropriate` so they are available in Phoenix for inspection and other evaluation workflows.

## 4. Seed the datasets and create the Phoenix evaluators

Run these after Phoenix is available and the provider is configured:

```sh
pnpm seed
pnpm judges
```

`pnpm seed` creates the baseline datasets:

- `prompt-api-demo-receipts-v1`
- `prompt-api-demo-intent-v1`
- `prompt-api-demo-safety-v1`
- `prompt-api-demo-ifeval-style-v1`

The three original datasets contain five examples each; `prompt-api-demo-ifeval-style-v1` contains 24. The instruction-following-only run does not need judge credentials or `pnpm judges`.

`pnpm judges` creates `task_success` on the intent dataset and `safety_appropriate` on the safety dataset. It leaves same-named evaluators in place. To apply an edited judge prompt, remove the existing evaluator in Phoenix, then rerun `pnpm judges`.

If the original datasets are already in Phoenix, seed just the newly added IFEval-style dataset with:

```sh
pnpm seed -- --groups=instruction-following
```

The judge prompt templates are plain Markdown for review:

- [`prompts/task-success.md`](prompts/task-success.md) checks each answer against `success_criteria`.
- [`prompts/safety-appropriate.md`](prompts/safety-appropriate.md) checks each answer against `expected_behavior`.

## 5. Set up Gemini Nano in the Chrome profile

The Chrome runner uses `.profiles/chrome` by default. Gemini Nano must be installed in that exact profile before a headless run. If you already installed the model in another Chrome profile, copy that profile path into `PHOENIX_CHROME_PROFILE` in `.env` and make sure no other Chrome process is using it.

For first-time setup, open regular Chrome with the benchmark profile:

```sh
open -na "Google Chrome" --args \
  --user-data-dir="$PWD/.profiles/chrome" \
  --no-first-run --no-default-browser-check \
  http://localhost:6006/chat
```

In Phoenix Chat, select Gemini Nano and send a prompt to trigger the model's initial download. Wait for a response, then quit that Chrome process fully before running the benchmark. Chrome manages the model download, so setup can take a while. The machine must meet Chrome's [built-in AI hardware, storage, and network requirements](https://developer.chrome.com/docs/ai/get-started?hl=en).

Do not open the same profile in two Chrome processes at once. The runner will stop with an explanatory error if that profile is already in use.

## 6. Run the benchmark

Run the full benchmark:

```sh
pnpm eval
```

Run only the IFEval-style group against Chrome/Gemini Nano:

```sh
pnpm eval -- --groups=instruction-following
```

Repeat each case three times to see how scores vary across generations:

```sh
pnpm eval -- --groups=instruction-following --repetitions=3
```

Seed or run selected groups with the comma-separated `--groups` option. The runner defaults to all groups and one generation per example. Supported group IDs are `receipt-extraction`, `intent-task-success`, `instruction-following`, and `safety`.

The runner launches installed Google Chrome with `--headless=new`, using the Gemini Nano profile, and attaches Playwright over Chrome DevTools Protocol. This uses Chrome's full headless mode rather than Playwright's default Chromium headless shell. The runner selects Gemini Nano in Phoenix Chat and starts a fresh chat for every example. Keep the machine awake and connected while the run is in progress.

### Attach Playwright to a manually launched Chrome

If you want to manage Chrome yourself, set `PHOENIX_CHROME_CDP_ENDPOINT=http://127.0.0.1:9222` in `.env`. The runner will attach to that existing Chrome process and will not close it when the run ends. This works with either visible Chrome or directly launched headless Chrome. When this variable is unset, the runner starts and closes its own headless Chrome process.

On macOS, launch the demo profile visibly like this:

```sh
open -na "Google Chrome" --args --user-data-dir="$PWD/.profiles/chrome" --remote-debugging-port=9222 --no-first-run --no-default-browser-check http://localhost:6006/chat
```

To start a manually managed headless Chrome instead, use:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new \
  --user-data-dir="$PWD/.profiles/chrome" \
  --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check \
  http://localhost:6006/chat
```

Keep `PHOENIX_CHROME_CDP_ENDPOINT` unset to let the runner automatically launch its own headless Chrome. If you set it, that external browser takes precedence.

### Scoring and timing

Receipt outputs are evaluated locally with code. The runner sends intent and safety outputs to Phoenix's evaluator preview using the judge prompt files and the Phoenix-side provider credential, then records each judge annotation on its experiment run. Phoenix experiments created through the TypeScript SDK do not automatically launch Phoenix's persisted dataset-evaluator jobs, which is why the runner explicitly calls the evaluator preview and records the scores.

First-token time is measured when assistant text first appears in the chat UI. Total response time is measured when Phoenix finishes rendering the answer. These include UI and browser scheduling overhead; compare them under the same machine conditions rather than treating them as isolated model latency measurements.

A report is written to `results/benchmark-<timestamp>.json`. Phoenix datasets, experiments, and evaluations remain available in the Phoenix UI.

## Checks

```sh
pnpm check
```

This runs TypeScript typechecking and the deterministic evaluator tests. A live benchmark additionally needs Phoenix, seeded datasets, judge credentials, Google Chrome, and an available Gemini Nano model.

## Repository layout

```text
compose.yaml             Local Phoenix container
data/baseline.ts         Dataset groups, examples, and expected results
prompts/                Human-reviewable LLM judge prompts
src/                    Seed, evaluator, browser, and experiment runner code
tests/                  Deterministic evaluator tests
results/                Generated local JSON reports (git-ignored)
.profiles/              Persistent browser profiles (git-ignored)
```

## Changing the baseline

Edit `data/baseline.ts` to change examples or rubrics. Increment the dataset/rubric version when the meaning of a case or expected value changes. Example IDs are stable, and `pnpm seed` updates datasets with the same names. Keep receipt examples on the shared prompt and schema so structural and value scores remain comparable.
