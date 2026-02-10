import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";
import { reserveOrderSequences, formatManualOrderName } from "../firestore/orderSequence.js";
import { parseCsvRows } from "../orders/import/parseCsvRows.js";
import { buildSearchTokensFromDoc } from "../firestore/searchTokens.js";
import { reserveHrGids } from "../firestore/hrGid.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const JOB_TTL_MS = 30 * 60_000;
const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeIsoDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

const IN_TRANSIT_DISPLAY_STATUSES = [
  "In Transit",
  "Undelivered",
  "At Destination",
  "Out for Delivery",
  "Set RTO",
];

const DELIVERED_DISPLAY_STATUS = "Delivered";

const RTO_DISPLAY_STATUSES = [
  "RTO Accepted",
  "RTO In Transit",
  "RTO Reached At Destination",
  "RTO Delivered",
];

function normalizeDisplayStatus(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  const all = [...IN_TRANSIT_DISPLAY_STATUSES, DELIVERED_DISPLAY_STATUS, ...RTO_DISPLAY_STATUSES];
  for (const s of all) {
    if (s.toLowerCase() === key) return s;
  }
  return "";
}

function displayToInternalStatus(display) {
  const d = normalizeDisplayStatus(display);
  if (!d) return "";
  if (d === DELIVERED_DISPLAY_STATUS) return "delivered";
  if (IN_TRANSIT_DISPLAY_STATUSES.includes(d)) return "in_transit";
  if (d === "RTO Delivered") return "rto_delivered";
  if (d === "RTO Accepted") return "rto_initiated";
  return "rto";
}

function internalToDisplayShipmentStatus(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "new") return "New";
  if (s === "assigned") return "Assigned";
  if (s === "undelivered") return "Undelivered";
  if (s === "at_destination" || s === "atdestination") return "At Destination";
  if (s === "out_for_delivery" || s === "outfordelivery") return "Out for Delivery";
  if (s === "set_rto" || s === "setrto") return "Set RTO";
  if (s === "in_transit" || s === "in transit") return "In Transit";
  if (s === "delivered") return "Delivered";
  if (s === "rto_accepted") return "RTO Accepted";
  if (s === "rto_in_transit" || s === "rto_intransit") return "RTO In Transit";
  if (s === "rto_reached_at_destination" || s === "rto_reached_atdestination")
    return "RTO Reached At Destination";
  if (s === "rto") return "RTO In Transit";
  if (s === "rto_initiated" || s === "rto initiated") return "RTO Accepted";
  if (s === "rto_delivered" || s === "rto delivered") return "RTO Delivered";
  return "";
}

function getDocShippingDateIso(data) {
  const direct = String(data?.shippingDate ?? data?.shipping_date ?? "").trim();
  if (direct) return direct;
  const requestedAt = String(data?.requestedAt ?? "").trim();
  if (requestedAt) return requestedAt;
  return String(data?.updatedAt ?? data?.updated_at ?? "").trim();
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

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    const createdAt = Number(job?.createdAtMs ?? 0) || 0;
    if (createdAt && createdAt < cutoff) jobs.delete(id);
  }
}

function createJob({ total }) {
  cleanupJobs();
  const id = crypto.randomBytes(12).toString("hex");
  const job = {
    jobId: id,
    status: "processing",
    total: Number(total ?? 0) || 0,
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    message: "",
    createdAtMs: Date.now(),
    startedAt: nowIso(),
    finishedAt: "",
    errors: [],
  };
  jobs.set(id, job);
  return job;
}

function validateRow(row, rowIndex) {
  const required = [
    { key: "fullName", keys: ["fullName", "Full Name", "name", "Name"] },
    { key: "phone1", keys: ["phone1", "Phone 1", "phone_1", "phone", "Phone"] },
    { key: "address1", keys: ["address1", "Address 1", "address_line_1", "addressLine1"] },
    { key: "city", keys: ["city", "City"] },
    { key: "state", keys: ["state", "State"] },
    { key: "pinCode", keys: ["pinCode", "PIN Code", "pincode", "pin_code"] },
    { key: "totalPrice", keys: ["totalPrice", "Total Price", "invoiceValue", "invoice_value"] },
    { key: "financialStatus", keys: ["financialStatus", "Financial Status", "paymentStatus", "Payment Status"] },
  ];
  const missing = required.filter((r) => !pickRowValue(row, r.keys)).map((r) => r.key);
  if (missing.length) return { ok: false, error: `Row ${rowIndex + 2}: missing ${missing.join(", ")}` };
  return { ok: true, error: "" };
}

function detectFileKind(file) {
  const name = String(file?.originalname ?? "").trim().toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  return "";
}

function parseRowsFromFile(file) {
  const kind = detectFileKind(file);
  if (!file?.buffer) throw new Error("file_required");
  if (kind === "csv") return parseCsvRows(file.buffer);
  throw new Error("unsupported_file_type");
}

function resolveShopDomainFromStoreId(storeId) {
  const raw = String(storeId ?? "").trim().toLowerCase();
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

async function loadFulfillmentCentersMap({ firestore, shopsCollection, storeId }) {
  const domain = resolveShopDomainFromStoreId(storeId);
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

function normalizeShipmentStatus(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  const display = normalizeDisplayStatus(value);
  if (display) return displayToInternalStatus(display);
  if (s === "new") return "new";
  if (s === "assigned") return "assigned";
  if (s === "delivered") return "delivered";
  if (s === "in_transit" || s === "in transit") return "in_transit";
  if (s === "rto") return "rto";

  if (s.includes("rto") && s.includes("initi")) return "rto_initiated";
  if (s.includes("rto") && s.includes("deliver")) return "rto_delivered";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("undeliver")) return "undelivered";
  if (s.includes("at") && s.includes("dest")) return "at_destination";
  if (s.includes("out") && s.includes("deliver")) return "out_for_delivery";
  if (s.includes("set") && s.includes("rto")) return "set_rto";
  if (s.includes("rto") && s.includes("accept")) return "rto_initiated";
  if (s.includes("rto") && s.includes("reach") && s.includes("dest")) return "rto";
  if (s.includes("assign")) return "assigned";
  return s.replaceAll(/\s+/g, "_");
}

function pickFirstValue(row, keys) {
  for (const key of Array.isArray(keys) ? keys : []) {
    const v = String(row?.[key] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export function createBulkOrdersRouter({ env, auth }) {
  const router = Router();

  router.post(
    "/admin/bulk-orders/upload",
    auth.requireRole("admin"),
    upload.single("file"),
    async (req, res) => {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = String(req.body?.storeId ?? "").trim().toLowerCase();
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const file = req.file;
      if (!file?.buffer) {
        res.status(400).json({ error: "csv_file_required" });
        return;
      }

      let rows;
      try {
        rows = parseRowsFromFile(file);
      } catch (error) {
        res.status(400).json({ error: "invalid_file", message: String(error?.message ?? "") });
        return;
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "csv_empty" });
        return;
      }
      if (rows.length > 500) {
        res.status(400).json({ error: "csv_too_large", limit: 500 });
        return;
      }

      const job = createJob({ total: rows.length });

      // Respond quickly; process in background.
      res.status(202).json({ jobId: job.jobId, total: job.total });

      setImmediate(async () => {
        const current = jobs.get(job.jobId);
        if (!current) return;

        try {
          const admin = await getFirebaseAdmin({ env });
          const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
            storeId,
          });
          const firestore = admin.firestore();
          const shopsCollection = String(env?.auth?.firebase?.shopsCollection ?? "shops").trim() || "shops";
          const { byName: centersByName, defaultCenter } = await loadFulfillmentCentersMap({
            firestore,
            shopsCollection,
            storeId: normalizedStoreId,
          });
          const defaultFulfillmentCenterString = defaultCenter
            ? formatFulfillmentCenterString(defaultCenter)
            : "";

          const missingOrderIdIndexes = [];
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const existingId =
              pickRowValue(row, ["orderId", "order_id", "Order ID"]) ||
              getRowValue(row, "orderName") ||
              getRowValue(row, "orderKey");
            if (!existingId) missingOrderIdIndexes.push(i);
          }

          let sequences = [];
          if (missingOrderIdIndexes.length) {
            sequences = await reserveOrderSequences({ firestore, count: missingOrderIdIndexes.length });
          }

          for (let i = 0; i < missingOrderIdIndexes.length; i += 1) {
            const idx = missingOrderIdIndexes[i];
            const seq = sequences[i];
            const orderId = formatManualOrderName(seq);
            rows[idx].orderId = orderId;
            if (!getRowValue(rows[idx], "orderKey")) rows[idx].orderKey = orderId;
          }

          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            if (!getRowValue(row, "orderId")) {
              const fromLegacy =
                pickRowValue(row, ["orderId", "order_id", "Order ID"]) ||
                getRowValue(row, "orderName") ||
                getRowValue(row, "orderKey");
              if (fromLegacy) row.orderId = fromLegacy;
            }
            if (!getRowValue(row, "orderKey")) row.orderKey = getRowValue(row, "orderId");
          }

          const assignedAt = nowIso();
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const validation = validateRow(row, i);
            if (!validation.ok) {
              current.failed += 1;
              current.errors.push(validation.error);
              current.processed += 1;
              continue;
            }

            const orderKey = getRowValue(row, "orderKey");
            const docId = toOrderDocId(orderKey);
            const docRef = firestore.collection(collectionId).doc(docId);

            const phone1 = normalizePhone10(getRowValue(row, "phone1"));
            const phone2 = normalizePhone10(getRowValue(row, "phone2"));

            const awbNumber = pickRowValue(row, [
              "consignmentNumber",
              "consignment_number",
              "awbNumber",
              "trackingNumber",
              "tracking_number",
              "Tracking Number",
            ]);
            const trackingCompany = pickRowValue(row, ["courierPartner", "courier_partner", "trackingCompany", "courier"])
              || (awbNumber ? "DTDC" : "");
            // Tracking URL is derived in UI using courier_partner + consignment_number.

            const shippingDate = pickRowValue(row, ["shippingDate", "shipping_date"]) || assignedAt;
            const expectedDeliveryDate = pickRowValue(row, [
              "expectedDeliveryDate",
              "expected_delivery_date",
              "edd",
            ]);
            const uploadShipmentStatus = normalizeDisplayStatus(
              pickRowValue(row, ["shipmentStatus", "shipment_status", "Shipment Status", "Shipments Status"])
            );

            const fulfillmentCenterName =
              String(pickRowValue(row, ["fulfillmentCenter", "fulfillment_center"]) || "").trim() || "";
            const fulfillmentCenterAddress = fulfillmentCenterName
              ? centersByName.get(fulfillmentCenterName) ?? null
              : null;
            const fulfillmentCenterString = fulfillmentCenterAddress
              ? formatFulfillmentCenterString(fulfillmentCenterAddress)
              : defaultFulfillmentCenterString;

            const order = {
              index: i + 1,
              orderId: pickRowValue(row, ["orderId", "order_id", "Order ID", "orderName", "Order Name"]) || getRowValue(row, "orderId"),
              orderGid: pickRowValue(row, ["orderGid", "order_gid", "order_gid"]),
              // Per requirement: Order Date should reflect bulk upload time.
              createdAt: assignedAt,
              customerEmail: pickRowValue(row, ["customerEmail", "Customer Email", "email", "Email"]),
              financialStatus: pickRowValue(row, ["financialStatus", "Financial Status"]) || getRowValue(row, "financialStatus"),
              paymentStatus:
                pickRowValue(row, ["paymentStatus", "payment_status", "Payment Status"]) ||
                pickRowValue(row, ["financialStatus", "Financial Status"]) ||
                getRowValue(row, "financialStatus"),
              totalPrice: safeNumber(pickRowValue(row, ["totalPrice", "Total Price"]) || getRowValue(row, "totalPrice")),
              invoiceValue: safeNumber(pickRowValue(row, ["invoice_value", "invoiceValue", "Invoice Value"]) || pickRowValue(row, ["totalPrice", "Total Price"]) || getRowValue(row, "totalPrice")),
              productDescription: pickRowValue(row, [
                "itemAndQuantity",
                "content_and_quantity",
                "productDescription",
                "product_description",
              ]),
              fulfillmentCenter: fulfillmentCenterString,
              fulfillmentStatus: pickRowValue(row, ["fulfillmentStatus", "fulfillment_status"]) || "fulfilled",
              shipping: {
                fullName: pickRowValue(row, ["fullName", "Full Name", "name", "Name"]),
                address1: pickRowValue(row, ["address1", "Address 1", "address_line_1", "addressLine1"]),
                address2: pickRowValue(row, ["address2", "Address 2", "address_line_2", "addressLine2"]),
                city: pickRowValue(row, ["city", "City"]),
                state: pickRowValue(row, ["state", "State"]),
                pinCode: pickRowValue(row, ["pinCode", "PIN Code", "pincode", "pin_code"]),
                phone1,
                phone2,
              },
            };

            const courierType = pickRowValue(row, ["courierType", "courier_type", "courierTypeName", "courierTypeValue"]);
            const weightKgRaw = pickRowValue(row, ["weightKg", "weight", "weight_kg"]);
            const weightKg = weightKgRaw ? Number.parseFloat(weightKgRaw) : NaN;

            try {
              const existing = await docRef.get();
              const existingData = existing.data() ?? {};
              const existingHrGid = String(existingData?.hrGid ?? "").trim();
              const hrGid = existingHrGid || (await reserveHrGids({ firestore, count: 1 }))[0] || "";
              const existingShippingDate = String(existingData?.shippingDate ?? existingData?.shipping_date ?? "").trim();
              const existingDisplayStatus = String(existingData?.shipmentStatus ?? existingData?.shipment_status ?? "").trim();
              const existingConsignment = String(existingData?.consignmentNumber ?? existingData?.consignment_number ?? "").trim();
              const existingCourierPartner = String(existingData?.courierPartner ?? existingData?.courier_partner ?? "").trim();
              const resolvedShippingDate = existingShippingDate || shippingDate;

              await docRef.set(
                {
                  docId,
                  ...(hrGid ? { hrGid } : {}),
                  storeId: normalizedStoreId,
                  shopName: displayName,
                  order,
                  shipmentStatus: existingDisplayStatus || uploadShipmentStatus || "Assigned",
                  courierPartner: trackingCompany || existingCourierPartner || (awbNumber ? "DTDC" : ""),
                  consignmentNumber: awbNumber || existingConsignment || "",
                  searchTokens: buildSearchTokensFromDoc({
                    order,
                    consignmentNumber: awbNumber || existingConsignment || "",
                    courierPartner: trackingCompany || existingCourierPartner || (awbNumber ? "DTDC" : ""),
                    courierType,
                  }),
                  ...(Number.isFinite(weightKg) ? { weightKg: Number(weightKg.toFixed(1)) } : {}),
                  ...(courierType ? { courierType } : {}),
                  shippingDate: resolvedShippingDate,
                  ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
                  updatedAt: assignedAt,
                  event: "bulk_csv_upload",
                  requestedBy: {
                    uid: String(req.user?.uid ?? ""),
                    email: String(req.user?.email ?? ""),
                    role: String(req.user?.role ?? ""),
                  },
                  requestedAt: assignedAt,
                },
                { merge: true }
              );
              if (existing.exists) current.updated += 1;
              else current.created += 1;
            } catch (error) {
              current.failed += 1;
              current.errors.push(
                `Row ${i + 2}: ${String(error?.message ?? error ?? "write_failed")}`
              );
            } finally {
              current.processed += 1;
            }
          }

          current.status = "done";
          current.finishedAt = nowIso();
        } catch (error) {
          current.status = "failed";
          current.message = String(error?.message ?? "bulk_upload_failed");
          current.finishedAt = nowIso();
        }
      });
    }
  );

  router.post(
    "/admin/bulk-status/upload",
    auth.requireRole("admin"),
    upload.single("file"),
    async (req, res) => {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = String(req.body?.storeId ?? "").trim().toLowerCase();
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const file = req.file;
      if (!file?.buffer) {
        res.status(400).json({ error: "csv_file_required" });
        return;
      }

      let rows;
      try {
        rows = parseCsvRows(file.buffer);
      } catch (error) {
        res.status(400).json({ error: "invalid_csv", message: String(error?.message ?? "") });
        return;
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "csv_empty" });
        return;
      }
      if (rows.length > 1000) {
        res.status(400).json({ error: "csv_too_large", limit: 1000 });
        return;
      }

      const job = createJob({ total: rows.length });
      job.type = "bulk_status";
      res.status(202).json({ jobId: job.jobId, total: job.total });

      setImmediate(async () => {
        const current = jobs.get(job.jobId);
        if (!current) return;

        try {
          const admin = await getFirebaseAdmin({ env });
          const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
            storeId,
          });
          const firestore = admin.firestore();

          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];

            const trackingNumber = pickFirstValue(row, [
              "consignmentNumber",
              "consignment_number",
              "trackingNumber",
              "Tracking Number",
              "Tracking Numbers",
              "tracking_numbers",
            ]);
            const shipmentStatusRaw = pickFirstValue(row, [
              "shipmentStatus",
              "shipment_status",
              "Shipment status",
              "Shipments Status",
              "shipmentsStatus",
            ]);

            if (!trackingNumber || !shipmentStatusRaw) {
              current.failed += 1;
              current.errors.push(
                `Row ${i + 2}: missing trackingNumber or shipmentStatus`
              );
              current.processed += 1;
              continue;
            }

            const shipmentStatus = normalizeShipmentStatus(shipmentStatusRaw);
            if (!shipmentStatus) {
              current.failed += 1;
              current.errors.push(`Row ${i + 2}: invalid shipmentStatus`);
              current.processed += 1;
              continue;
            }

            const updatedAt =
              normalizeIsoDate(
                pickFirstValue(row, ["updated_at", "updatedAt", "Updated On", "Updated At"])
              ) || nowIso();
            const shipmentStatusDisplay =
              normalizeDisplayStatus(shipmentStatusRaw) ||
              internalToDisplayShipmentStatus(shipmentStatus) ||
              "";
            const courierPartner = pickRowValue(row, ["courierPartner", "courier_partner", "trackingCompany"]) ||
              (trackingNumber ? "DTDC" : "");

            let matches = [];
            try {
              const col = firestore.collection(collectionId);
              const q1 = await col.where("consignmentNumber", "==", trackingNumber).limit(5).get();
              matches = q1.docs;
              if (matches.length === 0) {
                const q2 = await col.where("consignment_number", "==", trackingNumber).limit(5).get();
                matches = q2.docs;
              }
            } catch (error) {
              current.failed += 1;
              current.errors.push(
                `Row ${i + 2}: query failed (${String(error?.message ?? error ?? "")})`
              );
              current.processed += 1;
              continue;
            }

            if (matches.length === 0) {
              current.failed += 1;
              current.errors.push(`Row ${i + 2}: tracking not found (${trackingNumber})`);
              current.processed += 1;
              continue;
            }

            try {
              for (const docSnap of matches) {
                const historyRef = docSnap.ref.collection("shipment_status_history").doc();
                await firestore.runTransaction(async (tx) => {
                  const snap = await tx.get(docSnap.ref);
                  const data = snap.data() ?? {};

                  const prevDisplay = String(data?.shipmentStatus ?? data?.shipment_status ?? "").trim();

                  const shippingDate = getDocShippingDateIso(data) || "";
                  const existingOrder = data?.order && typeof data.order === "object" ? data.order : {};
                  const existingCourierType = String(data?.courierType ?? data?.courier_type ?? "").trim();

                  tx.set(
                    docSnap.ref,
                    {
                      storeId: normalizedStoreId,
                      shopName: displayName,
                      shipmentStatus: shipmentStatusDisplay,
                      consignmentNumber: trackingNumber,
                      courierPartner,
                      searchTokens: buildSearchTokensFromDoc({
                        order: existingOrder,
                        consignmentNumber: trackingNumber,
                        courierPartner,
                        courierType: existingCourierType,
                      }),
                      shippingDate: shippingDate || updatedAt,
                      updatedAt,
                      event: "bulk_status_csv",
                      updatedBy: {
                        uid: String(req.user?.uid ?? ""),
                        email: String(req.user?.email ?? ""),
                        role: String(req.user?.role ?? ""),
                      },
                    },
                    { merge: true }
                  );

                  tx.set(historyRef, {
                    changed_at: updatedAt,
                    from_shipment_status: prevDisplay,
                    to_shipment_status: shipmentStatusDisplay,
                    from_internal_status: "",
                    to_internal_status: "",
                    updated_by: {
                      uid: String(req.user?.uid ?? ""),
                      email: String(req.user?.email ?? ""),
                      role: String(req.user?.role ?? ""),
                    },
                  });
                });
              }
              current.updated += matches.length;
            } catch (error) {
              current.failed += 1;
              current.errors.push(
                `Row ${i + 2}: update failed (${String(error?.message ?? error ?? "")})`
              );
            } finally {
              current.processed += 1;
            }
          }

          current.status = "done";
          current.finishedAt = nowIso();
        } catch (error) {
          current.status = "failed";
          current.message = String(error?.message ?? "bulk_status_failed");
          current.finishedAt = nowIso();
        }
      });
    }
  );

  router.get(
    "/admin/bulk-orders/jobs/:jobId",
    auth.requireRole("admin"),
    (req, res) => {
      const jobId = String(req.params?.jobId ?? "").trim();
      const job = jobs.get(jobId);
      if (!job) {
        res.status(404).json({ error: "job_not_found" });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json(job);
    }
  );

  return router;
}
