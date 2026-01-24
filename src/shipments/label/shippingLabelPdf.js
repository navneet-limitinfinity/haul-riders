import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bwipjs from "bwip-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { resolveShipFrom } from "./resolveShipFrom.js";
import { extractAwbNumber } from "./extractAwb.js";

function formatDateDDMMYYYY(date) {
  const d = date instanceof Date ? date : new Date(String(date ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function formatTimeHHMMSS(date) {
  const d = date instanceof Date ? date : new Date(String(date ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

function getCourierTypeInitial(courierType) {
  const s = String(courierType ?? "").trim();
  if (!s) return "";
  const m = s.match(/[A-Za-z]/);
  return m?.[0] ? m[0].toUpperCase() : "";
}

function getBestShipTo(order) {
  const projected = order?.shipping && typeof order.shipping === "object" ? order.shipping : null;
  if (projected) {
    const phone1 = normalizePhone10(projected.phone1 ?? "");
    const phone2 = normalizePhone10(projected.phone2 ?? "");
    return {
      name: String(projected.fullName ?? "").trim(),
      address1: String(projected.address1 ?? "").trim(),
      address2: String(projected.address2 ?? "").trim(),
      city: String(projected.city ?? "").trim(),
      state: String(projected.state ?? "").trim(),
      pinCode: String(projected.pinCode ?? "").trim(),
      phone1,
      phone2,
      phoneText: [phone1, phone2].filter(Boolean).join(" "),
      country: "IN",
    };
  }

  const raw = order?.shipping_address ?? order?.customer?.default_address ?? null;
  if (!raw || typeof raw !== "object") return null;
  const phone1 = normalizePhone10(raw.phone ?? order?.phone ?? "");
  const phone2 = normalizePhone10(order?.phone ?? "");
  return {
    name: String(raw.name ?? "").trim(),
    address1: String(raw.address1 ?? "").trim(),
    address2: String(raw.address2 ?? "").trim(),
    city: String(raw.city ?? "").trim(),
    state: String(raw.province ?? "").trim(),
    pinCode: String(raw.zip ?? "").trim(),
    phone1,
    phone2,
    phoneText: [phone1, phone2].filter(Boolean).join(" "),
    country: String(raw.country_code ?? raw.country ?? "IN").trim() || "IN",
  };
}

function wrapText({ text, font, size, maxWidth }) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const words = raw.split(/\s+/g);
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = w;
  }
  if (current) lines.push(current);
  return lines;
}

async function makeCode128Png(text, { scale = 2, height = 10 } = {}) {
  const clean = String(text ?? "").trim();
  if (!clean) return null;
  return bwipjs.toBuffer({
    bcid: "code128",
    text: clean,
    includetext: false,
    scale,
    height,
    backgroundcolor: "FFFFFF",
  });
}

async function loadTemplateAssets() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const mapPath = path.join(dir, "docketTemplateMap.json");
  const mapRaw = await fs.readFile(mapPath, "utf8");
  const map = JSON.parse(mapRaw);

  const blankPdfPath = path.resolve(process.cwd(), String(map?.template?.blankPdf ?? ""));
  const blankBytes = await fs.readFile(blankPdfPath);

  return { map, blankBytes };
}

function rectFromMatrix({ rect, bbox }) {
  // matrix e/f = translate, a/d = scale, bbox is in unscaled units
  if (!rect || !bbox) return null;
  const bboxW = (bbox?.[2] ?? 0) - (bbox?.[0] ?? 0);
  const bboxH = (bbox?.[3] ?? 0) - (bbox?.[1] ?? 0);
  const w = bboxW * (rect.sx ?? 1);
  const h = bboxH * (rect.sy ?? 1);
  return { x: rect.x, y: rect.y, width: w, height: h };
}

let templateAssetsPromise = null;

async function getTemplateAssets() {
  if (templateAssetsPromise) return templateAssetsPromise;
  templateAssetsPromise = loadTemplateAssets().catch((error) => {
    templateAssetsPromise = null;
    throw error;
  });
  return templateAssetsPromise;
}

export async function generateShippingLabelPdfBuffer({ env, storeId, firestoreDoc }) {
  const data = firestoreDoc && typeof firestoreDoc === "object" ? firestoreDoc : {};
  const order = data.order && typeof data.order === "object" ? data.order : null;
  if (!order) {
    const error = new Error("order_missing");
    error.code = "order_missing";
    throw error;
  }

  const { map, blankBytes } = await getTemplateAssets();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const page = pdfDoc.getPage(0);

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);

  const now = new Date();
  const shipDate = formatDateDDMMYYYY(now);
  const shipTime = formatTimeHHMMSS(now);

  const shipFrom = resolveShipFrom({ env, storeId });
  const shipTo = getBestShipTo(order) ?? {};
  const pin = String(shipTo?.pinCode ?? "").trim();

  const awb = extractAwbNumber({ firestoreDoc: data });
  const courierType = String(data?.shipment?.courierType ?? "").trim();
  const orderName = String(order?.orderName ?? order?.name ?? "").trim();

  const shipValue = String(order?.totalPrice ?? order?.total_price ?? "").trim();
  const paymentFlag = getPaymentFlag(order?.financialStatus ?? order?.financial_status);
  const paymentNote = paymentFlag === "COD" ? "Collect money" : "Don't collect money";

  const weightKgRaw = data?.shipment?.weightKg;
  const weightKg =
    weightKgRaw == null || Number.isNaN(Number(weightKgRaw)) ? "0.0" : String(weightKgRaw);

  const fields = map?.fields ?? {};
  const fixedText = Array.isArray(map?.fixedText) ? map.fixedText : [];

  // Render fixed labels (field names) from the template map.
  for (const t of fixedText) {
    if (!t || typeof t !== "object") continue;
    const text = String(t.text ?? "").trim();
    if (!text) continue;
    const font = t.bold ? fontBold : fontRegular;
    const size = Number(t.size ?? 10) || 10;
    page.drawText(text, { x: Number(t.x ?? 0), y: Number(t.y ?? 0), size, font, color: black });
  }

  // Top-right metadata.
  if (fields.shipDate) {
    page.drawText(shipDate, {
      x: fields.shipDate.x,
      y: fields.shipDate.y,
      size: fields.shipDate.size,
      font: fields.shipDate.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  if (fields.shipValue) {
    page.drawText(shipValue, {
      x: fields.shipValue.x,
      y: fields.shipValue.y,
      size: fields.shipValue.size,
      font: fields.shipValue.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  // FROM block (multiline).
  if (fields.fromBlock) {
    const fromLines = [
      shipFrom.name,
      shipFrom.address1,
      shipFrom.address2,
      [shipFrom.city, shipFrom.pinCode].filter(Boolean).join(" "),
      [shipFrom.state, shipFrom.country].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(" ");

    const lines = wrapText({
      text: fromLines,
      font: fontRegular,
      size: fields.fromBlock.size,
      maxWidth: fields.fromBlock.maxWidth,
    }).slice(0, fields.fromBlock.maxLines);

    for (let i = 0; i < lines.length; i++) {
      page.drawText(lines[i], {
        x: fields.fromBlock.x,
        y: fields.fromBlock.yTop - i * fields.fromBlock.lineHeight,
        size: fields.fromBlock.size,
        font: fontRegular,
        color: black,
      });
    }
  }

  // TO block (multiline).
  if (fields.toBlock) {
    const toLines = [
      shipTo.name ? `${shipTo.name},` : "",
      shipTo.address1,
      shipTo.address2,
      [shipTo.city, shipTo.state].filter(Boolean).join(" "),
      shipTo.phoneText,
      pin ? `${String(shipTo.city ?? "").toUpperCase()}, PIN:${pin}` : "",
      [shipTo.state, shipTo.country].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join("\n");

    const rawLines = toLines.split("\n").filter(Boolean);
    const wrapped = [];
    for (const line of rawLines) {
      wrapped.push(
        ...wrapText({
          text: line,
          font: fontBold,
          size: fields.toBlock.size,
          maxWidth: fields.toBlock.maxWidth,
        })
      );
    }
    const lines = wrapped.slice(0, fields.toBlock.maxLines);
    for (let i = 0; i < lines.length; i++) {
      page.drawText(lines[i], {
        x: fields.toBlock.x,
        y: fields.toBlock.yTop - i * fields.toBlock.lineHeight,
        size: fields.toBlock.size,
        font: fontBold,
        color: black,
      });
    }
  }

  // AWB text + top barcode.
  if (awb && fields.awbText) {
    page.drawText(awb, {
      x: fields.awbText.x,
      y: fields.awbText.y,
      size: fields.awbText.size,
      font: fields.awbText.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  const topBarcodeRect = rectFromMatrix({
    rect: fields.topBarcodeRect,
    bbox: map?.xobjects?.topBarcodeFormBbox,
  });
  if (awb && topBarcodeRect) {
    const barcode = await makeCode128Png(awb, { scale: 2, height: 10 });
    if (barcode) {
      const img = await pdfDoc.embedPng(barcode);
      const pad = 2;
      const maxW = Math.max(1, topBarcodeRect.width - pad * 2);
      const maxH = Math.max(1, topBarcodeRect.height - pad * 2);
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: topBarcodeRect.x + (topBarcodeRect.width - w) / 2,
        y: topBarcodeRect.y + (topBarcodeRect.height - h) / 2,
        width: w,
        height: h,
      });
    }
  }

  // Big PIN + service.
  if (pin && fields.pinBig) {
    page.drawText(pin, {
      x: fields.pinBig.x,
      y: fields.pinBig.y,
      size: fields.pinBig.size,
      font: fields.pinBig.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  if (courierType && fields.service) {
    page.drawText(courierType, {
      x: fields.service.x,
      y: fields.service.y,
      size: fields.service.size,
      font: fields.service.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  // Courier-type initial box (below AWB barcode) + label.
  const courierInitial = getCourierTypeInitial(courierType);
  if (courierInitial && fields.courierTypeInitial) {
    page.drawText(courierInitial, {
      x: fields.courierTypeInitial.x,
      y: fields.courierTypeInitial.y,
      size: fields.courierTypeInitial.size,
      font: fields.courierTypeInitial.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  // Payment flag/note.
  if (paymentFlag && fields.paymentFlag) {
    page.drawText(paymentFlag, {
      x: fields.paymentFlag.x,
      y: fields.paymentFlag.y,
      size: fields.paymentFlag.size,
      font: fields.paymentFlag.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  if (paymentNote && fields.paymentNote) {
    page.drawText(paymentNote, {
      x: fields.paymentNote.x,
      y: fields.paymentNote.y,
      size: fields.paymentNote.size,
      font: fields.paymentNote.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  // Bottom barcode uses awb+pin as a stable id.
  const bottomBarcodeRect = rectFromMatrix({
    rect: fields.bottomBarcodeRect,
    bbox: map?.xobjects?.bottomBarcodeFormBbox,
  });
  const bottomCode = [awb || orderName || String(data?.orderKey ?? "").trim(), pin]
    .filter(Boolean)
    .join("");
  if (bottomCode && bottomBarcodeRect) {
    const barcode = await makeCode128Png(bottomCode, { scale: 2, height: 14 });
    if (barcode) {
      const img = await pdfDoc.embedPng(barcode);
      const pad = 2;
      const maxW = Math.max(1, bottomBarcodeRect.width - pad * 2);
      const maxH = Math.max(1, bottomBarcodeRect.height - pad * 2);
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: bottomBarcodeRect.x + (bottomBarcodeRect.width - w) / 2,
        y: bottomBarcodeRect.y + (bottomBarcodeRect.height - h) / 2,
        width: w,
        height: h,
      });
    }
  }

  // Ref. No value.
  if (orderName && fields.refNoValue) {
    page.drawText(orderName, {
      x: fields.refNoValue.x,
      y: fields.refNoValue.y,
      size: fields.refNoValue.size,
      font: fields.refNoValue.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  // Weight + bottom date/time.
  if (fields.weight) {
    // Label "Weight:" is part of fixedText; here we render only the value.
    page.drawText(`1/${weightKg}`, {
      x: fields.weight.x,
      y: fields.weight.y,
      size: fields.weight.size,
      font: fields.weight.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  if (fields.bottomDate) {
    page.drawText(shipDate, {
      x: fields.bottomDate.x,
      y: fields.bottomDate.y,
      size: fields.bottomDate.size,
      font: fields.bottomDate.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  if (fields.bottomTime) {
    page.drawText(shipTime, {
      x: fields.bottomTime.x,
      y: fields.bottomTime.y,
      size: fields.bottomTime.size,
      font: fields.bottomTime.bold ? fontBold : fontRegular,
      color: black,
    });
  }

  const bytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}
