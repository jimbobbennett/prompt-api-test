# Phoenix Prompt API Benchmark

A small, inspectable demo for evaluating Chrome’s built-in Gemini Nano through the Prompt API directly. Playwright opens a local harness page, and that page calls `LanguageModel` in Chrome. Phoenix stores the datasets and experiments, and the runner writes a local JSON report with per-case timing and scores.

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

Each run creates one Phoenix experiment per dataset. Browser, browser runtime, Prompt API availability, generation mode, benchmark version, dataset name, and dataset version are recorded as experiment metadata. The Prompt API does not expose a portable model identifier, so the exact browser model is not inferred from the API. The JSON report under `results/` contains per-case first-token and total response times plus evaluation details.

## Example evaluation results

This historical Chrome / Gemini Nano snapshot was recorded on September 30, 2026, before the IFEval-style group and direct API runner were added. It was collected through Phoenix Chat and scored five examples in each of the original groups:

| Evaluation | Result | Scoring method |
| --- | ---: | --- |
| JSON schema valid | 5/5 (100%) | Code evaluator |
| Receipt values correct | 3/5 (60%) | Code evaluator |
| Intent task success | 2/5 (40%) | Phoenix LLM judge |
| Safety appropriate | 5/5 (100%) | Phoenix LLM judge |

This small run is a smoke test of the harness, not a reliable estimate of model quality. It uses only five cases per group, with one generation per case. The results show why the checks are separate: all five receipt responses had valid JSON shape, but two had incorrect extracted values. This report was collected with a visible Chrome session before the runner's automatic headless launch was added; it is not a headless benchmark result. Each run writes its full case-level output to `results/benchmark-<timestamp>.json` locally; generated reports are git-ignored.

### IFEval-style headless results

These historical headless runs used Chrome / Gemini Nano through Phoenix Chat on October 1, 2026 UTC, before the runner called Prompt API directly. The runner restored list markers from Phoenix's rendered list elements before scoring; the 24 prompts each have two checks, so the instruction-level denominator is twice the number of generations:

| Run | Generations | All constraints passed | Individual constraints passed |
| --- | ---: | ---: | ---: |
| First pass, one generation per prompt | 24 | 24/24 (100%) | 48/48 (100%) |
| Stability run, three generations per prompt | 72 | 72/72 (100%) | 144/144 (100%) |

A preliminary run was superseded after we found that reading Phoenix's rendered text omitted Markdown bullet markers. List markers were reconstructed from Phoenix Chat rendered list elements. Both runs in the table used the corrected extraction and passed every check. These results are from only 24 original prompts, not the official IFEval set, and are not a general estimate of Gemini Nano performance. Both runs used the headless CDP flow and a temporary clone of the installed model profile; the clone was removed after the runs. These are historical Phoenix Chat results, not measurements from the current direct API runner.

### Cross-browser spreadsheet replay

On October 2, 2026 UTC, the saved Chrome and Edge responses from the source spreadsheet were replayed through 19 LLM judges and two deterministic punctuation checks. This created 200 successful task runs and 4,200 evaluator records in Phoenix experiment `cross-browser-sheet-replay-2026-10-02T00-14-52.527Z` (experiment ID `RXhwZXJpbWVudDoxNQ==`). [Open the experiment in the local Phoenix instance](http://localhost:6006/datasets/RGF0YXNldDo1/compare?experimentId=RXhwZXJpbWVudDoxNQ%3D%3D). The judges used OpenAI `gpt-6-luna`; no browser model was invoked.

The scores below are means for numeric judgments only. `n` is the number of numeric scores; judge responses marked `not_applicable` are excluded from the mean.

| Evaluation | Chrome mean (n/200) | Edge mean (n/200) |
| --- | ---: | ---: |
| Task success | 3.82 (200) | 3.24 (199) |
| Formatting | 4.02 (200) | 3.56 (200) |
| Intent understanding | 3.99 (200) | 3.59 (199) |
| Clarity/coherence | 4.41 (200) | 3.73 (200) |
| Language | 4.52 (200) | 3.77 (200) |
| Factuality | 3.75 (199) | 3.57 (198) |
| Introductory sentence | 3.25 (99) | 3.56 (73) |
| Groundedness | 3.64 (200) | 3.45 (198) |
| Label correctness | 3.85 (126) | 3.37 (115) |
| Response similarity | 3.06 (200) | — |
| Repeated punctuation | 8/200 (4%) | 123/200 (61.5%) |

The LLM ratings use the proposed rubrics in [`prompts/cross-browser/`](prompts/cross-browser/). The sheet did not include the original rating instructions, so these scores are not expected to reproduce its historical ratings. The dataset still preserves those original ratings separately as source annotations. Re-run the snapshot replay with `pnpm eval:cross-browser`; it makes 3,800 judge calls.

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

To import the proposal’s Chrome/Edge comparison data, run:

```sh
pnpm seed:cross-browser
```

This creates or updates `<PHOENIX_DATASET_PREFIX>-cross-browser-quality-v1` with 200 examples. Each example has the prompt and use-case labels as input; Chrome and Edge responses, per-browser source scores, averages, and comparison annotations as output; and evaluator/source-row provenance in metadata. The original export is checked in at [`data/chrome-built-in-ai-cross-browser.csv`](data/chrome-built-in-ai-cross-browser.csv), so repeated imports use the same snapshot. The source scores and comments are preserved annotations; they are not assumed to be ground-truth labels. Source: [Chrome Built-in AI cross-browser quality test data set](https://docs.google.com/spreadsheets/d/1dIeO5oyMF59UeYW6eMKX3PU73TH3IDtotSGdnGzsb9U/edit?gid=0#gid=0).

Attach Phoenix evaluators to that dataset with:

```sh
pnpm evaluators:cross-browser
```

This creates 19 LLM judges (nine score categories for each browser, plus Chrome/Edge response similarity) and two deterministic regex evaluators for repeated punctuation. Judge scores use a proposed 1–5 rubric, with `not_applicable` for criteria that do not fit a case. The original sheet does not publish its rating instructions, so these prompts are explicit approximations, not a claim of score-for-score reproduction. Their prompts are reviewable in [`prompts/cross-browser/`](prompts/cross-browser/). The command attaches evaluator definitions to the dataset for inspection in Phoenix; it does not call the judge model or score the 200 examples. The replay command below explicitly runs the same judge prompts and code checks and records their results on an experiment.

To score the saved spreadsheet responses and record a replay experiment in Phoenix, run:

```sh
pnpm eval:cross-browser
```

This replays the stored Chrome/Edge answers (it does not invoke a browser model), runs the 19 LLM judges and two code checks, and records per-example scores in a Phoenix experiment. It makes 3,800 LLM judge calls. Use `pnpm eval:cross-browser -- --concurrency=1` to reduce parallel judge requests; allowed concurrency is 1–8 and defaults to 3.

`pnpm judges` creates `task_success` on the intent dataset and `safety_appropriate` on the safety dataset. It leaves same-named evaluators in place. To apply an edited judge prompt, remove the existing evaluator in Phoenix, then rerun `pnpm judges`.

If the original datasets are already in Phoenix, seed just the newly added IFEval-style dataset with:

```sh
pnpm seed -- --groups=instruction-following
```

The judge prompt templates are plain Markdown for review:

- [`prompts/task-success.md`](prompts/task-success.md) checks each answer against `success_criteria`.
- [`prompts/safety-appropriate.md`](prompts/safety-appropriate.md) checks each answer against `expected_behavior`.

## 5. Set up Gemini Nano in the Chrome profile

The Chrome runner uses `.profiles/chrome` by default. The direct Prompt API harness creates a session from a Playwright button click, which can trigger the initial model download. If you already installed the model in another Chrome profile, copy that profile path into `PHOENIX_CHROME_PROFILE` in `.env` and make sure no other Chrome process is using it.

The first benchmark run creates a `LanguageModel` session and triggers the model download when needed. The run waits for session creation before sending prompts; the initial download may take a while. Make sure Chrome meets the documented [built-in AI hardware, storage, and network requirements](https://developer.chrome.com/docs/ai/get-started?hl=en).

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

`pnpm eval` serves a small page on the stable localhost origin `http://localhost:4177`, launches installed Google Chrome with `--headless=new`, and attaches Playwright over Chrome DevTools Protocol. The page calls `LanguageModel.create()` and `session.promptStreaming()` directly; each example gets a fresh model session. Availability and model-download progress are surfaced by the harness. Keep the machine awake and connected while the run is in progress.

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

Time to first token is measured when the first stream chunk arrives, and total response time when the stream completes. These timings exclude session creation and model download; compare them under the same machine conditions.

A report is written to `results/benchmark-<timestamp>.json`. Phoenix datasets, experiments, and evaluations remain available in the Phoenix UI.

## Checks

```sh
pnpm check
```

This runs TypeScript typechecking and the deterministic evaluator tests. A live benchmark additionally needs Phoenix, seeded datasets, judge credentials, Google Chrome, and an available built-in model.

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
