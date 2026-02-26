import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { ensureStoreIdForShop } from "../firestore/storeIdGenerator.js";
import { parseCsvRows } from "../orders/import/parseCsvRows.js";
import { createManualOrders } from "../orders/manualOrdersService.js";
import { buildSearchTokensFromDoc } from "../firestore/searchTokens.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const JOB_TTL_MS = 30 * 60_000;
const jobs = new Map();

const CONSIGNMENTS_COLLECTION = "consignments";

const normalizeShopDomain = (storeId) => {
  const raw = String(storeId ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes(".") ? raw : `${raw}.myshopify.com`;
};

async function resolveStoreMetaForWrite({ firestore, shopsCollection, storeIdInput }) {
  const raw = String(storeIdInput ?? "").trim().toLowerCase();
  if (!raw) throw new Error("store_id_required");

  if (/^\d{6,}$/.test(raw)) {
    const found = await firestore.collection(shopsCollection).where("storeId", "==", raw).limit(1).get();
    const doc = found.docs[0] ?? null;
    if (!doc) throw new Error("store_id_required");
    const data = doc.data() ?? {};
    const storeDetails = data?.storeDetails && typeof data.storeDetails === "object" ? data.storeDetails : {};
    const storeName = String(storeDetails?.storeName ?? "").trim();
    return {
      shopDomain: doc.id,
      numericStoreId: raw,
      storeName,
    };
  }

  const shopDomain = normalizeShopDomain(raw);
  if (!shopDomain) throw new Error("store_id_required");

  const ensuredStoreId = await ensureStoreIdForShop({
    firestore,
    shopsCollection,
    shopDomain,
    referenceDate: new Date(),
  });

  const snap = await firestore.collection(shopsCollection).doc(shopDomain).get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const numericStoreId = String(data?.storeId ?? ensuredStoreId ?? "").trim();
  if (!numericStoreId) throw new Error("store_id_required");
  const storeDetails = data?.storeDetails && typeof data.storeDetails === "object" ? data.storeDetails : {};
  const storeName = String(storeDetails?.storeName ?? "").trim();
  return {
    shopDomain,
    numericStoreId,
    storeName,
  };
}

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
          const firestore = admin.firestore();
          const shopsCollection = String(env?.auth?.firebase?.shopsCollection ?? "shops").trim() || "shops";
          const { storeId: storeKey, displayName } = getShopCollectionInfo({ storeId });
          const resolved = await resolveStoreMetaForWrite({
            firestore,
            shopsCollection,
            storeIdInput: storeId,
          });

          const result = await createManualOrders({
            firestore,
            collectionId: CONSIGNMENTS_COLLECTION,
            storeId: resolved.numericStoreId,
            storeKey,
            shopDomain: resolved.shopDomain,
            displayName: resolved.storeName || displayName,
            user: req.user,
            shopsCollection,
            rows,
          });

          current.errors = result.errors.slice(0, 200);
          current.created = result.created;
          current.updated = result.updated;
          current.failed = result.failed;
          current.processed = result.total;
          current.orders = result.orders.slice(0, 500);
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
