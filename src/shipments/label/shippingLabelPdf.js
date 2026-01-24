import puppeteer from "puppeteer";
import { renderShippingLabelHtml } from "./shippingLabelHtml.js";

let browserPromise = null;
let renderLock = Promise.resolve();

function parseBoolEnv(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function withRenderLock(fn) {
  const run = renderLock.then(fn, fn);
  renderLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function getBrowser() {
  if (browserPromise) return browserPromise;
  const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH ?? "").trim();
  const extraArgsRaw = String(process.env.PUPPETEER_ARGS ?? "").trim();
  const extraArgs = extraArgsRaw ? extraArgsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const dumpio = parseBoolEnv(process.env.PUPPETEER_DUMPIO);
  const singleProcess = parseBoolEnv(process.env.PUPPETEER_SINGLE_PROCESS);
  const launchTimeoutMsRaw = Number.parseInt(String(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS ?? "30000"), 10);
  const launchTimeoutMs = Number.isFinite(launchTimeoutMsRaw) ? Math.max(5_000, launchTimeoutMsRaw) : 30_000;

  browserPromise = puppeteer
    .launch({
    headless: "new",
    ...(executablePath ? { executablePath } : {}),
    dumpio,
    timeout: launchTimeoutMs,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--disable-gpu",
      "--disable-features=site-per-process",
      ...(singleProcess ? ["--single-process"] : []),
      ...extraArgs,
    ],
    })
    .then((browser) => {
      // If Chromium crashes (common on 512MB servers), clear the cached promise so next request relaunches.
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    });
  return browserPromise;
}

async function generateOnce({ env, storeId, firestoreDoc }) {
  let browser;
  try {
    browser = await getBrowser();
  } catch (error) {
    const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH ?? "").trim();
    const detail = String(error?.message ?? error ?? "").trim();
    const e = new Error(
      `chromium_launch_failed: ${detail}${executablePath ? ` (PUPPETEER_EXECUTABLE_PATH=${executablePath})` : ""}`.trim()
    );
    e.code = "chromium_launch_failed";
    throw e;
  }

  // If the cached browser is no longer connected, force relaunch.
  try {
    if (typeof browser?.isConnected === "function" && !browser.isConnected()) {
      browserPromise = null;
      browser = await getBrowser();
    }
  } catch {
    browserPromise = null;
    browser = await getBrowser();
  }

  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(30_000);
    page.setDefaultTimeout(30_000);
    const content = await renderShippingLabelHtml({ env, storeId, firestoreDoc });
    await page.setContent(content, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      width: "4in",
      height: "6in",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      preferCSSPageSize: true,
      pageRanges: "1",
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function generateShippingLabelPdfBuffer({ env, storeId, firestoreDoc }) {
  return withRenderLock(async () => {
    try {
      return await generateOnce({ env, storeId, firestoreDoc });
    } catch (error) {
      const message = String(error?.message ?? "").toLowerCase();
      const isConnClosed =
        message.includes("protocol error") && message.includes("connection closed");
      if (!isConnClosed) throw error;

      // Chromium likely crashed; clear cached browser and retry once.
      browserPromise = null;
      return generateOnce({ env, storeId, firestoreDoc });
    }
  });
}
