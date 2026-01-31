import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ROLE_ADMIN, ROLE_SHOP } from "../auth/roles.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
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
  return "";
};

const normalizeInternalStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "new") return "new";
  if (s === "assigned") return "assigned";
  if (s === "in_transit" || s === "in transit") return "in_transit";
  if (s === "delivered") return "delivered";
  if (s === "rto") return "rto";
  if (s === "rto_initiated" || s === "rto initiated") return "rto_initiated";
  if (s === "rto_delivered" || s === "rto delivered") return "rto_delivered";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("assign")) return "assigned";
  if (s.includes("rto") && s.includes("initi")) return "rto_initiated";
  if (s.includes("rto") && s.includes("deliver")) return "rto_delivered";
  if (s.includes("rto")) return "rto";
  return s.replaceAll(/\s+/g, "_");
};

const internalToDisplayStatus = (internal) => {
  const s = normalizeInternalStatus(internal);
  if (!s) return "";
  if (s === "undelivered") return "Undelivered";
  if (s === "at_destination" || s === "atdestination") return "At Destination";
  if (s === "out_for_delivery" || s === "outfordelivery") return "Out for Delivery";
  if (s === "set_rto" || s === "setrto") return "Set RTO";
  if (s === "rto_accepted") return "RTO Accepted";
  if (s === "rto_in_transit" || s === "rto_intransit") return "RTO In Transit";
  if (s === "rto_reached_at_destination" || s === "rto_reached_atdestination")
    return "RTO Reached At Destination";
  if (s === "delivered") return "Delivered";
  if (s === "in_transit") return "In Transit";
  if (s === "assigned") return "Assigned";
  if (s === "new") return "New";
  if (s === "rto_delivered") return "RTO Delivered";
  if (s === "rto_initiated") return "RTO Accepted";
  if (s === "rto") return "RTO In Transit";
  return "";
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

const getDocShipmentInternalRaw = (data) => {
  const direct = String(data?.shipmentStatus ?? "").trim();
  if (direct) return direct;
  const nested = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
  return String(nested?.shipmentStatus ?? "").trim();
};

const getDocDisplayShipmentStatus = (data) => {
  const direct = normalizeDisplayStatus(data?.shipment_status);
  if (direct) return direct;
  const raw = getDocShipmentInternalRaw(data);
  const rawAsDisplay = normalizeDisplayStatus(raw);
  if (rawAsDisplay) return rawAsDisplay;
  const inferredFromInternal = internalToDisplayStatus(raw);
  return inferredFromInternal || "";
};

const getDocUpdatedAtIso = (data) => {
  const direct = String(data?.updated_at ?? "").trim();
  if (direct) return direct;
  const nested = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
  const nestedUpdated = String(nested?.updatedAt ?? "").trim();
  if (nestedUpdated) return nestedUpdated;
  return String(data?.updatedAt ?? "").trim();
};

const getDocShippingDateIso = (data) => {
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
};

const getDocOrder = (data) =>
  data?.order && typeof data.order === "object" ? data.order : null;

const projectConsignmentRow = ({ docId, data }) => {
  const order = getDocOrder(data) ?? {};
  const shipping = order?.shipping && typeof order.shipping === "object" ? order.shipping : {};

  const orderKey = String(data?.orderKey ?? order?.orderKey ?? docId ?? "").trim();
  const orderName = String(order?.orderName ?? order?.order_name ?? order?.name ?? "").trim();
  const orderId = String(order?.orderId ?? order?.order_id ?? order?.orderID ?? order?.id ?? "").trim();
  const orderDate = String(order?.order_date ?? order?.orderDate ?? order?.createdAt ?? order?.created_at ?? "").trim();

  const courierPartner = String(
    data?.courier_partner ??
      data?.courierPartner ??
      order?.trackingCompany ??
      data?.trackingCompany ??
      ""
  ).trim();

  const consignmentNumber = String(
    data?.consignment_number ??
      data?.consignmentNumber ??
      data?.trackingNumber ??
      (data?.shipment && typeof data.shipment === "object" ? data.shipment.trackingNumber : "") ??
      order?.trackingNumbersText ??
      ""
  ).trim();

  const shipmentInternal = normalizeInternalStatus(getDocShipmentInternalRaw(data));
  const shipmentStatus = shipmentInternal || displayToInternalStatus(getDocDisplayShipmentStatus(data)) || "";

  const weight =
    data?.weight ??
    (data?.shipment && typeof data.shipment === "object" ? data.shipment.weightKg : undefined);

  const courierType =
    data?.courier_type ??
    data?.courierType ??
    (data?.shipment && typeof data.shipment === "object" ? data.shipment.courierType : "");

  const updatedAt = getDocUpdatedAtIso(data);
  const shippingDate = getDocShippingDateIso(data);

  const paymentStatus = String(order?.paymentStatus ?? order?.financialStatus ?? "").trim();

  return {
    orderKey,

    // Order Details
    order_name: orderName,
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
    shipping_date: shippingDate,

    // Tracking No
    courier_partner: courierPartner,
    consignment_number: consignmentNumber,

    // Shipment Details
    weight: toSafeNumber(weight),
    courier_type: String(courierType ?? "").trim(),

    // Shipment Status
    shipment_status: getDocDisplayShipmentStatus(data),
    shipmentStatus,

    // Updated On
    updated_at: updatedAt,

    // EDD
    expected_delivery_date: String(
      data?.expected_delivery_date ??
        data?.expectedDeliveryDate ??
        (data?.shipment && typeof data.shipment === "object" ? data.shipment.expectedDeliveryDate : "") ??
        ""
    ).trim(),
  };
};

const buildMissingFieldsPatch = ({ data }) => {
  const patch = {};

  if (data?.shipment_status === undefined) {
    const inferred = getDocDisplayShipmentStatus(data);
    if (inferred) patch.shipment_status = inferred;
  }

  if (data?.updated_at === undefined) {
    const inferred = getDocUpdatedAtIso(data);
    if (inferred) patch.updated_at = inferred;
  }

  if (data?.shipping_date === undefined) {
    const inferred = getDocShippingDateIso(data);
    if (inferred) patch.shipping_date = inferred;
  }

  if (data?.consignment_number === undefined) {
    const inferred = String(
      data?.consignmentNumber ??
        data?.trackingNumber ??
        (data?.shipment && typeof data.shipment === "object" ? data.shipment.trackingNumber : "") ??
        ""
    ).trim();
    if (inferred) patch.consignment_number = inferred;
  }

  if (data?.courier_partner === undefined) {
    const order = getDocOrder(data) ?? {};
    const inferred = String(
      data?.courierPartner ?? order?.trackingCompany ?? data?.trackingCompany ?? ""
    ).trim();
    const consignment = String(
      patch.consignment_number ??
        data?.consignment_number ??
        data?.trackingNumber ??
        (data?.shipment && typeof data.shipment === "object" ? data.shipment.trackingNumber : "") ??
        ""
    ).trim();
    if (inferred) patch.courier_partner = inferred;
    else if (consignment) patch.courier_partner = "DTDC";
  }

  if (data?.weight === undefined) {
    const inferred =
      data?.shipment && typeof data.shipment === "object" ? data.shipment.weightKg : undefined;
    const n = toSafeNumber(inferred);
    if (n != null) patch.weight = n;
  }

  if (data?.courier_type === undefined) {
    const inferred =
      data?.courierType ??
      (data?.shipment && typeof data.shipment === "object" ? data.shipment.courierType : "");
    const s = String(inferred ?? "").trim();
    if (s) patch.courier_type = s;
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
        data?.shipping_date === undefined ||
        data?.shipment_status === undefined ||
        data?.updated_at === undefined ||
        data?.consignment_number === undefined ||
        data?.courier_partner === undefined;

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
  return t === "in_transit" || t === "delivered" || t === "rto";
};

const allowedStatusesForTab = (tab) => {
  const t = String(tab ?? "").trim().toLowerCase();
  if (t === "in_transit") return new Set(IN_TRANSIT_DISPLAY_STATUSES);
  if (t === "delivered") return new Set([DELIVERED_DISPLAY_STATUS]);
  if (t === "rto") return new Set(RTO_DISPLAY_STATUSES);
  return new Set();
};

const resolveStoreId = ({ req }) => {
  const role = String(req.user?.role ?? "").trim();
  if (role === ROLE_ADMIN) {
    const q = req.query ?? {};
    const storeId = String(q.storeId ?? q.store ?? q.shopDomain ?? "").trim().toLowerCase();
    return storeId;
  }
  if (role === ROLE_SHOP) {
    const fromProfile = String(req.user?.storeId ?? "").trim().toLowerCase();
    if (fromProfile) return fromProfile;
    const q = req.query ?? {};
    return String(q.storeId ?? q.store ?? q.shopDomain ?? "").trim().toLowerCase();
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

        const limit = parseLimit(req.query?.limit);
        const cursor = decodeCursor(req.query?.cursor);
        const allowed = allowedStatusesForTab(tab);

        const admin = await getFirebaseAdmin({ env });
        const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
          storeId,
        });

        const firestore = admin.firestore();
        const col = firestore.collection(collectionId);

        // Backfill legacy docs that don't have `shipping_date` yet (otherwise orderBy(shipping_date) can return 0).
        if (!cursor) {
          try {
            const probe = await col.orderBy("shipping_date", "desc").limit(1).get();
            if (probe.empty) {
              await backfillForCollection({ col, allowedDisplayStatuses: allowed, maxDocs: 300 });
            }
          } catch {
            // ignore probe/backfill failures
          }
        }

        const orders = [];
        let lastShippingDate = String(cursor?.shippingDate ?? "").trim();
        let lastDocId = String(cursor?.docId ?? "").trim();

        // In-memory filter to avoid requiring Firestore composite indexes.
        const batchSize = Math.min(250, Math.max(25, limit * 4));
        for (let iter = 0; iter < 12 && orders.length < limit; iter += 1) {
          let q = col
            .orderBy("shipping_date", "desc")
            .orderBy(admin.firestore.FieldPath.documentId(), "desc")
            .limit(batchSize);
          if (lastShippingDate && lastDocId) q = q.startAfter(lastShippingDate, lastDocId);

          const snap = await q.get();
          if (snap.empty) {
            lastShippingDate = "";
            lastDocId = "";
            break;
          }

          for (const doc of snap.docs) {
            const data = doc.data() ?? {};
            const displayStatus = getDocDisplayShipmentStatus(data);
            const shippingDate = getDocShippingDateIso(data);
            const patch = buildMissingFieldsPatch({ data });
            if (!patch.shipping_date && shippingDate) patch.shipping_date = shippingDate;
            if (!allowed.has(displayStatus)) {
              lastShippingDate = String(shippingDate ?? "").trim();
              lastDocId = String(doc.id ?? "").trim();
              if (Object.keys(patch).length > 0) {
                doc.ref.set(patch, { merge: true }).catch(() => {});
              }
              continue;
            }

            const row = projectConsignmentRow({ docId: doc.id, data });
            orders.push(row);

            if (Object.keys(patch).length > 0) {
              // Best-effort migration; do not block response.
              doc.ref.set(patch, { merge: true }).catch(() => {});
            }

            if (orders.length >= limit) break;
            lastShippingDate = String(shippingDate ?? "").trim();
            lastDocId = String(doc.id ?? "").trim();
          }

          const lastDoc = snap.docs[snap.docs.length - 1];
          const lastDocData = lastDoc?.data?.() ?? {};
          const lastDocShipping = getDocShippingDateIso(lastDocData);
          const lastId = String(lastDoc?.id ?? "").trim();
          if (lastDocShipping && lastId) {
            lastShippingDate = String(lastDocShipping ?? "").trim();
            lastDocId = lastId;
          }

          if (snap.docs.length < batchSize) {
            // No more to scan.
            lastShippingDate = "";
            lastDocId = "";
            break;
          }
        }

        const nextCursor =
          lastShippingDate && lastDocId
            ? encodeCursor({ shippingDate: lastShippingDate, docId: lastDocId })
            : "";

        res.setHeader("Cache-Control", "no-store");
        res.json({
          tab,
          shopName: displayName,
          storeId: normalizedStoreId,
          count: orders.length,
          nextCursor,
          orders,
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

        const orderKey = String(req.body?.orderKey ?? "").trim();
        if (!orderKey) {
          res.status(400).json({ error: "order_key_required" });
          return;
        }

        const storeId = String(req.body?.storeId ?? "").trim().toLowerCase();
        if (!storeId) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const nextDisplay = normalizeDisplayStatus(req.body?.shipment_status);
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
        const { collectionId, storeId: normalizedStoreId } = getShopCollectionInfo({ storeId });
        const docId = toOrderDocId(orderKey);
        const docRef = admin.firestore().collection(collectionId).doc(docId);

        const changedAt = nowIso();

        const historyRef = docRef.collection("shipment_status_history").doc();

        await admin.firestore().runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const data = snap.data() ?? {};

          const prevDisplay = getDocDisplayShipmentStatus(data);
          const prevInternal = normalizeInternalStatus(getDocShipmentInternalRaw(data));

          const shippingDate = getDocShippingDateIso(data);

          tx.set(
            docRef,
            {
              orderKey,
              docId,
              storeId: normalizedStoreId,
              shipment_status: nextDisplay,
              shipmentStatus: nextInternal,
              shipping_date: shippingDate || "",
              updated_at: changedAt,
              updatedAt: changedAt,
              shipment: {
                shipmentStatus: nextInternal,
                shippingDate: shippingDate || "",
                updatedAt: changedAt,
              },
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
            from_internal_status: prevInternal,
            to_internal_status: nextInternal,
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
          orderKey,
          storeId: normalizedStoreId,
          shipment_status: nextDisplay,
          shipmentStatus: nextInternal,
          updated_at: changedAt,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
