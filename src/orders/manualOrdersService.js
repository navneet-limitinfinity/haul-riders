import { toOrderDocId } from "../firestore/ids.js";
import { reserveOrderSequences, formatManualOrderName } from "../firestore/orderSequence.js";

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

function normalizePhone10(value) {
  const digits = String(value ?? "").replaceAll(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function getRowValue(row, key) {
  return String(row?.[key] ?? "").trim();
}

function pickRowValue(row, keys) {
  for (const key of Array.isArray(keys) ? keys : []) {
    const v = String(row?.[key] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function normalizeManualRow(row) {
  // Support both legacy (camelCase) and new keys.
  return {
    orderKey: getRowValue(row, "orderKey") || getRowValue(row, "order_key"),
    orderName: getRowValue(row, "orderName") || getRowValue(row, "order_name") || getRowValue(row, "Order Name"),
    orderDate: pickRowValue(row, ["order_date", "orderDate", "createdAt", "orderCreatedAt"]),
    fullName: pickRowValue(row, ["fullName", "name", "customer_name", "customerName"]),
    customerEmail: pickRowValue(row, ["customerEmail", "email"]),
    phone1: normalizePhone10(pickRowValue(row, ["phone1", "phone_1", "phone", "phone_1"])),
    phone2: normalizePhone10(pickRowValue(row, ["phone2", "phone_2"])),
    address1: pickRowValue(row, ["address1", "address_line_1", "address_line1", "address_line_1"]),
    address2: pickRowValue(row, ["address2", "address_line_2", "address_line2", "address_line_2"]),
    city: pickRowValue(row, ["city"]),
    state: pickRowValue(row, ["state"]),
    pinCode: pickRowValue(row, ["pinCode", "pincode", "pin_code"]),
    totalPrice: safeNumber(pickRowValue(row, ["totalPrice", "total_price_including_gst", "invoice_value", "invoiceValue"])),
    financialStatus: pickRowValue(row, ["financialStatus", "payment_status", "paymentStatus", "payment_mode", "paymentMode"]),
    productDescription: pickRowValue(row, ["content_and_quantity", "productDescription", "product_description"]),
    invoiceValue: safeNumber(pickRowValue(row, ["invoice_value", "invoiceValue"])),
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
    "financialStatus",
  ];
  const missing = required.filter((k) => !String(normalized?.[k] ?? "").trim());
  if (missing.length) {
    return { ok: false, error: `Row ${rowIndex + 2}: missing ${missing.join(", ")}` };
  }
  return { ok: true, error: "" };
}

function buildManualOrderDoc({ normalized, index, storeId, displayName, user }) {
  // Per requirement: Order Date should reflect upload/create time.
  const createdAt = nowIso();

  const phoneNumbers = [normalized.phone1, normalized.phone2].filter(Boolean);

  const order = {
    index,
    orderKey: normalized.orderKey,
    orderId: "",
    orderName: normalized.orderName,
    createdAt,
    customerEmail: normalized.customerEmail,
    financialStatus: normalized.financialStatus,
    paymentStatus: normalized.financialStatus,
    totalPrice: safeNumber(normalized.totalPrice),
    invoiceValue: safeNumber(normalized.invoiceValue || normalized.totalPrice),
    productDescription: normalized.productDescription,
    fulfillmentStatus: "unfulfilled",
    trackingNumbers: [],
    trackingNumbersText: "",
    trackingCompany: "",
    trackingUrl: "",
    shipping: {
      fullName: normalized.fullName,
      address1: normalized.address1,
      address2: normalized.address2,
      city: normalized.city,
      state: normalized.state,
      pinCode: normalized.pinCode,
      phoneNumbers,
      phone1: normalized.phone1,
      phone2: normalized.phone2,
      phoneNumbersText: phoneNumbers.join(", "),
    },
  };

  const ts = nowIso();
  return {
    orderKey: normalized.orderKey,
    docId: toOrderDocId(normalized.orderKey),
    storeId,
    shopName: displayName,
    order,
    shipment: {
      shipmentStatus: "new",
      updatedAt: ts,
    },
    shipmentStatus: "new",
    shipment_status: "New",
    courier_partner: "",
    consignment_number: "",
    weight: "",
    courier_type: "",
    shipping_date: "",
    expected_delivery_date: "",
    updated_at: ts,
    trackingNumber: "",
    event: "manual_order_create",
    requestedBy: {
      uid: String(user?.uid ?? ""),
      email: String(user?.email ?? ""),
      role: String(user?.role ?? ""),
    },
    requestedAt: ts,
    updatedAt: ts,
  };
}

export async function createManualOrders({
  firestore,
  collectionId,
  storeId,
  displayName,
  user,
  rows,
}) {
  const inputRows = Array.isArray(rows) ? rows : [];
  if (!inputRows.length) return { total: 0, created: 0, updated: 0, failed: 0, errors: [], orders: [] };

  const normalizedRows = inputRows.map((r) => normalizeManualRow(r));

  const missingNameIndexes = [];
  for (let i = 0; i < normalizedRows.length; i += 1) {
    if (!String(normalizedRows[i].orderName ?? "").trim()) missingNameIndexes.push(i);
  }

  let sequences = [];
  if (missingNameIndexes.length) {
    sequences = await reserveOrderSequences({ firestore, count: missingNameIndexes.length });
  }

  for (let i = 0; i < missingNameIndexes.length; i += 1) {
    const idx = missingNameIndexes[i];
    const seq = sequences[i];
    const orderName = formatManualOrderName(seq);
    normalizedRows[idx].orderName = orderName;
    if (!String(normalizedRows[idx].orderKey ?? "").trim()) {
      normalizedRows[idx].orderKey = orderName;
    }
  }

  // If orderKey still missing but orderName present, use orderName.
  for (const r of normalizedRows) {
    if (!String(r.orderKey ?? "").trim() && String(r.orderName ?? "").trim()) r.orderKey = r.orderName;
  }

  const errors = [];
  const orders = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < normalizedRows.length; i += 1) {
    const norm = normalizedRows[i];
    const validation = validateManualRow(norm, i);
    if (!validation.ok) {
      failed += 1;
      errors.push(validation.error);
      continue;
    }
    if (!String(norm.orderKey ?? "").trim() || !String(norm.orderName ?? "").trim()) {
      failed += 1;
      errors.push(`Row ${i + 2}: missing orderKey/orderName`);
      continue;
    }

    const docId = toOrderDocId(norm.orderKey);
    const docRef = firestore.collection(collectionId).doc(docId);
    const doc = buildManualOrderDoc({
      normalized: { ...norm, orderKey: norm.orderKey, orderName: norm.orderName },
      index: i + 1,
      storeId,
      displayName,
      user,
    });

    try {
      const existing = await docRef.get();
      await docRef.set(doc, { merge: true });
      if (existing.exists) updated += 1;
      else created += 1;

      orders.push({
        orderKey: norm.orderKey,
        orderName: norm.orderName,
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
    const docId = toOrderDocId(orderKey);
    const docRef = firestore.collection(collectionId).doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      missing.push(orderKey);
      continue;
    }

    const data = snap.data() ?? {};
    const existingDisplayStatus = String(data?.shipment_status ?? "").trim();
    if (existingDisplayStatus === "Assigned") continue;

    await docRef.set(
      {
        shipmentStatus: "assigned",
        shipment_status: "Assigned",
        shipment: {
          ...(data?.shipment && typeof data.shipment === "object" ? data.shipment : {}),
          shipmentStatus: "assigned",
          assignedAt: ts,
          shippingDate: ts,
          updatedAt: ts,
        },
        shipping_date: ts,
        updated_at: ts,
        event: "manual_assign",
        requestedBy: {
          uid: String(user?.uid ?? ""),
          email: String(user?.email ?? ""),
          role: String(user?.role ?? ""),
        },
        requestedAt: ts,
        storeId,
        shopName: displayName,
        updatedAt: ts,
      },
      { merge: true }
    );
    updated += 1;
  }

  return { ok: true, updated, missing };
}
