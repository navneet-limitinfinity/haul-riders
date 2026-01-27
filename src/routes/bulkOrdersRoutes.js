import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";

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

function buildDtdcTrackingUrl(trackingNumber) {
  const tn = String(trackingNumber ?? "").trim();
  if (!tn) return "";
  return `https://txk.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCITrackingDetails&cType=Consignment&cnNo=${encodeURIComponent(
    tn
  )}`;
}

function getRowValue(row, key) {
  return String(row?.[key] ?? "").trim();
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
    "orderKey",
    "orderName",
    "fullName",
    "phone1",
    "address1",
    "city",
    "state",
    "pinCode",
    "totalPrice",
    "financialStatus",
  ];
  const missing = required.filter((k) => !getRowValue(row, k));
  if (missing.length) {
    return {
      ok: false,
      error: `Row ${rowIndex + 2}: missing ${missing.join(", ")}`,
    };
  }
  return { ok: true, error: "" };
}

function parseCsvBuffer(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer ?? "");
  const clean = raw.replace(/^\uFEFF/, "");
  return parse(clean, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

function normalizeShipmentStatus(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "new") return "new";
  if (s === "assigned") return "assigned";
  if (s === "delivered") return "delivered";
  if (s === "in_transit" || s === "in transit") return "in_transit";
  if (s === "rto") return "rto";

  if (s.includes("rto") && s.includes("initi")) return "rto_initiated";
  if (s.includes("rto") && s.includes("deliver")) return "rto_delivered";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("transit")) return "in_transit";
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
        rows = parseCsvBuffer(file.buffer);
      } catch (error) {
        res.status(400).json({ error: "invalid_csv", message: String(error?.message ?? "") });
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
            env,
            storeId,
          });
          const firestore = admin.firestore();

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
            const phoneNumbers = [phone1, phone2].filter(Boolean);

            const awbNumber = getRowValue(row, "awbNumber");
            const trackingCompany = getRowValue(row, "trackingCompany") || (awbNumber ? "DTDC" : "");
            const trackingUrl =
              trackingCompany.toLowerCase().includes("dtdc") && awbNumber
                ? buildDtdcTrackingUrl(awbNumber)
                : "";

            const order = {
              index: i + 1,
              orderKey,
              orderId: getRowValue(row, "orderId"),
              orderName: getRowValue(row, "orderName"),
              createdAt: getRowValue(row, "createdAt") || assignedAt,
              customerEmail: getRowValue(row, "customerEmail"),
              financialStatus: getRowValue(row, "financialStatus"),
              totalPrice: safeNumber(getRowValue(row, "totalPrice")),
              fulfillmentStatus: "unfulfilled",
              trackingNumbers: awbNumber ? [awbNumber] : [],
              trackingNumbersText: awbNumber ? awbNumber : "",
              trackingCompany,
              trackingUrl,
              shipping: {
                fullName: getRowValue(row, "fullName"),
                address1: getRowValue(row, "address1"),
                address2: getRowValue(row, "address2"),
                city: getRowValue(row, "city"),
                state: getRowValue(row, "state"),
                pinCode: getRowValue(row, "pinCode"),
                phoneNumbers,
                phone1,
                phone2,
                phoneNumbersText: phoneNumbers.join(", "),
              },
            };

            const courierType = getRowValue(row, "courierType");
            const weightKgRaw = getRowValue(row, "weightKg");
            const weightKg = weightKgRaw ? Number.parseFloat(weightKgRaw) : NaN;

            const shipment = {
              shipmentStatus: "assigned",
              assignedAt,
              ...(courierType ? { courierType } : {}),
              ...(Number.isFinite(weightKg) ? { weightKg: Number(weightKg.toFixed(1)) } : {}),
              ...(awbNumber ? { awbNumber, trackingNumber: awbNumber } : {}),
            };

            try {
              const existing = await docRef.get();
              await docRef.set(
                {
                  orderKey,
                  docId,
                  storeId: normalizedStoreId,
                  shopName: displayName,
                  order,
                  shipment,
                  shipmentStatus: "assigned",
                  ...(awbNumber ? { trackingNumber: awbNumber } : {}),
                  event: "bulk_csv_upload",
                  requestedBy: {
                    uid: String(req.user?.uid ?? ""),
                    email: String(req.user?.email ?? ""),
                    role: String(req.user?.role ?? ""),
                  },
                  requestedAt: assignedAt,
                  updatedAt: nowIso(),
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
        rows = parseCsvBuffer(file.buffer);
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
            env,
            storeId,
          });
          const firestore = admin.firestore();

          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];

            const trackingNumber = pickFirstValue(row, [
              "trackingNumber",
              "Tracking Number",
              "Tracking Numbers",
              "tracking_numbers",
            ]);
            const shipmentStatusRaw = pickFirstValue(row, [
              "shipmentStatus",
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

            const updatedAt = nowIso();

            let matches = [];
            try {
              const q1 = await firestore
                .collection(collectionId)
                .where("trackingNumber", "==", trackingNumber)
                .limit(5)
                .get();
              matches = q1.docs;
              if (matches.length === 0) {
                const q2 = await firestore
                  .collection(collectionId)
                  .where("shipment.trackingNumber", "==", trackingNumber)
                  .limit(5)
                  .get();
                matches = q2.docs;
              }
              if (matches.length === 0) {
                const q3 = await firestore
                  .collection(collectionId)
                  .where("shipment.awbNumber", "==", trackingNumber)
                  .limit(5)
                  .get();
                matches = q3.docs;
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
                await docSnap.ref.set(
                  {
                    storeId: normalizedStoreId,
                    shopName: displayName,
                    shipmentStatus,
                    trackingNumber,
                    shipment: {
                      shipmentStatus,
                      trackingNumber,
                      updatedAt,
                    },
                    event: "bulk_status_csv",
                    updatedBy: {
                      uid: String(req.user?.uid ?? ""),
                      email: String(req.user?.email ?? ""),
                      role: String(req.user?.role ?? ""),
                    },
                    updatedAt,
                  },
                  { merge: true }
                );
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
