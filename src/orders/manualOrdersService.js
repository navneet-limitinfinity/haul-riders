import { reserveOrderSequences, formatManualOrderName } from "../firestore/orderSequence.js";
import { allocateAwbFromPool } from "../awb/awbPoolService.js";
import { buildSearchTokensFromDoc } from "../firestore/searchTokens.js";
import { reserveHrGids } from "../firestore/hrGid.js";
import { getPincodeInfo } from "../pincodes/serviceablePins.js";

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

function normalizePin6(value) {
  return String(value ?? "").replaceAll(/\D/g, "").slice(0, 6);
}

function normalizePhoneDigits(value) {
  return String(value ?? "").replaceAll(/\D/g, "");
}

function normalizePhone10Strict(value) {
  const digits = normalizePhoneDigits(value);
  return digits.length === 10 ? digits : "";
}

function normalizeCourierPartner(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase() === "dtdc") return "DTDC";
  return raw;
}

function normalizeCourierTypeActive(value) {
  const raw = String(value ?? "").trim();
  const allowed = new Set(["Z- Express", "D- Surface", "D- Air"]);
  if (allowed.has(raw)) return raw;
  // Common variants
  const key = raw.toLowerCase().replaceAll(/\s+/g, " ");
  if (key === "z express" || key === "z- express") return "Z- Express";
  if (key === "d surface" || key === "d- surface") return "D- Surface";
  if (key === "d air" || key === "d- air") return "D- Air";
  return "";
}

function formatFulfillmentCenterString(center) {
  const c = center && typeof center === "object" ? center : null;
  if (!c) return "";
  const contactPersonName = String(c.contactPersonName ?? "").trim();
  const parts = [
    String(c.address1 ?? "").trim(),
    String(c.address2 ?? "").trim(),
    String(c.city ?? "").trim(),
    String(c.state ?? "").trim(),
    String(c.pinCode ?? "").trim(),
    String(c.country ?? "").trim(),
  ].filter(Boolean);
  const addr = parts.join(", ");
  // Per requirement: do NOT include originName in orders (originName is shop reference only).
  // Per requirement: do NOT store fulfillment center phone inside orders.
  return [contactPersonName, addr].filter(Boolean).join(" | ");
}

function getRowValue(row, key) {
  return String(row?.[key] ?? "").trim();
}

function normalizeHeaderKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
}

function pickRowValue(row, keys) {
  const aliases = Array.isArray(keys) ? keys : [];
  for (const key of aliases) {
    const v = String(row?.[key] ?? "").trim();
    if (v) return v;
  }

  // XLSX/CSV exporters often change header casing/spaces. Try normalized header matching.
  const data = row && typeof row === "object" ? row : {};
  const normalized = new Map();
  for (const [k, vRaw] of Object.entries(data)) {
    const v = String(vRaw ?? "").trim();
    if (!v) continue;
    const nk = normalizeHeaderKey(k);
    if (!nk) continue;
    if (!normalized.has(nk)) normalized.set(nk, v);
  }

  for (const key of aliases) {
    const nk = normalizeHeaderKey(key);
    if (!nk) continue;
    const direct = normalized.get(nk);
    if (direct) return direct;
  }

  // Last-resort: match common suffixes like "customerCity" / "townCity".
  for (const key of aliases) {
    const nk = normalizeHeaderKey(key);
    if (!nk || nk.length < 3) continue;
    for (const [k2, v2] of normalized.entries()) {
      if (k2.endsWith(nk)) return v2;
    }
  }

  return "";
}

function resolveShopDomainFromStoreKey(storeKey) {
  const raw = String(storeKey ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes(".")) return raw;
  return `${raw}.myshopify.com`;
}

function normalizeCenterForOrder(data) {
  const d = data && typeof data === "object" ? data : {};
  const originName = String(d.originName ?? "").trim();
  if (!originName) return null;
  return {
    originName,
    contactPersonName: String(d.contactPersonName ?? "").trim(),
    address1: String(d.address1 ?? "").trim(),
    address2: String(d.address2 ?? "").trim(),
    city: String(d.city ?? "").trim(),
    state: String(d.state ?? "").trim(),
    pinCode: String(d.pinCode ?? "").trim(),
    country: String(d.country ?? "IN").trim() || "IN",
    phone: String(d.phone ?? "").trim(),
    default: Boolean(d.default),
  };
}

async function loadFulfillmentCentersMap({ firestore, shopsCollection, storeKey, shopDomain }) {
  const domain = String(shopDomain ?? "").trim().toLowerCase() || resolveShopDomainFromStoreKey(storeKey);
  if (!domain) return { byName: new Map(), defaultCenter: null };
  const col = firestore.collection(shopsCollection).doc(domain).collection("fulfillmentCenter");
  try {
    const snap = await col.get();
    const byName = new Map();
    let defaultCenter = null;
    for (const doc of snap.docs) {
      const center = normalizeCenterForOrder(doc.data());
      if (!center) continue;
      byName.set(center.originName, center);
      if (!defaultCenter && center.default) defaultCenter = center;
    }
    if (!defaultCenter) defaultCenter = byName.values().next().value ?? null;
    return { byName, defaultCenter };
  } catch {
    return { byName: new Map(), defaultCenter: null };
  }
}

function normalizeManualRow(row) {
  // Support both legacy (camelCase) and new keys.
  const paymentStatusInput = pickRowValue(row, ["paymentStatus", "payment_status", "payment_mode", "paymentMode"]);
  const paymentStatusRaw = String(paymentStatusInput ?? "").trim().toLowerCase();
  const paymentStatus = paymentStatusRaw === "paid" ? "paid" : "";
  const invoiceValueRaw = safeNumber(
    pickRowValue(row, ["invoiceValue", "invoice_value", "Invoice Value", "invoiceValueInr"])
  );
  const totalPriceRaw = safeNumber(
    pickRowValue(row, [
      "totalPrice",
      "total_price_including_gst",
      "Total Price",
      "invoice_value",
      "invoiceValue",
      "invoiceValueInr",
    ])
  );
  const financialStatusRaw =
    pickRowValue(row, ["financialStatus", "financial_status", "Financial Status"]) ||
    (paymentStatus === "paid" ? "paid" : "");

  const phone2Input = pickRowValue(row, ["phone2", "phone_2"]);
  const phone2Provided = Boolean(String(phone2Input ?? "").trim());

  return {
    // Kept for backward compatibility (we no longer persist orderKey/orderName in Firestore).
    orderKey: getRowValue(row, "orderKey") || getRowValue(row, "order_key"),
    orderId: pickRowValue(row, ["orderId", "order_id", "Order ID", "orderName", "order_name", "Order Name"]),
    orderGid: pickRowValue(row, ["orderGid", "order_gid", "orderGID"]),
    orderDate: pickRowValue(row, ["orderDate", "order_date", "createdAt", "orderCreatedAt"]),
    fullName: pickRowValue(row, ["fullName", "Full Name", "name", "Name", "customer_name", "customerName"]),
    customerEmail: pickRowValue(row, ["customerEmail", "Customer Email", "email", "Email"]),
    phone1: normalizePhone10Strict(pickRowValue(row, ["phone1", "phone_1", "phone", "phone_1"])),
    phone2: normalizePhone10Strict(phone2Input),
    phone2Provided,
    address1: pickRowValue(row, ["address1", "Address 1", "address_line_1", "addressLine1", "address_line1"]),
    address2: pickRowValue(row, ["address2", "Address 2", "address_line_2", "addressLine2", "address_line2"]),
    city: pickRowValue(row, ["city", "City"]),
    state: pickRowValue(row, ["state", "State"]),
    pinCode: pickRowValue(row, ["pinCode", "PIN Code", "Pin Code", "pincode", "pin_code"]),
    totalPrice: totalPriceRaw || invoiceValueRaw,
    financialStatus: financialStatusRaw,
    paymentStatus,
    productDescription: pickRowValue(row, ["productDescription", "content_and_quantity", "product_description", "Item & Quantity"]),
    invoiceValue: invoiceValueRaw,
    fulfillmentCenter: pickRowValue(row, ["fulfillmentCenter", "fulfillment_center"]),
    fulfillmentStatus: pickRowValue(row, ["fulfillmentStatus", "fulfillment_status"]),
    weight: safeNumber(pickRowValue(row, ["weightKg", "weight", "weight_kg"])),
    courier_type: normalizeCourierTypeActive(
      pickRowValue(row, ["courierType", "courier_type", "courierTypeName", "courierTypeValue"])
    ),
    courierPartner: normalizeCourierPartner(
      pickRowValue(row, ["courierPartner", "courier_partner", "Courier Partner", "courier"])
    ),
    ewayBill: pickRowValue(row, ["ewayBill", "eway_bill", "eWayBill", "ewayBillNumber", "ewayBillNo", "eway_bill_number"]),
  };
}

function validateManualRow(normalized, rowIndex) {
  const required = [
    "fullName",
    "phone1",
    "address1",
    "city",
    "state",
    "pinCode",
    "totalPrice",
    "paymentStatus",
    "courier_type",
  ];
  const missing = required.filter((k) => !String(normalized?.[k] ?? "").trim());
  if (missing.length) {
    return { ok: false, error: `Row ${rowIndex + 2}: missing ${missing.join(", ")}` };
  }

  if (!String(normalized.phone1 ?? "").trim() || String(normalized.phone1).length !== 10) {
    return { ok: false, error: `Row ${rowIndex + 2}: phone1 must be exactly 10 digits` };
  }
  if (normalized.phone2Provided && (!String(normalized.phone2 ?? "").trim() || String(normalized.phone2).length !== 10)) {
    return { ok: false, error: `Row ${rowIndex + 2}: phone2 must be exactly 10 digits (or leave blank)` };
  }

  if (String(normalized.paymentStatus ?? "").trim().toLowerCase() !== "paid") {
    return { ok: false, error: `Row ${rowIndex + 2}: paymentStatus must be paid` };
  }

  const courierPartner = String(normalized.courierPartner ?? "").trim();
  if (courierPartner && courierPartner !== "DTDC") {
    return { ok: false, error: `Row ${rowIndex + 2}: courierPartner must be DTDC` };
  }
  if (!String(normalized.courier_type ?? "").trim()) {
    return { ok: false, error: `Row ${rowIndex + 2}: courierType must be one of Z- Express, D- Surface, D- Air` };
  }

  const invoiceValueNumber = Number(normalized.invoiceValue || normalized.totalPrice || "");
  if (Number.isFinite(invoiceValueNumber) && invoiceValueNumber > 49999 && !String(normalized.ewayBill ?? "").trim()) {
    return {
      ok: false,
      error: `Row ${rowIndex + 2}: ewayBill is required for invoice values above 49,999`,
    };
  }

  return { ok: true, error: "" };
}

function buildManualOrderDoc({ normalized, index, storeId, displayName, user, fulfillmentCenterString, hrGid }) {
  // Per requirement: Order Date should reflect upload/create time.
  const createdAt = nowIso();
  const ewayValue = String(normalized.ewayBill ?? "").trim();

  const order = {
    index,
    orderId: String(normalized.orderId ?? normalized.orderKey ?? "").trim(),
    orderGid: String(normalized.orderGid ?? "").trim(),
    createdAt,
    customerEmail: normalized.customerEmail,
    financialStatus: normalized.financialStatus,
    paymentStatus: normalized.paymentStatus || normalized.financialStatus,
    totalPrice: safeNumber(normalized.totalPrice),
    invoiceValue: safeNumber(normalized.invoiceValue || normalized.totalPrice),
    productDescription: normalized.productDescription,
    fulfillmentCenter: fulfillmentCenterString || "",
    fulfillmentStatus: normalized.fulfillmentStatus || "fulfilled",
    ewayBill: ewayValue,
    shipping: {
      fullName: normalized.fullName,
      address1: normalized.address1,
      address2: normalized.address2,
      city: normalized.city,
      state: normalized.state,
      pinCode: normalized.pinCode,
      phone1: normalized.phone1,
      phone2: normalized.phone2,
    },
  };

  const ts = nowIso();
  const searchTokens = buildSearchTokensFromDoc({
    order,
    consignmentNumber: "",
    courierPartner: String(normalized.courierPartner ?? "").trim() || "DTDC",
    courierType: normalized.courier_type || "",
  });
  return {
    ...(hrGid ? { hrGid: String(hrGid).trim() } : {}),
    docId: String(hrGid ?? "").trim(),
    storeId,
    shopName: displayName,
    order,
    shipmentStatus: "New",
    courierPartner: String(normalized.courierPartner ?? "").trim() || "DTDC",
    consignmentNumber: "",
    searchTokens,
    weightKg: normalized.weight || "",
    courierType: normalized.courier_type || "",
    shippingDate: "",
    expectedDeliveryDate: "",
    updatedAt: ts,
    event: "manual_order_create",
    ewayBill: ewayValue,
    requestedBy: {
      uid: String(user?.uid ?? ""),
      email: String(user?.email ?? ""),
      role: String(user?.role ?? ""),
    },
    requestedAt: ts,
  };
}

export async function createManualOrders({
  firestore,
  collectionId,
  storeId,
  storeKey = "",
  shopDomain = "",
  displayName,
  user,
  shopsCollection = "shops",
  rows,
}) {
  const inputRows = Array.isArray(rows) ? rows : [];
  if (!inputRows.length) return { total: 0, created: 0, updated: 0, failed: 0, errors: [], orders: [] };

  const normalizedRows = inputRows.map((r) => normalizeManualRow(r));

  const { byName: centersByName, defaultCenter } = await loadFulfillmentCentersMap({
    firestore,
    shopsCollection,
    storeKey,
    shopDomain,
  });

  const missingOrderIdIndexes = [];
  for (let i = 0; i < normalizedRows.length; i += 1) {
    if (!String(normalizedRows[i].orderId ?? "").trim() && !String(normalizedRows[i].orderKey ?? "").trim()) {
      missingOrderIdIndexes.push(i);
    }
  }

  let sequences = [];
  if (missingOrderIdIndexes.length) {
    sequences = await reserveOrderSequences({ firestore, count: missingOrderIdIndexes.length });
  }

  for (let i = 0; i < missingOrderIdIndexes.length; i += 1) {
    const idx = missingOrderIdIndexes[i];
    const seq = sequences[i];
    const orderId = formatManualOrderName(seq);
    normalizedRows[idx].orderId = orderId;
    normalizedRows[idx].orderKey = orderId;
  }

  for (const r of normalizedRows) {
    if (!String(r.orderKey ?? "").trim()) r.orderKey = String(r.orderId ?? "").trim();
    if (!String(r.orderId ?? "").trim()) r.orderId = String(r.orderKey ?? "").trim();
  }

  const errors = [];
  const orders = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < normalizedRows.length; i += 1) {
    const norm = normalizedRows[i];

    // Autofill city/state from pincode master if missing.
    norm.pinCode = normalizePin6(norm.pinCode);
    if (norm.pinCode && (String(norm.city ?? "").trim() === "" || String(norm.state ?? "").trim() === "")) {
      const info = getPincodeInfo(norm.pinCode);
      if (info) {
        if (!String(norm.city ?? "").trim()) norm.city = String(info.district ?? "").trim();
        if (!String(norm.state ?? "").trim()) norm.state = String(info.state ?? "").trim();
      }
    }

    // If fulfillmentCenter is missing in CSV, use the store's default fulfillment center.
    if (!String(norm.fulfillmentCenter ?? "").trim()) {
      const defName = String(defaultCenter?.originName ?? "").trim();
      if (defName) norm.fulfillmentCenter = defName;
    }

    const validation = validateManualRow(norm, i);
    if (!validation.ok) {
      failed += 1;
      errors.push(validation.error);
      continue;
    }
    if (!String(norm.orderKey ?? "").trim() || !String(norm.orderId ?? "").trim()) {
      failed += 1;
      errors.push(`Row ${i + 2}: missing orderId`);
      continue;
    }

    const orderId = String(norm.orderId ?? "").trim();
    let docRef = null;
    let existing = null;
    let docId = "";

    // Upsert behavior: find existing doc by orderId (unique for onboarding/manual orders).
    try {
      const found = await firestore
        .collection(collectionId)
        .where("order.orderId", "==", orderId)
        .limit(2)
        .get();
      const match =
        found.docs.find((d) => String(d.data()?.storeId ?? "").trim() === String(storeId ?? "").trim()) ??
        found.docs[0] ??
        null;
      if (match) {
        existing = match;
        docRef = match.ref;
        docId = match.id;
      }
    } catch {
      // ignore lookup errors; will create new doc
    }

    if (!docRef) {
      const allocated = (await reserveHrGids({ firestore, count: 1 }))[0] || "";
      const hrGidNew = String(allocated ?? "").trim();
      if (!hrGidNew) {
        failed += 1;
        errors.push(`Row ${i + 2}: hrGid_allocation_failed`);
        continue;
      }
      docId = hrGidNew;
      docRef = firestore.collection(collectionId).doc(docId);
    }

    const centerName = String(norm.fulfillmentCenter ?? "").trim();
    const fulfillmentCenterAddress = centerName ? centersByName.get(centerName) ?? null : defaultCenter;
    const fulfillmentCenterString = fulfillmentCenterAddress ? formatFulfillmentCenterString(fulfillmentCenterAddress) : "";
    try {
      const existingSnap = existing || (await docRef.get());
      const existingData = existingSnap.data() ?? {};
      const existingHrGid = String(existingData?.hrGid ?? docId ?? "").trim();
      const hrGid = existingHrGid || String(docId ?? "").trim();
      const doc = buildManualOrderDoc({
        normalized: { ...norm, orderKey: norm.orderKey, orderId: norm.orderId },
        index: i + 1,
        storeId,
        displayName,
        user,
        fulfillmentCenterString,
        hrGid,
      });
      await docRef.set(doc, { merge: true });
      if (existingSnap.exists) updated += 1;
      else created += 1;

      orders.push({
        orderId: norm.orderId,
        docId,
        fullName: norm.fullName,
        phone1: norm.phone1,
        city: norm.city,
        totalPrice: norm.totalPrice,
      });
    } catch (error) {
      failed += 1;
      errors.push(`Row ${i + 2}: ${String(error?.message ?? error ?? "write_failed")}`);
    }
  }

  return {
    total: inputRows.length,
    created,
    updated,
    failed,
    errors,
    orders,
  };
}

export async function assignManualOrders({
  firestore,
  collectionId,
  storeId,
  displayName,
  user,
  orderKeys,
}) {
  const keys = Array.isArray(orderKeys)
    ? orderKeys.map((k) => String(k ?? "").trim()).filter(Boolean)
    : [];
  if (!keys.length) return { ok: true, updated: 0, missing: [] };
  if (keys.length > 100) throw new Error("order_keys_limit_exceeded");

  const ts = nowIso();
  const missing = [];
  let updated = 0;

  for (const orderKey of keys) {
    const orderId = String(orderKey ?? "").trim();
    let snap = null;
    try {
      const found = await firestore
        .collection(collectionId)
        .where("order.orderId", "==", orderId)
        .limit(2)
        .get();
      snap =
        found.docs.find((d) => String(d.data()?.storeId ?? "").trim() === String(storeId ?? "").trim()) ??
        found.docs[0] ??
        null;
    } catch {
      snap = null;
    }
    if (!snap) {
      missing.push(orderKey);
      continue;
    }
    const docRef = snap.ref;

    const data = snap.data() ?? {};
    const existingDisplayStatus = String(data?.shipmentStatus ?? data?.shipment_status ?? "").trim();
    if (existingDisplayStatus === "Assigned") continue;

    const existingConsignment = String(data?.consignmentNumber ?? data?.consignment_number ?? "").trim();
    const courierType = String(data?.courierType ?? data?.courier_type ?? "").trim();
    const orderIdValue = String(data?.order?.orderId ?? "").trim();
    let allocatedAwb = existingConsignment;
    if (!allocatedAwb) {
      try {
        const alloc = await allocateAwbFromPool({
          firestore,
          courierType,
          docId: snap.id,
          assignedStoreId: storeId,
          orderId: orderIdValue,
        });
        allocatedAwb = String(alloc?.awbNumber ?? "").trim();
      } catch {
        missing.push(orderKey);
        continue;
      }
    }

    await docRef.set(
      {
        shipmentStatus: "Assigned",
        shippingDate: ts,
        courierPartner: String(data?.courierPartner ?? data?.courier_partner ?? "").trim() || "DTDC",
        consignmentNumber: allocatedAwb,
        updatedAt: ts,
        // Ensure hrGid exists for onboarding orders.
        ...(String(data?.hrGid ?? "").trim() ? {} : { hrGid: (await reserveHrGids({ firestore, count: 1 }))[0] || "" }),
        event: "manual_assign",
        requestedBy: {
          uid: String(user?.uid ?? ""),
          email: String(user?.email ?? ""),
          role: String(user?.role ?? ""),
        },
        requestedAt: ts,
        storeId,
        shopName: displayName,
      },
      { merge: true }
    );
    updated += 1;
  }

  return { ok: true, updated, missing };
}
