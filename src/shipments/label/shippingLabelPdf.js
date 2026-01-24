import puppeteer from "puppeteer";
import { renderShippingLabelHtml } from "./shippingLabelHtml.js";

let browserPromise = null;

function parseBoolEnv(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
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

  browserPromise = puppeteer.launch({
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
  });
  return browserPromise;
}

export async function generateShippingLabelPdfBuffer({ env, storeId, firestoreDoc }) {
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
  const page = await browser.newPage();
  try {
    const content = await renderShippingLabelHtml({ env, storeId, firestoreDoc });
    await page.setContent(content, { waitUntil: "load" });
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
