import puppeteer from "puppeteer";
import { renderShippingLabelHtml } from "./shippingLabelHtml.js";

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;
  const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH ?? "").trim();
  const extraArgsRaw = String(process.env.PUPPETEER_ARGS ?? "").trim();
  const extraArgs = extraArgsRaw ? extraArgsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  browserPromise = puppeteer.launch({
    headless: "new",
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
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
    const e = new Error(`chromium_launch_failed: ${String(error?.message ?? error ?? "")}`.trim());
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
