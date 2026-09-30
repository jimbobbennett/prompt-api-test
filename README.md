# Phoenix Prompt API Benchmark

A small, inspectable demo for evaluating browser built-in language models through Phoenix Chat. Playwright drives a visible Chrome or Microsoft Edge window; Phoenix stores the datasets and experiments, and the runner writes a local JSON report with per-case timing and scores.

This is a harness demonstration, not a statistically representative model benchmark. Each task group contains five examples.

## What it evaluates

| Dataset group | Browser model | Evaluator(s) |
| --- | --- | --- |
| Receipt extraction | Chrome: Gemini Nano; Edge: Phi | `json_schema_valid` and `receipt_values_correct` (TypeScript code evaluators) |
| Intent / task success | Chrome: Gemini Nano; Edge: Phi | `task_success` (Phoenix LLM judge) |
| Safety | Chrome: Gemini Nano; Edge: Phi | `safety_appropriate` (Phoenix LLM judge) |

The judge prompts live in [`prompts/`](prompts/). Dataset examples and their references are in [`data/baseline.ts`](data/baseline.ts). The receipt group shares a JSON Schema and checks both structural validity and extracted values. The intent and safety groups use case-specific criteria in their dataset references.

Each browser run creates one Phoenix experiment per dataset. Browser name, model family, benchmark version, dataset name, and dataset version are recorded as experiment metadata. The JSON report under `results/` contains per-case first-token and total response times plus evaluation details.

## Requirements

- Node.js 22.12 or newer and pnpm.
- Phoenix running at `http://localhost:6006` (or another URL set in `.env`). Podman Compose is included, but an existing Phoenix instance also works.
- Chrome and/or Microsoft Edge installed locally. `pnpm exec playwright install chrome msedge` installs the branded browser channels used by the runner.
- A browser/device where the built-in Prompt API model is available. The first use can require a model download; availability depends on the browser version, hardware, storage, and settings.
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
pnpm exec playwright install chrome msedge
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

`pnpm seed` creates or updates these datasets, each with five examples:

- `prompt-api-demo-receipts-v1`
- `prompt-api-demo-intent-v1`
- `prompt-api-demo-safety-v1`

`pnpm judges` creates `task_success` on the intent dataset and `safety_appropriate` on the safety dataset. It leaves same-named evaluators in place. To apply an edited judge prompt, remove the existing evaluator in Phoenix, then rerun `pnpm judges`.

The judge prompt templates are plain Markdown for review:

- [`prompts/task-success.md`](prompts/task-success.md) checks each answer against `success_criteria`.
- [`prompts/safety-appropriate.md`](prompts/safety-appropriate.md) checks each answer against `expected_behavior`.

## 5. Run the benchmark

Run both browser channels:

```sh
pnpm eval -- --browsers=chrome,msedge
```

Run only Chrome/Gemini Nano:

```sh
pnpm eval -- --browsers=chrome
```

Run only Edge/Phi:

```sh
pnpm eval -- --browsers=msedge
```

The runner opens a visible browser window with a persistent profile under `.profiles/`, selects the browser's built-in model in Phoenix Chat, and starts a fresh chat for each example. Leave the browser window open and the machine awake and connected while it runs. The first run may spend time downloading the model.

### Attach to an already-open Chrome window

Some setups make Gemini Nano available only in a directly launched Chrome session. In that case, start Chrome with remote debugging enabled, set `PHOENIX_CHROME_CDP_ENDPOINT=http://127.0.0.1:9222` in `.env`, then run the Chrome command above. The runner will attach to that visible Chrome process and reuse its profile.

On macOS, launch the demo profile like this:

```sh
open -na "Google Chrome" --args --user-data-dir="$PWD/.profiles/chrome" --remote-debugging-port=9222 --no-first-run --no-default-browser-check http://localhost:6006/chat
```

### Scoring and timing

Receipt outputs are evaluated locally with code. The runner sends intent and safety outputs to Phoenix's evaluator preview using the judge prompt files and the Phoenix-side provider credential, then records each judge annotation on its experiment run. Phoenix experiments created through the TypeScript SDK do not automatically launch Phoenix's persisted dataset-evaluator jobs, which is why the runner explicitly calls the evaluator preview and records the scores.

First-token time is measured when assistant text first appears in the chat UI. Total response time is measured when Phoenix finishes rendering the answer. These include UI and browser scheduling overhead; compare them under the same machine conditions rather than treating them as isolated model latency measurements.

A report is written to `results/benchmark-<timestamp>.json`. Phoenix datasets, experiments, and evaluations remain available in the Phoenix UI.

## Checks

```sh
pnpm check
```

This runs TypeScript typechecking and the deterministic evaluator tests. A live benchmark additionally needs Phoenix, seeded datasets, judge credentials, an installed supported browser, and an available built-in model.

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
