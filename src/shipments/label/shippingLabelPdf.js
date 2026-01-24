import puppeteer from "puppeteer";
import { renderShippingLabelHtml } from "./shippingLabelHtml.js";

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return browserPromise;
}

export async function generateShippingLabelPdfBuffer({ env, storeId, firestoreDoc }) {
  const browser = await getBrowser();
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
