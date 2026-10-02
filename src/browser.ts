import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type BrowserChannel = "chrome";
export type BrowserAnswer = { response: string; ttftMs: number; durationMs: number };
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function defaultChromeExecutable(): string {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "google-chrome";
}

async function launchHeadlessChrome(profile: string, startUrl: string): Promise<{
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
      startUrl,
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

export async function openBrowserAtUrl(
  startUrl: string,
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const cdpEndpoint = process.env.PHOENIX_CHROME_CDP_ENDPOINT;
  let context: BrowserContext;
  let close: () => Promise<void>;

  if (!cdpEndpoint) {
    const profile = resolve(process.env.PHOENIX_CHROME_PROFILE ?? join(process.cwd(), ".profiles", "chrome"));
    ({ context, close } = await launchHeadlessChrome(profile, startUrl));
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    return { context, page, close };
  } catch (error) {
    await close();
    throw error;
  }
}
