import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type BrowserChannel = "chrome";
export type BrowserAnswer = { response: string; ttftMs: number; durationMs: number };
export type RenderedListItem = { text: string; marker: string };

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function restoreListMarkers(text: string, items: RenderedListItem[]): string {
  const lines = text.split(/\r?\n/u);
  for (const item of items) {
    const lineIndex = lines.findIndex((line) => line.trim() === item.text.trim());
    const line = lines[lineIndex];
    if (lineIndex !== -1 && line !== undefined) lines[lineIndex] = `${item.marker}${line.trim()}`;
  }
  return lines.join("\n");
}

function defaultChromeExecutable(): string {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "google-chrome";
}

async function launchHeadlessChrome(profile: string, phoenixUrl: string): Promise<{
  context: BrowserContext;
  close: () => Promise<void>;
}> {
  await mkdir(profile, { recursive: true });
  const singletonLock = join(profile, "SingletonLock");
  try {
    await lstat(singletonLock);
    throw new Error(
      `Chrome profile '${profile}' is already in use. Close Chrome using this profile, or set PHOENIX_CHROME_CDP_ENDPOINT to attach to that Chrome process.`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const activePortFile = join(profile, "DevToolsActivePort");
  await rm(activePortFile, { force: true });
  const executable = process.env.PHOENIX_CHROME_EXECUTABLE_PATH ?? defaultChromeExecutable();
  const child = spawn(
    executable,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,1000",
      new URL("/chat", phoenixUrl).toString(),
    ],
    { stdio: "ignore" },
  );

  let launchError: Error | undefined;
  child.once("error", (error) => {
    launchError = error;
  });

  let browser: Browser | undefined;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Chrome exited during startup (exit code ${child.exitCode}).`);
      try {
        const activePort = await readFile(activePortFile, "utf8");
        const port = Number(activePort.split(/\r?\n/, 1)[0]);
        if (Number.isInteger(port) && port > 0) {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
            break;
          } catch {
            // Chrome creates DevToolsActivePort just before its CDP server is ready.
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await sleep(250);
    }
    if (!browser) throw new Error("Timed out waiting for headless Chrome's DevTools endpoint.");

    const connectedBrowser = browser;
    const context = connectedBrowser.contexts()[0];
    if (!context) {
      await connectedBrowser.close();
      throw new Error("No browser context is available in headless Chrome.");
    }

    return {
      context,
      close: async () => {
        try {
          await connectedBrowser.close();
        } finally {
          if (child.exitCode === null) child.kill("SIGTERM");
        }
      },
    };
  } catch (error) {
    await stopChrome(child);
    throw new Error(
      `Could not start headless Chrome with profile '${profile}'. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function stopChrome(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    sleep(5_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

export async function openChat(
  channel: BrowserChannel,
  phoenixUrl: string,
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const cdpEndpoint = process.env.PHOENIX_CHROME_CDP_ENDPOINT;
  let context: BrowserContext;
  let close: () => Promise<void>;

  if (!cdpEndpoint) {
    const profile = resolve(process.env.PHOENIX_CHROME_PROFILE ?? join(process.cwd(), ".profiles", "chrome"));
    ({ context, close } = await launchHeadlessChrome(profile, phoenixUrl));
  } else {
    const browser: Browser = await chromium.connectOverCDP(cdpEndpoint);
    const defaultContext = browser.contexts()[0];
    if (!defaultContext) {
      await browser.close();
      throw new Error(`No browser context is available at ${cdpEndpoint}.`);
    }
    context = defaultContext;
    close = () => browser.close();
  }

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(new URL("/chat", phoenixUrl).toString(), { waitUntil: "domcontentloaded" });
    await page.getByLabel("Chat message").waitFor({ state: "visible", timeout: 30_000 });
    const modelPicker = page.getByRole("button", { name: /Select model/ });
    await modelPicker.click();
    const expectedModel = "Gemini Nano";
    const browserModel = page.getByRole("menuitem", { name: new RegExp(expectedModel, "i") });
    try {
      await browserModel.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      throw new Error(`${channel}: Phoenix did not offer the expected browser model (${expectedModel}). Check browser version and Prompt API availability.`);
    }
    const browserModelLabel = (await browserModel.innerText()).trim();
    if (!browserModelLabel) throw new Error(`${channel}: Phoenix did not offer a browser built-in model.`);
    if (await browserModel.isDisabled()) {
      throw new Error(
        `Chrome: browser model '${expectedModel}' is unavailable for this profile. Open this Chrome profile visibly, enable the Prompt API, install Gemini Nano, then retry.`,
      );
    }
    await browserModel.click();
    if (!(await modelPicker.getAttribute("aria-label"))?.includes(expectedModel)) {
      throw new Error(`${channel}: Phoenix did not select '${expectedModel}' as the active chat model.`);
    }
    if (await page.getByLabel("Chat message").isDisabled()) {
      throw new Error(`${channel}: Phoenix chat has no available browser model. Check built-in model support and download/setup it first.`);
    }
    return { context, page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function askInNewChat(page: Page, prompt: string): Promise<BrowserAnswer> {
  const newChat = page.getByRole("button", { name: "New chat" });
  if (await newChat.isVisible().catch(() => false)) await newChat.click();

  const input = page.getByLabel("Chat message");
  await input.fill(prompt);
  const startedAt = Date.now();
  await page.getByRole("button", { name: "Send message" }).click();
  const assistantMessages = page.locator('[data-from="assistant"]');
  await assistantMessages.last().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => {
    const messages = document.querySelectorAll('[data-from="assistant"]');
    return Boolean(messages.length && messages[messages.length - 1]?.textContent?.trim());
  }, undefined, { timeout: 180_000 });
  const ttftMs = Date.now() - startedAt;
  await page.locator('[data-from="assistant"][data-pin-toolbar="true"]').last().waitFor({ state: "visible", timeout: 180_000 });
  const durationMs = Date.now() - startedAt;
  const message = assistantMessages.last();
  const codeBlock = message.locator('[data-streamdown="code-block"] pre code').first();
  let response: string;
  if ((await codeBlock.count()) > 0) {
    response = (await codeBlock.innerText()).trim();
  } else {
    const renderedText = await message.innerText();
    const listItems = await message.locator("li").evaluateAll((elements) =>
      elements.map((element) => {
        const parent = element.parentElement;
        const isOrdered = parent?.tagName === "OL";
        const index = parent ? Array.from(parent.children).indexOf(element) + 1 : 1;
        return {
          text: (element as HTMLElement).innerText.trim(),
          marker: isOrdered ? `${index}. ` : "- ",
        };
      }),
    );
    response = restoreListMarkers(renderedText, listItems).trim();
  }
  if (!response) throw new Error("Phoenix chat returned an empty assistant message.");
  return { response, ttftMs, durationMs };
}
