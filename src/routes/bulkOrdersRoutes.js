import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";
import { reserveOrderSequences, formatManualOrderName } from "../firestore/orderSequence.js";
import { parseCsvRows } from "../orders/import/parseCsvRows.js";
import { parseXlsxRows } from "../orders/import/parseXlsxRows.js";

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

function getDocShipmentStatusRaw(data) {
  const direct = String(data?.shipmentStatus ?? "").trim();
  if (direct) return direct;
  const nested = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
  return String(nested?.shipmentStatus ?? "").trim();
}

function getDocShippingDateIso(data) {
  const direct = String(data?.shipping_date ?? "").trim();
  if (direct) return direct;
  const nested = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
  const nestedShipping = String(nested?.shippingDate ?? "").trim();
  if (nestedShipping) return nestedShipping;
  const assignedAt = String(nested?.assignedAt ?? "").trim();
  if (assignedAt) return assignedAt;
  const requestedAt = String(data?.requestedAt ?? "").trim();
  if (requestedAt) return requestedAt;
  return String(data?.updatedAt ?? "").trim();
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

function pickRowValue(row, keys) {
  for (const key of Array.isArray(keys) ? keys : []) {
    const v = String(row?.[key] ?? "").trim();
    if (v) return v;
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

function detectFileKind(file) {
  const name = String(file?.originalname ?? "").trim().toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".xls")) return "xls";
  return "";
}

function parseRowsFromFile(file) {
  const kind = detectFileKind(file);
  if (!file?.buffer) throw new Error("file_required");
  if (kind === "csv") return parseCsvRows(file.buffer);
  if (kind === "xlsx") return parseXlsxRows(file.buffer);
  if (kind === "xls") throw new Error("xls_not_supported");
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
          const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
            storeId,
          });
          const firestore = admin.firestore();

          const missingNameIndexes = [];
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const name = getRowValue(row, "orderName");
            if (!name) missingNameIndexes.push(i);
          }

          let sequences = [];
          if (missingNameIndexes.length) {
            sequences = await reserveOrderSequences({ firestore, count: missingNameIndexes.length });
          }

          for (let i = 0; i < missingNameIndexes.length; i += 1) {
            const idx = missingNameIndexes[i];
            const seq = sequences[i];
            const orderName = formatManualOrderName(seq);
            rows[idx].orderName = orderName;
            if (!getRowValue(rows[idx], "orderKey")) rows[idx].orderKey = orderName;
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
            const phoneNumbers = [phone1, phone2].filter(Boolean);

            const awbNumber = pickRowValue(row, [
              "consignment_number",
              "consignmentNumber",
              "awbNumber",
              "trackingNumber",
              "tracking_number",
              "Tracking Number",
            ]);
            const trackingCompany = pickRowValue(row, ["courier_partner", "courierPartner", "trackingCompany", "courier"])
              || (awbNumber ? "DTDC" : "");
            const trackingUrl =
              trackingCompany.toLowerCase().includes("dtdc") && awbNumber
                ? buildDtdcTrackingUrl(awbNumber)
                : "";

            const shippingDate = pickRowValue(row, ["shipping_date", "shippingDate"]) || assignedAt;
            const expectedDeliveryDate = pickRowValue(row, [
              "expected_delivery_date",
              "expectedDeliveryDate",
              "edd",
            ]);

            const order = {
              index: i + 1,
              orderKey,
              orderId: getRowValue(row, "orderId"),
              orderName: getRowValue(row, "orderName"),
              // Per requirement: Order Date should reflect bulk upload time.
              createdAt: assignedAt,
              customerEmail: getRowValue(row, "customerEmail"),
              financialStatus: getRowValue(row, "financialStatus"),
              paymentStatus: getRowValue(row, "financialStatus"),
              totalPrice: safeNumber(getRowValue(row, "totalPrice")),
              invoiceValue: safeNumber(pickRowValue(row, ["invoice_value", "invoiceValue"]) || getRowValue(row, "totalPrice")),
              productDescription: pickRowValue(row, [
                "content_and_quantity",
                "productDescription",
                "product_description",
              ]),
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

            const courierType = pickRowValue(row, ["courier_type", "courierType", "courierTypeName", "courierTypeValue"]);
            const weightKgRaw = pickRowValue(row, ["weight", "weightKg", "weight_kg"]);
            const weightKg = weightKgRaw ? Number.parseFloat(weightKgRaw) : NaN;

            const shipment = {
              shipmentStatus: "assigned",
              assignedAt,
              shippingDate,
              updatedAt: assignedAt,
              ...(courierType ? { courierType } : {}),
              ...(Number.isFinite(weightKg) ? { weightKg: Number(weightKg.toFixed(1)) } : {}),
              ...(awbNumber ? { awbNumber, trackingNumber: awbNumber } : {}),
              ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
            };

            try {
              const existing = await docRef.get();
              const existingData = existing.data() ?? {};
              const existingShippingDate = String(existingData?.shipping_date ?? "").trim();
              const existingDisplayStatus = String(existingData?.shipment_status ?? "").trim();
              const existingConsignment = String(existingData?.consignment_number ?? "").trim();
              const existingCourierPartner = String(existingData?.courier_partner ?? "").trim();
              const resolvedShippingDate = existingShippingDate || shippingDate;

              await docRef.set(
                {
                  orderKey,
                  docId,
                  storeId: normalizedStoreId,
                  shopName: displayName,
                  order,
                  shipment,
                  shipmentStatus: "assigned",
                  shipment_status: existingDisplayStatus || "Assigned",
                  courier_partner: trackingCompany || existingCourierPartner || (awbNumber ? "DTDC" : ""),
                  consignment_number: awbNumber || existingConsignment || "",
                  ...(Number.isFinite(weightKg) ? { weight: Number(weightKg.toFixed(1)) } : {}),
                  ...(courierType ? { courier_type: courierType } : {}),
                  shipping_date: resolvedShippingDate,
                  ...(expectedDeliveryDate ? { expected_delivery_date: expectedDeliveryDate } : {}),
                  updated_at: assignedAt,
                  ...(awbNumber ? { trackingNumber: awbNumber } : {}),
                  event: "bulk_csv_upload",
                  requestedBy: {
                    uid: String(req.user?.uid ?? ""),
                    email: String(req.user?.email ?? ""),
                    role: String(req.user?.role ?? ""),
                  },
                  requestedAt: assignedAt,
                  updatedAt: assignedAt,
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

            const updatedAt =
              normalizeIsoDate(
                pickFirstValue(row, ["updated_at", "updatedAt", "Updated On", "Updated At"])
              ) || nowIso();
            const shipment_status =
              normalizeDisplayStatus(shipmentStatusRaw) ||
              internalToDisplayShipmentStatus(shipmentStatus) ||
              "";
            const courierPartner = pickRowValue(row, ["courier_partner", "courierPartner", "trackingCompany"]) ||
              (trackingNumber ? "DTDC" : "");

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
                const historyRef = docSnap.ref.collection("shipment_status_history").doc();
                await firestore.runTransaction(async (tx) => {
                  const snap = await tx.get(docSnap.ref);
                  const data = snap.data() ?? {};

                  const prevInternal = normalizeShipmentStatus(getDocShipmentStatusRaw(data));
                  const prevDisplay =
                    String(data?.shipment_status ?? "").trim() ||
                    internalToDisplayShipmentStatus(prevInternal) ||
                    "";

                  const shippingDate = getDocShippingDateIso(data) || "";

                  tx.set(
                    docSnap.ref,
                    {
                      storeId: normalizedStoreId,
                      shopName: displayName,
                      shipmentStatus,
                      shipment_status,
                      trackingNumber,
                      consignment_number: trackingNumber,
                      courier_partner: courierPartner,
                      shipping_date: shippingDate,
                      updated_at: updatedAt,
                      shipment: {
                        shipmentStatus,
                        trackingNumber,
                        shippingDate,
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

                  tx.set(historyRef, {
                    changed_at: updatedAt,
                    from_shipment_status: prevDisplay,
                    to_shipment_status: shipment_status,
                    from_internal_status: prevInternal,
                    to_internal_status: shipmentStatus,
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
