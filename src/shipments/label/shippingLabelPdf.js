import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bwipjs from "bwip-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getFirebaseAdmin } from "../../auth/firebaseAdmin.js";
import { resolveShipFrom } from "./resolveShipFrom.js";
import { extractAwbNumber } from "./extractAwb.js";

const normalizeDomain = (domain) => String(domain ?? "").trim().toLowerCase();

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

async function resolveDefaultFulfillmentCenterName({ env, shopDomain }) {
  if (env?.auth?.provider !== "firebase") return "";
  const domain = normalizeDomain(shopDomain);
  if (!domain) return "";

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

  const centersCol = firestore.collection(shopsCollection).doc(domain).collection("fulfillmentCenter");

  try {
    const defaultSnap = await centersCol.where("default", "==", true).limit(1).get();
    const defaultDoc = defaultSnap.docs[0];
    if (defaultDoc?.exists) {
      const data = defaultDoc.data() ?? {};
      return String(data?.originName ?? "").trim();
    }
  } catch {
    // ignore
  }

  try {
    const firstSnap = await centersCol.limit(1).get();
    const firstDoc = firstSnap.docs[0];
    if (firstDoc?.exists) {
      const data = firstDoc.data() ?? {};
      return String(data?.originName ?? "").trim();
    }
  } catch {
    // ignore
  }

  return "";
}

async function resolveFulfillmentCenter({ env, shopDomain, originName }) {
  if (env?.auth?.provider !== "firebase") return null;
  const domain = normalizeDomain(shopDomain);
  if (!domain) return null;

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";
  const centersCol = firestore.collection(shopsCollection).doc(domain).collection("fulfillmentCenter");

  const normalizeCenter = (data) => {
    const d = data && typeof data === "object" ? data : {};
    const origin = String(d.originName ?? "").trim();
    if (!origin) return null;
    return {
      originName: origin,
      address1: String(d.address1 ?? "").trim(),
      address2: String(d.address2 ?? "").trim(),
      city: String(d.city ?? "").trim(),
      state: String(d.state ?? "").trim(),
      pinCode: String(d.pinCode ?? "").trim(),
      country: String(d.country ?? "").trim() || "IN",
      phone: String(d.phone ?? "").trim(),
      default: Boolean(d.default),
    };
  };

  const requested = String(originName ?? "").trim();
  if (requested) {
    try {
      const match = await centersCol.where("originName", "==", requested).limit(1).get();
      const doc = match.docs[0];
      if (doc?.exists) return normalizeCenter(doc.data());
    } catch {
      // ignore
    }
  }

  try {
    const def = await centersCol.where("default", "==", true).limit(1).get();
    const doc = def.docs[0];
    if (doc?.exists) return normalizeCenter(doc.data());
  } catch {
    // ignore
  }

  try {
    const first = await centersCol.limit(1).get();
    const doc = first.docs[0];
    if (doc?.exists) return normalizeCenter(doc.data());
  } catch {
    // ignore
  }

  return null;
}

async function resolveBrandingLogo({ env, shopDomain }) {
  if (env?.auth?.provider !== "firebase") return null;
  const domain = normalizeDomain(shopDomain);
  if (!domain) return null;

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

  const docRef = firestore.collection(shopsCollection).doc(domain).collection("branding").doc("logo");
  const snap = await docRef.get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  const contentType = String(data?.contentType ?? "").trim().toLowerCase();
  if (contentType !== "image/png" && contentType !== "image/jpeg") return null;
  const stored = data?.data ?? null;
  let bytes = null;
  if (stored && typeof stored?.toUint8Array === "function") {
    bytes = stored.toUint8Array();
  } else if (stored instanceof Uint8Array) {
    bytes = stored;
  } else if (Buffer.isBuffer(stored)) {
    bytes = Uint8Array.from(stored);
  }
  if (!bytes || bytes.length === 0) return null;

  return { contentType, bytes };
}

async function resolveStoreName({ env, shopDomain }) {
  if (env?.auth?.provider !== "firebase") return "";
  const domain = normalizeDomain(shopDomain);
  if (!domain) return "";

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

  try {
    const snap = await firestore.collection(shopsCollection).doc(domain).get();
    const data = snap.exists ? snap.data() ?? {} : {};
    const details = data?.storeDetails && typeof data.storeDetails === "object" ? data.storeDetails : {};
    return String(details?.storeName ?? "").trim();
  } catch {
    return "";
  }
}

export async function generateShippingLabelPdfBuffer({ env, shopDomain, firestoreDoc }) {
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

  const shipFrom = await resolveShipFrom({ env, shopDomain });
  const fulfillmentCenterName = String(order?.fulfillmentCenter ?? data?.fulfillmentCenter ?? "").trim();
  const fulfillmentCenter = await resolveFulfillmentCenter({
    env,
    shopDomain,
    originName: fulfillmentCenterName,
  });
  const fulfillmentCenterLabel =
    fulfillmentCenter?.originName ||
    fulfillmentCenterName ||
    (await resolveDefaultFulfillmentCenterName({ env, shopDomain }));
  const brandingLogo = await resolveBrandingLogo({ env, shopDomain });
  const storeName = await resolveStoreName({ env, shopDomain });
  const shipTo = getBestShipTo(order) ?? {};
  const pin = String(shipTo?.pinCode ?? "").trim();

  const awb = extractAwbNumber({ firestoreDoc: data });
  const courierType = String(data?.courierType ?? data?.courier_type ?? "").trim();
  const orderName = String(order?.orderName ?? order?.name ?? "").trim();

  const shipValue = String(order?.totalPrice ?? order?.total_price ?? "").trim();
  const paymentFlag = getPaymentFlag(order?.financialStatus ?? order?.financial_status);
  const paymentNote = paymentFlag === "COD" ? "Collect money" : "Don't collect money";

  const weightRaw = data?.weightKg ?? data?.weight;
  const weightKg = weightRaw == null || Number.isNaN(Number(weightRaw)) ? "0.0" : String(weightRaw);

  const fields = map?.fields ?? {};
  const fixedText = Array.isArray(map?.fixedText) ? map.fixedText : [];
  const productDescriptionLabel =
    fixedText.find((t) => t && typeof t === "object" && String(t.key ?? "") === "productDescription") ??
    null;

  // Render fixed labels (field names) from the template map.
  for (const t of fixedText) {
    if (!t || typeof t !== "object") continue;
    if (String(t.key ?? "") === "productDescription") continue;
    const text = String(t.text ?? "").trim();
    if (!text) continue;
    const font = t.bold ? fontBold : fontRegular;
    const size = Number(t.size ?? 10) || 10;
    page.drawText(text, { x: Number(t.x ?? 0), y: Number(t.y ?? 0), size, font, color: black });
  }

  // Branding logo + Store Name (placed in Product Description area; label removed).
  if (brandingLogo) {
    try {
      const { contentType, bytes } = brandingLogo;
      const img =
        contentType === "image/png"
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);

      const anchorX = Number(productDescriptionLabel?.x ?? 31);
      const anchorY = Number(productDescriptionLabel?.y ?? 286.76);

      const maxW = 240;
      const maxH = 64;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;

      const imgX = anchorX;
      const imgY = Math.max(0, anchorY - h + 10);
      page.drawImage(img, {
        x: imgX,
        y: imgY,
        width: w,
        height: h,
      });

      if (storeName) {
        const size = 14;
        const preferredX = imgX + w + 10;
        const preferredMaxW = Math.max(1, 250 - (w + 10));
        const canPlaceRight = preferredX <= 260 && preferredMaxW >= 60;
        if (canPlaceRight) {
          const lines = wrapText({
            text: storeName,
            font: fontBold,
            size,
            maxWidth: preferredMaxW,
          }).slice(0, 1);
          if (lines[0]) {
            page.drawText(lines[0], { x: preferredX, y: imgY + h - size - 2, size, font: fontBold, color: black });
          }
        } else {
          const lines = wrapText({
            text: storeName,
            font: fontBold,
            size,
            maxWidth: 260,
          }).slice(0, 1);
          if (lines[0]) {
            page.drawText(lines[0], { x: imgX, y: Math.max(0, imgY - size - 6), size, font: fontBold, color: black });
          }
        }
      }
    } catch {
      // ignore branding render failures
    }
  } else if (storeName) {
    try {
      const anchorX = Number(productDescriptionLabel?.x ?? 31);
      const anchorY = Number(productDescriptionLabel?.y ?? 286.76);
      const size = 14;
      const lines = wrapText({ text: storeName, font: fontBold, size, maxWidth: 260 }).slice(0, 1);
      if (lines[0]) {
        page.drawText(lines[0], { x: anchorX, y: Math.max(0, anchorY - size), size, font: fontBold, color: black });
      }
    } catch {
      // ignore
    }
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
    // Per requirements: show direct fulfillment address only (no "Haul Riders -" prefix/suffix).
    const fromName = fulfillmentCenterLabel || "";
    const fromAddress1 = fulfillmentCenter?.address1 || shipFrom.address1;
    const fromAddress2 = fulfillmentCenter?.address2 || shipFrom.address2;
    const fromCity = fulfillmentCenter?.city || shipFrom.city;
    const fromState = fulfillmentCenter?.state || shipFrom.state;
    const fromPin = fulfillmentCenter?.pinCode || shipFrom.pinCode;
    const fromCountry = fulfillmentCenter?.country || shipFrom.country;

    const fromLines = [
      fromName,
      fromAddress1,
      fromAddress2,
      [fromCity, fromPin].filter(Boolean).join(" "),
      [fromState, fromCountry].filter(Boolean).join(", "),
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
