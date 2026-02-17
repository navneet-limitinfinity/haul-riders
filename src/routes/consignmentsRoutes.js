import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ROLE_ADMIN, ROLE_SHOP } from "../auth/roles.js";
import { getShopCollectionInfo, toFirestoreCollectionId } from "../firestore/shopCollections.js";
import { loadStoreDoc } from "../firestore/storeDocs.js";
import { toOrderDocId } from "../firestore/ids.js";

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

const nowIso = () => new Date().toISOString();

const normalizeDisplayStatus = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  const all = [...IN_TRANSIT_DISPLAY_STATUSES, DELIVERED_DISPLAY_STATUS, ...RTO_DISPLAY_STATUSES];
  for (const s of all) {
    if (s.toLowerCase() === key) return s;
  }

  // Accept internal / legacy variants (snake_case, kebab-case, camelCase).
  const canonical = raw
    .replaceAll(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  const map = {
    in_transit: "In Transit",
    intransit: "In Transit",
    undelivered: "Undelivered",
    at_destination: "At Destination",
    atdestination: "At Destination",
    out_for_delivery: "Out for Delivery",
    outfordelivery: "Out for Delivery",
    set_rto: "Set RTO",
    setrto: "Set RTO",

    // RTO internal variants
    rto_initiated: "RTO Accepted",
    rto_accepted: "RTO Accepted",
    rto_in_transit: "RTO In Transit",
    rto_intransit: "RTO In Transit",
    rto_reached_at_destination: "RTO Reached At Destination",
    rto_reached_atdestination: "RTO Reached At Destination",
    rto_delivered: "RTO Delivered",
  };

  return map[canonical] ?? "";
};

const displayToInternalStatus = (display) => {
  const s = normalizeDisplayStatus(display);
  if (!s) return "";
  if (s === DELIVERED_DISPLAY_STATUS) return "delivered";
  if (IN_TRANSIT_DISPLAY_STATUSES.includes(s)) return "in_transit";
  if (s === "RTO Delivered") return "rto_delivered";
  if (s === "RTO Accepted") return "rto_initiated";
  return "rto";
};

const paymentModeFromFinancialStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "paid" || s === "partially_paid") return "Prepaid";
  return "COD";
};

const toSafeNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const getDocDisplayShipmentStatus = (data) => {
  const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
  const order = getDocOrder(data);
  return (
    normalizeDisplayStatus(
      data?.shipmentStatus ??
        data?.shipment_status ??
        shipment?.shipmentStatus ??
        shipment?.shipment_status ??
        order?.shipmentStatus ??
        order?.shipment_status
    ) || ""
  );
};

const getDocUpdatedAtIso = (data) => {
  const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
  const direct = String(
    data?.updatedAt ??
      data?.updated_at ??
      shipment?.updatedAt ??
      shipment?.updated_at ??
      ""
  ).trim();
  if (direct) return direct;
  return "";
};

const getDocShippingDateIso = (data) => {
  const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
  const direct = String(
    data?.shippingDate ??
      data?.shipping_date ??
      shipment?.shippingDate ??
      shipment?.shipping_date ??
      ""
  ).trim();
  if (direct) return direct;
  const requestedAt = String(data?.requestedAt ?? "").trim();
  if (requestedAt) return requestedAt;
  return "";
};

const getDocOrder = (data) =>
  data?.order && typeof data.order === "object" ? data.order : null;

const projectConsignmentRow = ({ docId, data }) => {
  const order = getDocOrder(data) ?? {};
  const shipping = order?.shipping && typeof order.shipping === "object" ? order.shipping : {};

  const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : {};
  const orderId = String(order?.orderId ?? order?.orderName ?? order?.order_id ?? order?.orderID ?? "").trim();
  const orderDate = String(order?.order_date ?? order?.orderDate ?? order?.createdAt ?? order?.created_at ?? "").trim();

  const courierPartner = String(
    data?.courierPartner ?? data?.courier_partner ?? shipment?.courierPartner ?? shipment?.courier_partner ?? ""
  ).trim();
  const consignmentNumber = String(
    data?.consignmentNumber ??
      data?.consignment_number ??
      shipment?.consignmentNumber ??
      shipment?.consignment_number ??
      ""
  ).trim();
  const weightKgRaw = data?.weightKg ?? data?.weight ?? shipment?.weightKg ?? shipment?.weight;
  const courierType = data?.courierType ?? data?.courier_type ?? shipment?.courierType ?? shipment?.courier_type ?? "";

  const updatedAt = getDocUpdatedAtIso(data);
  const shippingDate = getDocShippingDateIso(data);

  const paymentStatus = String(order?.paymentStatus ?? order?.financialStatus ?? "").trim();

  return {
    docId,

    // Order Details
    order_name: orderId,
    order_id: orderId,
    order_date: orderDate,

    // Customer Details
    name: String(shipping?.fullName ?? shipping?.name ?? "").trim(),
    address_line_1: String(shipping?.address1 ?? "").trim(),
    address_line_2: String(shipping?.address2 ?? "").trim(),
    pincode: String(shipping?.pinCode ?? shipping?.pincode ?? shipping?.zip ?? "").trim(),
    city: String(shipping?.city ?? "").trim(),
    state: String(shipping?.state ?? shipping?.province ?? "").trim(),

    // Phone No
    phone_1: String(shipping?.phone1 ?? "").trim(),
    phone_2: String(shipping?.phone2 ?? "").trim(),

    // Invoice Details
    content_and_quantity: String(order?.productDescription ?? "").trim(),
    invoice_value: String(order?.invoiceValue ?? order?.totalPrice ?? "").trim(),
    payment_status: paymentStatus,

    total_price_including_gst: String(order?.totalPrice ?? order?.invoiceValue ?? "").trim(),
    payment_mode: paymentModeFromFinancialStatus(paymentStatus),

    // Shipping Date
    shippingDate,

    // Tracking No
    courierPartner,
    consignmentNumber,

    // Shipment Details
    weightKg: toSafeNumber(weightKgRaw),
    courierType: String(courierType ?? "").trim(),

    // Shipment Status
    shipmentStatus: getDocDisplayShipmentStatus(data),

    // Updated On
    updatedAt,

    // EDD
    expectedDeliveryDate: String(
      data?.expectedDeliveryDate ??
        data?.expected_delivery_date ??
        shipment?.expectedDeliveryDate ??
        shipment?.expected_delivery_date ??
        ""
    ).trim(),
  };
};

const buildMissingFieldsPatch = ({ data }) => {
  const patch = {};

  if (data?.shipmentStatus === undefined) {
    const inferred = getDocDisplayShipmentStatus(data);
    if (inferred) patch.shipmentStatus = inferred;
  }

  if (data?.updatedAt === undefined) {
    const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
    const inferred = String(
      data?.updated_at ??
        shipment?.updatedAt ??
        shipment?.updated_at ??
        data?.requestedAt ??
        ""
    ).trim();
    if (inferred) patch.updatedAt = inferred;
  }

  if (data?.shippingDate === undefined) {
    const inferred = String(getDocShippingDateIso(data) || data?.requestedAt || "").trim();
    if (inferred) patch.shippingDate = inferred;
  }

  if (data?.consignmentNumber === undefined) {
    const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
    const legacy = String(data?.consignment_number ?? shipment?.consignmentNumber ?? shipment?.consignment_number ?? "").trim();
    if (legacy) patch.consignmentNumber = legacy;
  }

  if (data?.courierPartner === undefined) {
    const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
    const legacy = String(data?.courier_partner ?? shipment?.courierPartner ?? shipment?.courier_partner ?? "").trim();
    if (legacy) patch.courierPartner = legacy;
    const consignment = String(
      patch.consignmentNumber ??
        data?.consignmentNumber ??
        data?.consignment_number ??
        shipment?.consignmentNumber ??
        shipment?.consignment_number ??
        ""
    ).trim();
    if (consignment) patch.courierPartner = "DTDC";
  }

  if (data?.weightKg === undefined) {
    if (data?.weight !== undefined) patch.weightKg = toSafeNumber(data.weight);
  }

  if (data?.courierType === undefined) {
    const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
    const legacy = String(data?.courier_type ?? shipment?.courierType ?? shipment?.courier_type ?? "").trim();
    if (legacy) patch.courierType = legacy;
  }

  if (data?.expectedDeliveryDate === undefined) {
    const shipment = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
    const legacy = String(data?.expected_delivery_date ?? shipment?.expectedDeliveryDate ?? shipment?.expected_delivery_date ?? "").trim();
    if (legacy) patch.expectedDeliveryDate = legacy;
  }

  return patch;
};

const backfillForCollection = async ({ col, allowedDisplayStatuses, maxDocs = 300 }) => {
  let scanned = 0;
  const batchSize = 250;

  const firestore = col.firestore;
  let batch = firestore.batch();
  let batchOps = 0;
  const flush = async () => {
    if (batchOps === 0) return;
    try {
      await batch.commit();
    } catch {
      // ignore batch failures
    } finally {
      batch = firestore.batch();
      batchOps = 0;
    }
  };

  let startAfterRequestedAt = "";
  for (let iter = 0; iter < 6 && scanned < maxDocs; iter += 1) {
    let q = col.orderBy("requestedAt", "desc").limit(batchSize);
    if (startAfterRequestedAt) q = q.startAfter(startAfterRequestedAt);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data() ?? {};
      const displayStatus = getDocDisplayShipmentStatus(data);
      const shouldCare =
        allowedDisplayStatuses.has(displayStatus) ||
        data?.shippingDate === undefined ||
        data?.shipmentStatus === undefined ||
        data?.updatedAt === undefined ||
        data?.consignmentNumber === undefined ||
        data?.courierPartner === undefined;

      if (shouldCare) {
        const patch = buildMissingFieldsPatch({ data });
        if (Object.keys(patch).length > 0) {
          batch.set(doc.ref, patch, { merge: true });
          batchOps += 1;
          if (batchOps >= 400) await flush();
        }
      }

      scanned += 1;
      startAfterRequestedAt = String(data?.requestedAt ?? "").trim();
      if (scanned >= maxDocs) break;
    }

    if (snap.docs.length < batchSize) break;
  }

  await flush();
};

const normalizeSearchQuery = (q) =>
  String(q ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();

const matchesSearch = ({ data, q }) => {
  const query = normalizeSearchQuery(q);
  if (!query) return true;
  const terms = query.split(/\s+/g).filter(Boolean);
  if (!terms.length) return true;

  const tokensRaw = Array.isArray(data?.searchTokens) ? data.searchTokens : [];
  const tokens = tokensRaw.map((t) => String(t ?? "").toLowerCase()).filter(Boolean);
  if (!tokens.length) {
    // Fallback: scan a small set of fields if tokens are missing.
    const order = getDocOrder(data) ?? {};
    const shipping = order?.shipping && typeof order.shipping === "object" ? order.shipping : {};
    const hay = [
      String(order?.orderId ?? ""),
      String(order?.orderName ?? ""),
      String(data?.consignmentNumber ?? data?.consignment_number ?? ""),
      String(shipping?.fullName ?? ""),
      String(shipping?.phone1 ?? ""),
      String(shipping?.phone2 ?? ""),
      String(shipping?.pinCode ?? ""),
      String(shipping?.city ?? ""),
      String(shipping?.state ?? ""),
      String(data?.courierType ?? data?.courier_type ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  }

  return terms.every((term) => tokens.some((tok) => tok.includes(term)));
};

const encodeCursor = (requestedAt) => {
  const raw = requestedAt && typeof requestedAt === "object" ? requestedAt : null;
  const shippingDate = String(raw?.shippingDate ?? "").trim();
  const docId = String(raw?.docId ?? "").trim();
  if (!shippingDate || !docId) return "";
  try {
    return Buffer.from(JSON.stringify({ shippingDate, docId }), "utf8").toString("base64url");
  } catch {
    return "";
  }
};

const decodeCursor = (cursor) => {
  const raw = String(cursor ?? "").trim();
  if (!raw) return "";
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    const shippingDate = String(parsed?.shippingDate ?? "").trim();
    const docId = String(parsed?.docId ?? "").trim();
    if (!shippingDate || !docId) return "";
    return { shippingDate, docId };
  } catch {
    return "";
  }
};

const parseLimit = (value) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) return 50;
  return Math.max(1, Math.min(250, n));
};

const isAllowedTab = (tab) => {
  const t = String(tab ?? "").trim().toLowerCase();
  return t === "in_transit" || t === "delivered" || t === "rto" || t === "new_fs";
};

const allowedStatusesForTab = (tab) => {
  const t = String(tab ?? "").trim().toLowerCase();
  if (t === "in_transit")
    return new Set(IN_TRANSIT_DISPLAY_STATUSES.map((value) => value.toLowerCase()));
  if (t === "delivered") return new Set([DELIVERED_DISPLAY_STATUS.toLowerCase()]);
  if (t === "rto") return new Set(RTO_DISPLAY_STATUSES.map((value) => value.toLowerCase()));
  if (t === "new_fs") return new Set(["new"]);
  return new Set();
};

const CONSIGNMENTS_COLLECTION = "consignments";
const MAX_CONSIGNMENT_SCAN = 500;

async function loadConsignmentsForStore({
  firestore,
  storeId,
  allowedStatuses,
  search,
  limit,
}) {
  const scanLimit = Math.min(Math.max(limit * 3, limit + 10, 50), MAX_CONSIGNMENT_SCAN);
  const snapshot = await firestore
    .collection(CONSIGNMENTS_COLLECTION)
    .where("storeId", "==", storeId)
    .orderBy("requestedAt", "desc")
    .limit(scanLimit)
    .get();

  const results = [];
  for (const doc of snapshot.docs) {
    if (results.length >= limit) break;
    const data = doc.data() ?? {};
    if (allowedStatuses && allowedStatuses.size > 0) {
      const normalized = normalizeDisplayStatus(
        data?.shipmentStatus ?? data?.shipment_status
      )
        .toLowerCase()
        .trim();
      if (!normalized || !allowedStatuses.has(normalized)) continue;
    }
    if (search && !matchesSearch({ data, q: search })) continue;
    results.push({ docId: doc.id, data });
  }

  const hasMore = results.length >= limit && snapshot.docs.length > results.length;
  const nextCursor =
    hasMore && results.length > 0
      ? encodeCursor({
          shippingDate: String(results[results.length - 1]?.data?.requestedAt ?? ""),
          docId: results[results.length - 1]?.docId ?? "",
        })
      : "";

  return {
    orders: results.map(({ docId, data }) => ({ docId, ...data })),
    nextCursor,
    scannedDocs: snapshot.docs.length,
  };
}

const resolveStoreId = ({ req }) => {
  const role = String(req.user?.role ?? "").trim();
  if (role === ROLE_ADMIN) {
    const q = req.query ?? {};
    const storeId = String(q.storeId ?? q.store ?? q.shopDomain ?? "").trim().toLowerCase();
    return storeId;
  }
  if (role === ROLE_SHOP) {
    const storeKey = String(req.user?.storeKey ?? "").trim().toLowerCase();
    if (storeKey) return storeKey;
    const fromProfile = String(req.user?.storeId ?? "").trim().toLowerCase();
    if (fromProfile) return fromProfile;
    // For shop users, never trust query params for store id.
    // The store is derived from the authenticated user's Firestore profile.
    return "";
  }
  return "";
};

export function createConsignmentsRouter({ env, auth }) {
  const router = Router();

  router.get(
    "/consignments/:tab",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const tab = String(req.params?.tab ?? "").trim().toLowerCase();
        if (!isAllowedTab(tab)) {
          res.status(404).json({ error: "tab_not_found" });
          return;
        }

        const storeId = resolveStoreId({ req });
        if (!storeId) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const role = String(req.user?.role ?? "");
        const limit = parseLimit(req.query?.limit);
        const q = String(req.query?.q ?? "").trim();
        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const storeDoc = await loadStoreDoc({ env, firestore, storeId });
        if (!storeDoc) {
          res.status(404).json({ error: "store_document_missing" });
          return;
        }

        const canonicalStoreId = String(
          storeDoc?.data()?.storeId ?? storeDoc.id ?? storeId ?? ""
        ).trim();
        if (!canonicalStoreId) {
          res.status(404).json({ error: "store_document_missing" });
          return;
        }

        const storeDetails = storeDoc?.data() ?? {};
        const displayName = String(
          storeDetails?.storeDetails?.storeName ??
            storeDetails?.storeName ??
            storeDetails?.displayName ??
            canonicalStoreId
        ).trim();

        const allowed = allowedStatusesForTab(tab);
        const allowedStatuses = allowed.size ? allowed : null;

        const result = await loadConsignmentsForStore({
          firestore,
          storeId: canonicalStoreId,
          allowedStatuses,
          search: q,
          limit,
        });

        const wantsDebug =
          String(req.query?.debug ?? "").trim() === "1" ||
          String(env?.logLevel ?? "").trim().toLowerCase() === "debug" ||
          String(process.env.NODE_ENV ?? "").trim().toLowerCase() !== "production";

        res.setHeader("Cache-Control", "no-store");
        res.json({
          tab,
          shopName: displayName,
          storeId: canonicalStoreId,
          count: result.orders.length,
          nextCursor: result.nextCursor,
          orders: result.orders,
          ...(wantsDebug
            ? {
                debug: {
                  collectionId: CONSIGNMENTS_COLLECTION,
                  query: q,
                allowedStatuses: Array.from(allowed.values()),
                  limit,
                  scannedDocs: result.scannedDocs,
                  returnedDocs: result.orders.length,
                },
              }
            : {}),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/consignments/update-status",
    auth.requireRole("admin"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const docIdFromBody = String(req.body?.docId ?? "").trim();
        const orderKey = String(req.body?.orderKey ?? "").trim();
        if (!docIdFromBody && !orderKey) {
          res.status(400).json({ error: "order_key_required" });
          return;
        }

        const storeIdInput = String(req.body?.storeId ?? "").trim();
        if (!storeIdInput) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const nextDisplay = normalizeDisplayStatus(req.body?.shipmentStatus ?? req.body?.shipment_status);
        if (!nextDisplay) {
          res.status(400).json({ error: "invalid_shipment_status" });
          return;
        }

        const nextInternal = displayToInternalStatus(nextDisplay);
        if (!nextInternal) {
          res.status(400).json({ error: "invalid_shipment_status" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const storeDoc = await loadStoreDoc({ env, firestore, storeId: storeIdInput });
        if (!storeDoc) {
          res.status(404).json({ error: "store_document_missing" });
          return;
        }
        const canonicalStoreId = String(
          storeDoc?.data()?.storeId ?? storeDoc.id ?? storeIdInput ?? ""
        ).trim();
        if (!canonicalStoreId) {
          res.status(404).json({ error: "store_document_missing" });
          return;
        }
        const { collectionId, storeId: normalizedStoreId } = getShopCollectionInfo({
          storeId: canonicalStoreId,
        });
        const docId = docIdFromBody || toOrderDocId(orderKey);
        const docRef = admin.firestore().collection(collectionId).doc(docId);

        const changedAt = nowIso();

        const historyRef = docRef.collection("shipment_status_history").doc();

        await admin.firestore().runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const data = snap.data() ?? {};

          const prevDisplay = getDocDisplayShipmentStatus(data);

          const shippingDate = getDocShippingDateIso(data);

          tx.set(
            docRef,
            {
              docId,
              storeId: canonicalStoreId,
              shipmentStatus: nextDisplay,
              shippingDate: shippingDate || "",
              updatedAt: changedAt,
              event: "status_update",
              updatedBy: {
                uid: String(req.user?.uid ?? ""),
                email: String(req.user?.email ?? ""),
                role: String(req.user?.role ?? ""),
              },
            },
            { merge: true }
          );

          tx.set(historyRef, {
            changed_at: changedAt,
            from_shipment_status: prevDisplay,
            to_shipment_status: nextDisplay,
            from_internal_status: "",
            to_internal_status: "",
            updated_by: {
              uid: String(req.user?.uid ?? ""),
              email: String(req.user?.email ?? ""),
              role: String(req.user?.role ?? ""),
            },
          });
        });

        res.setHeader("Cache-Control", "no-store");
        res.json({
          ok: true,
          docId,
          orderKey,
          storeId: normalizedStoreId,
          shipmentStatus: nextDisplay,
          updatedAt: changedAt,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
