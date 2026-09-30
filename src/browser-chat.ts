import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type BrowserChannel = "chrome" | "msedge";
export type BrowserAnswer = { response: string; ttftMs: number; durationMs: number };

export async function openChat(channel: BrowserChannel, phoenixUrl: string): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const cdpEndpoint = channel === "chrome" ? process.env.PHOENIX_CHROME_CDP_ENDPOINT : undefined;
  let context: BrowserContext;
  let close: () => Promise<void>;
  if (cdpEndpoint) {
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    const defaultContext = browser.contexts()[0];
    if (!defaultContext) {
      await browser.close();
      throw new Error(`No browser context is available at ${cdpEndpoint}.`);
    }
    context = defaultContext;
    close = () => browser.close();
  } else {
    const profile = join(process.cwd(), ".profiles", channel);
    await mkdir(profile, { recursive: true });
    context = await chromium.launchPersistentContext(profile, {
      channel,
      headless: false,
      viewport: { width: 1440, height: 1000 },
    });
    close = () => context.close();
  }
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(new URL("/chat", phoenixUrl).toString(), { waitUntil: "domcontentloaded" });
    await page.getByLabel("Chat message").waitFor({ state: "visible", timeout: 30_000 });
    const modelPicker = page.getByRole("button", { name: /Select model/ });
    await modelPicker.click();
    const expectedModel = channel === "chrome" ? "Gemini Nano" : "Phi";
    const browserModel = page.getByRole("menuitem", { name: new RegExp(expectedModel, "i") });
    try {
      await browserModel.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      throw new Error(`${channel}: Phoenix did not offer the expected browser model (${expectedModel}). Check browser version and Prompt API availability.`);
    }
    const browserModelLabel = (await browserModel.innerText()).trim();
    if (!browserModelLabel) throw new Error(`${channel}: Phoenix did not offer a browser built-in model.`);
    if (await browserModel.isDisabled()) {
      throw new Error(`${channel}: browser model '${expectedModel}' is unavailable on this device/profile. Open Chrome's Prompt API flags and verify the on-device model is available.`);
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
  const response = (
    await ((await codeBlock.count()) > 0 ? codeBlock.innerText() : message.innerText())
  ).trim();
  if (!response) throw new Error("Phoenix chat returned an empty assistant message.");
  return { response, ttftMs, durationMs };
}
