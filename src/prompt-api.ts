import { createServer } from "node:http";
import { openBrowserAtUrl, type BrowserAnswer } from "./browser.js";
import type { Page } from "playwright";

const pageHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phoenix Prompt API direct runner</title>
</head>
<body>
  <main>
    <h1>Phoenix Prompt API direct runner</h1>
    <p id="status" role="status">Checking Prompt API availability…</p>
    <button id="create-session" type="button">Create model session</button>
  </main>
  <script>
    const status = document.querySelector('#status');
    const createButton = document.querySelector('#create-session');
    let session;
    window.promptApiState = { availability: 'checking', error: null };

    async function checkAvailability() {
      if (!('LanguageModel' in window)) {
        window.promptApiState = { availability: 'unsupported', error: 'window.LanguageModel is not present.' };
        status.textContent = window.promptApiState.error;
        return;
      }
      try {
        const availability = await LanguageModel.availability();
        window.promptApiState = { availability, error: null };
        status.textContent = 'Prompt API availability: ' + availability;
      } catch (error) {
        window.promptApiState = { availability: 'error', error: String(error) };
        status.textContent = 'Availability check failed: ' + String(error);
      }
    }

    createButton.addEventListener('click', async () => {
      createButton.disabled = true;
      status.textContent = 'Creating session; the model may need to download…';
      window.promptApiState.sessionReady = false;
      window.promptApiState.error = null;
      try {
        if (session) session.destroy();
        session = await LanguageModel.create({
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', (event) => {
              const percent = event.total ? Math.round(event.loaded / event.total * 100) : null;
              status.textContent = percent === null
                ? 'Downloading model…'
                : 'Downloading model… ' + percent + '%';
            });
          },
        });
        window.promptApiState.sessionReady = true;
        window.promptApiState.error = null;
        status.textContent = 'Session ready';
      } catch (error) {
        window.promptApiState.sessionReady = false;
        window.promptApiState.error = String(error);
        status.textContent = 'Session creation failed: ' + String(error);
      } finally {
        createButton.disabled = false;
      }
    });

    window.runPromptDirect = async (prompt) => {
      if (!session) throw new Error('Create a model session first.');
      const start = performance.now();
      let ttftMs = null;
      let response = '';
      for await (const chunk of session.promptStreaming(prompt)) {
        if (ttftMs === null) ttftMs = performance.now() - start;
        response += chunk;
      }
      return {
        response,
        ttftMs: ttftMs ?? performance.now() - start,
        durationMs: performance.now() - start,
      };
    };

    checkAvailability();
  </script>
</body>
</html>`;

type PromptApiPageState = {
  availability: string;
  error: string | null;
  sessionReady?: boolean;
};

/** Serve a tiny secure-context page whose JavaScript talks directly to LanguageModel. */
export async function startPromptApiHarness(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(pageHtml);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4177, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine the Prompt API harness server address.");
  return {
    url: `http://localhost:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export async function openPromptApiPage(url: string) {
  const opened = await openBrowserAtUrl(url);
  try {
    await opened.page.waitForFunction(() => {
      const state = (window as typeof window & { promptApiState?: PromptApiPageState }).promptApiState;
      return Boolean(state && state.availability !== "checking");
    }, undefined, { timeout: 30_000 });
    const state = await opened.page.evaluate(() =>
      (window as typeof window & { promptApiState: PromptApiPageState }).promptApiState,
    );
    if (state.availability === "unsupported" || state.availability === "unavailable" || state.availability === "error") {
      throw new Error(`Direct Prompt API cannot run in this browser profile: ${state.error ?? state.availability}.`);
    }
    return { ...opened, availability: state.availability };
  } catch (error) {
    await opened.close();
    throw error;
  }
}

export async function askWithPromptApi(page: Page, prompt: string): Promise<BrowserAnswer> {
  await page.getByRole("button", { name: "Create model session" }).click();
  await page.waitForFunction(() => {
    const state = (window as typeof window & { promptApiState?: PromptApiPageState }).promptApiState;
    return state?.sessionReady === true || state?.error !== null && state?.error !== undefined;
  }, undefined, { timeout: 600_000 });
  const state = await page.evaluate(() =>
    (window as typeof window & { promptApiState: PromptApiPageState }).promptApiState,
  );
  if (!state.sessionReady) throw new Error(`Prompt API session creation failed: ${state.error ?? "unknown error"}`);

  const answer = await page.evaluate(async (input) => {
    const runPromptDirect = (window as typeof window & {
      runPromptDirect?: (value: string) => Promise<BrowserAnswer>;
    }).runPromptDirect;
    if (!runPromptDirect) throw new Error("Direct Prompt API function is unavailable.");
    return runPromptDirect(input);
  }, prompt);
  return answer;
}
