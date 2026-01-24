import bwipjs from "bwip-js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShipFrom } from "./resolveShipFrom.js";
import { extractAwbNumber } from "./extractAwb.js";

const html = String.raw;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateDDMMYYYY(date) {
  const d = date instanceof Date ? date : new Date(String(date ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function normalizePhone10(value) {
  const digits = String(value ?? "").replaceAll(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function getPaymentFlag(financialStatus) {
  const s = String(financialStatus ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "paid" || s === "partially_paid") return "Prepaid";
  if (s === "pending" || s === "authorized") return "COD";
  return s.toUpperCase();
}

function getBestShipTo(order) {
  const projected = order?.shipping && typeof order.shipping === "object" ? order.shipping : null;
  if (projected) {
    return {
      name: String(projected.fullName ?? "").trim(),
      address1: String(projected.address1 ?? "").trim(),
      address2: String(projected.address2 ?? "").trim(),
      city: String(projected.city ?? "").trim(),
      state: String(projected.state ?? "").trim(),
      pinCode: String(projected.pinCode ?? "").trim(),
      phone1: normalizePhone10(projected.phone1 ?? ""),
      phone2: normalizePhone10(projected.phone2 ?? ""),
      country: "IN",
    };
  }

  const raw = order?.shipping_address ?? order?.customer?.default_address ?? null;
  if (!raw || typeof raw !== "object") return null;
  return {
    name: String(raw.name ?? "").trim(),
    address1: String(raw.address1 ?? "").trim(),
    address2: String(raw.address2 ?? "").trim(),
    city: String(raw.city ?? "").trim(),
    state: String(raw.province ?? "").trim(),
    pinCode: String(raw.zip ?? "").trim(),
    phone1: normalizePhone10(raw.phone ?? order?.phone ?? ""),
    phone2: normalizePhone10(order?.phone ?? ""),
    country: String(raw.country_code ?? raw.country ?? "IN").trim() || "IN",
  };
}

async function makeBarcodeDataUri({ text, height = 12, scale = 3 }) {
  const clean = String(text ?? "").trim();
  if (!clean) return "";
  const buffer = await bwipjs.toBuffer({
    bcid: "code128",
    text: clean,
    includetext: false,
    scale,
    height,
    backgroundcolor: "FFFFFF",
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

let cachedDtdcLogoDataUri = null;

async function readPngAsDataUri(filePath) {
  const buf = await fs.readFile(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function resolveLogoSrc({ env }) {
  const raw = String(env?.shipLabelLogoUrl ?? "").trim();
  const labelDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(labelDir, "..", "..", "public");
  const defaultLogoPath = path.join(publicDir, "DTDC_logo.png");

  if (!raw) {
    if (cachedDtdcLogoDataUri) return cachedDtdcLogoDataUri;
    cachedDtdcLogoDataUri = await readPngAsDataUri(defaultLogoPath);
    return cachedDtdcLogoDataUri;
  }

  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  if (raw.startsWith("/static/")) {
    const relative = raw.slice("/static/".length);
    return readPngAsDataUri(path.join(publicDir, relative));
  }

  return readPngAsDataUri(raw);
}

export async function renderShippingLabelHtml({ env, storeId, firestoreDoc }) {
  const data = firestoreDoc && typeof firestoreDoc === "object" ? firestoreDoc : {};
  const order = data.order && typeof data.order === "object" ? data.order : null;
  if (!order) {
    const error = new Error("order_missing");
    error.code = "order_missing";
    throw error;
  }

  const shipFrom = resolveShipFrom({ env, storeId });
  const shipTo = getBestShipTo(order) ?? {};

  const awb = extractAwbNumber({ firestoreDoc: data });
  const topBarcode = awb ? await makeBarcodeDataUri({ text: awb, height: 9, scale: 2 }) : "";

  const pin = String(shipTo.pinCode ?? "").trim();
  const longCode = awb || String(data?.orderKey ?? "").trim();
  const bottomBarcodeText = [longCode, pin].filter(Boolean).join("-");
  const bottomBarcode =
    bottomBarcodeText
      ? await makeBarcodeDataUri({ text: bottomBarcodeText, height: 12, scale: 2 })
      : "";

  const shipDate = formatDateDDMMYYYY(new Date());
  const shipValue = String(order?.totalPrice ?? order?.total_price ?? "").trim();
  const paymentFlag = getPaymentFlag(order?.financialStatus ?? order?.financial_status);
  const courierType = String(data?.shipment?.courierType ?? "").trim();
  const orderName = String(order?.orderName ?? order?.name ?? "").trim();
  const weightKgRaw = data?.shipment?.weightKg;
  const weightKg =
    weightKgRaw == null || Number.isNaN(Number(weightKgRaw)) ? "0.0" : String(weightKgRaw);

  const toLines = [
    shipTo.name ? `${shipTo.name},` : "",
    shipTo.address1,
    shipTo.address2,
    [shipTo.city, shipTo.state].filter(Boolean).join(", "),
    [shipTo.phone1, shipTo.phone2].filter(Boolean).join(" "),
    shipTo.country ? `${shipTo.country}` : "",
  ]
    .filter(Boolean)
    .join("<br/>");

  const fromLines = [
    shipFrom.name,
    shipFrom.address1,
    shipFrom.address2,
    [shipFrom.city, shipFrom.pinCode].filter(Boolean).join(" "),
    [shipFrom.state, shipFrom.country].filter(Boolean).join(", "),
    shipFrom.phone ? `Ph: ${shipFrom.phone}` : "",
  ]
    .filter(Boolean)
    .join("<br/>");

  const logoSrc = await resolveLogoSrc({ env });

  return html`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @page { size: 4in 6in; margin: 0; }
      html, body { margin: 0; padding: 0; width: 4in; height: 6in; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; overflow: hidden; }

      * { box-sizing: border-box; }

      .page {
        width: 4in;
        height: 6in;
        position: fixed;
        top: 0;
        left: 0;
        overflow: hidden;
      }

      .label {
        width: calc(4in - 8mm);
        height: calc(6in - 8mm);
        margin: 3mm;
        display: grid;
        grid-template-rows: 5mm 21mm 42mm 14mm 8mm 20mm 17mm 17mm;
        overflow: hidden;
        position: relative;
        break-inside: avoid;
        page-break-inside: avoid;
        border: 2px solid #000;
      }

      .row {
        border-bottom: 1px solid #000;
        min-height: 0;
        overflow: hidden;
      }

      .row:last-child { border-bottom: 0; }

      .grid2 { display: grid; grid-template-columns: 1fr 1fr; height: 100%; }
      .cell { padding: 2.5mm; overflow: hidden; min-height: 0; }
      .cell + .cell { border-left: 1px solid #000; }

      .fromTitle, .toTitle { font-weight: 800; font-size: 10pt; }
      .fromText { font-size: 8pt; line-height: 1.18; word-break: break-word; overflow: hidden; }
      .meta { font-size: 8pt; line-height: 1.35; }
      .meta b { font-weight: 800; }

      .toText { font-size: 9.5pt; line-height: 1.12; font-weight: 700; word-break: break-word; overflow: hidden; }
      .pinBig { font-size: 34pt; font-weight: 900; line-height: 0.95; letter-spacing: 0.4pt; }
      .service { font-size: 15pt; font-weight: 900; padding-top: 0.5mm; }

      .barcodeWrap { padding: 2mm; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 1mm; }
      .barcodeImg { width: 100%; height: auto; display: block; max-height: 12mm; object-fit: contain; }
      .awbText { text-align: center; font-size: 14pt; font-weight: 900; letter-spacing: 0.4pt; margin: 0; }

      .modeRow { display: grid; grid-template-columns: 1fr 1fr; align-items: center; }
      .mode { font-size: 13pt; font-weight: 900; }
      .pcs { text-align: right; font-size: 11pt; font-weight: 900; }

      .productGrid { display: grid; grid-template-columns: 1fr 44mm; height: 100%; }
      .productLeft { border-right: 1px solid #000; padding: 2.5mm; overflow: hidden; }
      .productRight { padding: 0; display: grid; grid-template-rows: 1fr 1fr 1fr; }
      .prodTitle { font-size: 12pt; font-weight: 900; }
      .codeBox { border-bottom: 1px solid #000; display: flex; flex-direction: column; justify-content: center; align-items: center; overflow: hidden; }
      .codeBox:last-child { border-bottom: 0; }
      .codeSmall { font-size: 10pt; }
      .codeBig { font-size: 22pt; font-weight: 900; line-height: 1; }
      .payFlag { font-size: 12pt; margin-top: 0.5mm; }
      .payNote { font-size: 10pt; font-weight: 800; margin-top: 0.5mm; }

      .bottomBarcodeRow { padding: 2.5mm; display: flex; flex-direction: column; justify-content: center; gap: 1mm; }
      .bottomBarcodeRow .barcodeImg { max-height: 12mm; }
      .bottomCodeText { text-align: center; font-size: 8pt; font-weight: 700; margin: 0; word-break: break-all; overflow: hidden; }
      .footerRow { display: grid; grid-template-columns: 1.4fr 1fr 0.7fr; align-items: end; padding: 1.5mm 2.5mm; font-size: 9pt; }
      .footerCenter { text-align: center; font-weight: 800; }
      .footerRight { text-align: right; }
      .headerRow { display: flex; align-items: center; justify-content: flex-end; padding: 0 2.5mm; }
      .logo { height: 4mm; width: auto; display: block; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="label">
      <div class="row headerRow">
        <img class="logo" src="${escapeHtml(logoSrc)}" alt="DTDC" />
      </div>

      <div class="row grid2">
        <div class="cell">
          <div class="fromTitle">FROM:</div>
          <div class="fromText">${fromLines}</div>
        </div>
        <div class="cell meta">
          <div>Ship Date : <b>${escapeHtml(shipDate)}</b></div>
          <div>Ship value : <b>${escapeHtml(shipValue)}</b></div>
          <div>Inv No : <b></b></div>
          <div>Inv Date : <b></b></div>
          <div>Bill Sender : <b></b></div>
        </div>
      </div>

      <div class="row grid2">
        <div class="cell">
          <div class="toTitle">TO:</div>
          <div class="toText">${toLines}</div>
          <div style="margin-top: 2mm; font-weight: 900; font-size: 10pt;">
            ${pin ? `PIN:${escapeHtml(pin)}` : ""}
          </div>
        </div>
        <div class="cell" style="padding: 0;">
          <div class="barcodeWrap" style="border-bottom: 1px solid #000;">
            ${topBarcode ? `<img class="barcodeImg" src="${topBarcode}" alt="awb-barcode" />` : ""}
            ${awb ? `<div class="awbText">${escapeHtml(awb)}</div>` : `<div class="awbText">AWB: —</div>`}
          </div>
          <div style="display:flex; justify-content:center; align-items:center; height: 100%;">
            <div style="border: 2px solid #000; width: 32mm; height: 22mm; display:flex; align-items:center; justify-content:center; font-size: 36pt; font-weight: 900;">
              Z
            </div>
          </div>
        </div>
      </div>

      <div class="row" style="display:flex; align-items:flex-end; padding: 2.5mm; gap: 3mm;">
        <div>
          <div class="pinBig">${escapeHtml(pin || "—")}</div>
          <div class="service">${escapeHtml(courierType || "")}</div>
        </div>
        <div style="margin-left:auto; font-weight:900; font-size: 11pt;">E-Way Bill:</div>
      </div>

      <div class="row modeRow" style="padding: 0 2.5mm;">
        <div class="mode">Mode: AR</div>
        <div class="pcs">Pcs: 001&nbsp;&nbsp;OF&nbsp;&nbsp;001</div>
      </div>

      <div class="row">
        <div class="productGrid">
          <div class="productLeft">
            <div class="prodTitle">Product Description:</div>
          </div>
          <div class="productRight">
            <div class="codeBox">
              <div class="codeSmall">ORG</div>
              <div class="codeBig">L02</div>
            </div>
            <div class="codeBox">
              <div class="codeSmall">DST</div>
              <div class="codeBig">M47</div>
            </div>
            <div class="codeBox">
              <div class="payFlag">${escapeHtml(paymentFlag || "")}</div>
              <div class="payNote">${paymentFlag === "COD" ? "Collect money" : "Don't collect money"}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="row bottomBarcodeRow">
        ${bottomBarcode ? `<img class="barcodeImg" src="${bottomBarcode}" alt="bottom-barcode" />` : ""}
        <div class="bottomCodeText">${escapeHtml(bottomBarcodeText)}</div>
      </div>

      <div class="row footerRow">
        <div><b>Ref. No:</b> ${escapeHtml(orderName)}</div>
        <div class="footerCenter">Weight: 1/${escapeHtml(weightKg)}</div>
        <div class="footerRight">${escapeHtml(shipDate)}</div>
      </div>
      </div>
    </div>
  </body>
</html>`;
}
