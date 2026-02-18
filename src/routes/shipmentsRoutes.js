import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ROLE_ADMIN, ROLE_SHOP } from "../auth/roles.js";
import { toOrderDocId } from "../firestore/ids.js";
import { generateShippingLabelPdfBuffer } from "../shipments/label/shippingLabelPdf.js";
import { PDFDocument } from "pdf-lib";
import { allocateAwbFromPool } from "../awb/awbPoolService.js";
import { buildSearchTokensFromDoc } from "../firestore/searchTokens.js";
import { reserveHrGids } from "../firestore/hrGid.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { getShopsCollectionName, loadStoreDoc } from "../firestore/storeDocs.js";

const CONSIGNMENTS_COLLECTION = "consignments";
const internalToDisplayShipmentStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "new") return "New";
  if (s === "assigned") return "Assigned";
  if (s === "in_transit" || s === "in transit") return "In Transit";
  if (s === "delivered") return "Delivered";
  if (s === "rto") return "RTO In Transit";
  if (s === "rto_initiated" || s === "rto initiated") return "RTO Accepted";
  if (s === "rto_delivered" || s === "rto delivered") return "RTO Delivered";
  return "";
};

const getDocDisplayShipmentStatus = (data) =>
  String(data?.shipmentStatus ?? data?.shipment_status ?? "").trim();

const getDocShippingDateIso = (data) => {
  const direct = String(data?.shippingDate ?? data?.shipping_date ?? "").trim();
  if (direct) return direct;
  const requestedAt = String(data?.requestedAt ?? "").trim();
  if (requestedAt) return requestedAt;
  return String(data?.updatedAt ?? data?.updated_at ?? "").trim();
};

const normalizeShipmentStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "new") return "new";
  if (s === "assigned") return "assigned";
  if (s === "in_transit" || s === "in transit") return "in_transit";
  if (s === "delivered") return "delivered";
  if (s === "rto") return "rto";
  if (s === "rto_initiated" || s === "rto initiated") return "rto_initiated";
  if (s === "rto_delivered" || s === "rto delivered") return "rto_delivered";
  if (s === "fulfilled") return "delivered";
  if (s === "unfulfilled") return "new";
  if (s.includes("rto") && s.includes("initi")) return "rto_initiated";
  if (s.includes("rto") && s.includes("deliver")) return "rto_delivered";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("rto")) return "rto";
  if (s.includes("assign")) return "assigned";
  return "new";
};

export function createShipmentsRouter({ env, auth }) {
  const router = Router();

  const normalizeCenterForOrder = (data) => {
    const d = data && typeof data === "object" ? data : {};
    const originName = String(d.originName ?? "").trim();
    if (!originName) return null;
    const countryCandidate = String(d.country ?? "IN").trim();
    return {
      originName,
      contactPersonName: String(d.contactPersonName ?? "").trim(),
      address1: String(d.address1 ?? "").trim(),
      address2: String(d.address2 ?? "").trim(),
      city: String(d.city ?? "").trim(),
      state: String(d.state ?? "").trim(),
      pinCode: String(d.pinCode ?? "").trim(),
      country: countryCandidate || "IN",
      phone: String(d.phone ?? "").trim(),
      default: Boolean(d.default),
    };
  };

  const resolveFulfillmentCenterAddress = async ({ firestore, storeDocId, originName }) => {
    const normalized = String(storeDocId ?? "").trim().toLowerCase();
    if (!normalized) return null;
    const shopsCollection = getShopsCollectionName(env);
    const centersCol = firestore.collection(shopsCollection).doc(normalized).collection("fulfillmentCenter");
    const requested = String(originName ?? "").trim();
    if (!requested) return null;
    try {
      const snap = await centersCol.where("originName", "==", requested).limit(1).get();
      const doc = snap.docs[0];
      if (!doc?.exists) return null;
      return normalizeCenterForOrder(doc.data());
    } catch {
      return null;
    }
  };

  const formatFulfillmentCenterString = (center) => {
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
  };

  const sanitizeOrderForFirestore = (value) => {
    if (!value || typeof value !== "object") return null;
    const order = { ...value };
    // Do not persist redundant identity fields.
    delete order.orderKey;
    delete order.orderName;
    delete order.shipmentStatus;
    delete order.trackingNumber;
    delete order.trackingNumbers;
    delete order.trackingNumbersText;
    delete order.trackingCompany;
    delete order.trackingUrl;
    delete order.trackingUrls;
    delete order.awbNumber;
    delete order.courierType;
    delete order.weightKg;
    delete order.updatedAt;
    delete order.updated_at;

    if (order.shipping && typeof order.shipping === "object") {
      order.shipping = { ...order.shipping };
      delete order.shipping.phoneNumbers;
      delete order.shipping.phoneNumbersText;
    }
    return order;
  };

  const parseWeightKg = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number.parseFloat(String(value));
    if (Number.isNaN(n) || n < 0) return null;
    return Number.parseFloat(n.toFixed(1));
  };

  const normalizeCourierType = (value) => {
    const v = String(value ?? "").trim();
    const allowed = new Set(["Z- Express", "D- Surface", "D- Air", "COD Surface", "COD Air"]);
    return allowed.has(v) ? v : "";
  };

  router.post("/shipments/assign", auth.requireRole("shop"), async (req, res, next) => {
    try {
      const orderKey = String(req.body?.orderKey ?? req.body?.orderId ?? "").trim();
      const docIdFromBody = String(req.body?.docId ?? req.body?.hrGid ?? "").trim();
      if (!orderKey && !docIdFromBody) {
        res.status(400).json({ error: "order_key_required" });
        return;
      }

      const order = sanitizeOrderForFirestore(req.body?.order);
      const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const weightKg = parseWeightKg(req.body?.weightKg);
      const courierType = normalizeCourierType(req.body?.courierType);
      const assignedAt = new Date().toISOString();
      const shippingDate = assignedAt;
      const shipmentStatus = "Assigned";

      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const collectionId = CONSIGNMENTS_COLLECTION;
      const docId = docIdFromBody || toOrderDocId(orderKey);
      if (!docId) {
        res.status(400).json({ error: "order_key_required" });
        return;
      }

      const docRef = firestore.collection(collectionId).doc(docId);
      const storeDoc = await loadStoreDoc({ firestore, env, storeId });
      const storeData = storeDoc?.data() ?? {};
      const storeNameCandidate =
        storeData?.storeDetails?.storeName ?? storeData?.storeName ?? "";
      const storeName = String(storeNameCandidate).trim() || storeId;
      const storeKey = getShopCollectionInfo({ storeId }).storeId;

      const snap = await docRef.get();
      const existing = snap.exists ? snap.data() ?? {} : null;
      const existingOrder =
        existing?.order && typeof existing.order === "object" ? existing.order : null;
      const hrGid =
        String(existing?.hrGid ?? "").trim() ||
        String(docId ?? "").trim() ||
        (await reserveHrGids({ firestore, count: 1 }))[0] ||
        "";

      const centerName = String(order?.fulfillmentCenter ?? "").trim();
      const centerAddress =
        centerName && storeKey
          ? await resolveFulfillmentCenterAddress({
              firestore,
              storeDocId: storeKey,
              originName: centerName,
            })
          : null;
      const centerString = centerAddress ? formatFulfillmentCenterString(centerAddress) : "";
      const orderToPersist =
        existingOrder || order
          ? {
              ...(existingOrder ?? {}),
              ...(order ?? {}),
              ...(centerString ? { fulfillmentCenter: centerString } : {}),
            }
          : null;

      let allocatedAwb = "";
      try {
        const alloc = await allocateAwbFromPool({
          firestore,
          courierType,
          docId,
          assignedStoreId: storeId,
          orderId: String(orderToPersist?.orderId ?? "").trim(),
        });
        allocatedAwb = String(alloc?.awbNumber ?? "").trim();
      } catch {
        res.status(409).json({
          error: "awb_unavailable",
          message: "No available AWB numbers in pool for selected courier type.",
          courierType,
        });
        return;
      }

      await docRef.set(
        {
          docId,
          ...(hrGid ? { hrGid } : {}),
          storeId,
          shopName: storeName,
          ...(orderToPersist ? { order: orderToPersist } : {}),
          shipmentStatus,
          shippingDate,
          courierPartner: "DTDC",
          consignmentNumber: allocatedAwb,
          searchTokens: buildSearchTokensFromDoc({
            order: orderToPersist ?? order ?? existingOrder ?? {},
            consignmentNumber: allocatedAwb,
            courierPartner: "DTDC",
            courierType,
          }),
          ...(weightKg != null ? { weightKg } : {}),
          ...(courierType ? { courierType } : {}),
          ...(centerString ? { fulfillmentCenter: centerString } : {}),
          updatedAt: assignedAt,
          event: "ship_requested",
          requestedBy: {
            uid: String(req.user?.uid ?? ""),
            email: String(req.user?.email ?? ""),
            role: String(req.user?.role ?? ""),
          },
          requestedAt: assignedAt,
        },
        { merge: true }
      );

      res.json({
        ok: true,
        shipment: { shipmentStatus, updatedAt: assignedAt, shippingDate },
        firestore: { collectionId, docId, storeId },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipments/update", auth.requireRole("admin"), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = String(req.body?.storeId ?? "").trim().toLowerCase();
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const shipmentStatusRaw = String(req.body?.shipmentStatus ?? "").trim();
      const trackingNumber = String(req.body?.trackingNumber ?? "").trim();
      const shipmentStatus = normalizeShipmentStatus(shipmentStatusRaw);
      const updatedAt = new Date().toISOString();
      const shipmentStatusDisplay = internalToDisplayShipmentStatus(shipmentStatus) || "";

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const collectionId = CONSIGNMENTS_COLLECTION;
      const docIdFromBody = String(req.body?.docId ?? "").trim();
      const docId = docIdFromBody || toOrderDocId(String(req.body?.orderKey ?? "").trim());
      if (!docId) {
        res.status(400).json({ error: "order_key_required" });
        return;
      }
      const docRef = firestore.collection(collectionId).doc(docId);
      const historyRef = docRef.collection("shipment_status_history").doc();
      const storeDoc = await loadStoreDoc({ firestore, env, storeId });
      const storeDetails = storeDoc?.data() ?? {};
      const storeNameCandidate =
        storeDetails?.storeDetails?.storeName ?? storeDetails?.storeName ?? "";
      const storeName = String(storeNameCandidate).trim() || storeId;

      await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const data = snap.data() ?? {};
        const prevDisplay = getDocDisplayShipmentStatus(data) || "";
        const shippingDate = getDocShippingDateIso(data) || "";
        const existingOrder = data?.order && typeof data.order === "object" ? data.order : {};
        const nextConsignmentNumber = trackingNumber
          ? trackingNumber
          : String(data?.consignmentNumber ?? data?.consignment_number ?? "").trim();
        const courierPartnerCandidate = String(
          data?.courierPartner ?? data?.courier_partner ?? ""
        ).trim();
        const nextCourierPartner = courierPartnerCandidate || (nextConsignmentNumber ? "DTDC" : "");
        const nextCourierType = String(data?.courierType ?? data?.courier_type ?? "").trim();

        tx.set(
          docRef,
          {
            docId,
            storeId,
            shopName: storeName,
            shipmentStatus: shipmentStatusDisplay,
            ...(trackingNumber ? { consignmentNumber: trackingNumber } : {}),
            ...(trackingNumber ? { courierPartner: nextCourierPartner } : {}),
            shippingDate: shippingDate || updatedAt,
            updatedAt,
            searchTokens: buildSearchTokensFromDoc({
              order: existingOrder,
              consignmentNumber: nextConsignmentNumber,
              courierPartner: nextCourierPartner,
              courierType: nextCourierType,
            }),
            event: "admin_update",
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

      res.json({
        ok: true,
        shipment: { shipmentStatus: shipmentStatusDisplay, consignmentNumber: trackingNumber, updatedAt },
        firestore: { collectionId, docId, storeId },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/shipments/label.pdf",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    async (req, res) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const docIdFromQuery = String(req.query?.docId ?? "").trim();
        const orderKey = String(req.query?.orderKey ?? "").trim();
        if (!docIdFromQuery && !orderKey) {
          res.status(400).json({ error: "order_key_required" });
          return;
        }

        const role = String(req.user?.role ?? "").trim();
        const storeId =
          role === ROLE_ADMIN
            ? String(req.query?.storeId ?? "").trim().toLowerCase()
            : String(req.user?.storeId ?? "").trim().toLowerCase();
        if (!storeId) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const collectionId = CONSIGNMENTS_COLLECTION;
        const storeDoc = await loadStoreDoc({ firestore, env, storeId });
        const storeData = storeDoc?.data() ?? {};
        const shopDomainCandidate = String(storeData?.storeDomain ?? storeDoc?.id ?? "").trim();
        const shopDomain = shopDomainCandidate || storeId;
        const storedStoreId = String(storeData?.storeId ?? storeDoc?.id ?? storeId).trim();
        const lookupId = docIdFromQuery || toOrderDocId(orderKey);
        let snap = await firestore.collection(collectionId).doc(lookupId).get();
        if (!snap.exists && orderKey) {
          const search = await firestore
            .collection(collectionId)
            .where("order.orderId", "==", orderKey)
            .limit(1)
            .get();
          if (!search.empty) {
            snap = search.docs[0];
          }
        }

        if (!snap?.exists) {
          res.status(404).json({ error: "shipment_not_found" });
          return;
        }

        const actualDocId = snap.id;
        const doc = snap.data() ?? {};

        const pdf = await generateShippingLabelPdfBuffer({
          env,
          shopDomain,
          storeId: storedStoreId,
          firestoreDoc: doc,
        });

        const filenameSafe = `label_${actualDocId}.pdf`;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filenameSafe}"`);
        res.status(200).send(pdf);
      } catch (error) {
        console.error("label render failed:", error);
        if (error?.code === "order_missing") {
          res.status(422).json({ error: "order_missing" });
          return;
        }
        const message = String(error?.message ?? "").trim();
        res.status(500).json({ error: "label_render_failed", code: String(error?.code ?? ""), message });
      }
    }
  );

  router.post(
    "/shipments/labels/bulk.pdf",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    async (req, res) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const orderKeysRaw = Array.isArray(req.body?.orderKeys) ? req.body.orderKeys : [];
        const orderKeys = orderKeysRaw
          .map((v) => String(v ?? "").trim())
          .filter(Boolean);
        const docIdsRaw = Array.isArray(req.body?.docIds) ? req.body.docIds : [];
        const docIds = docIdsRaw.map((v) => String(v ?? "").trim()).filter(Boolean);

        if (orderKeys.length === 0 && docIds.length === 0) {
          res.status(400).json({ error: "order_keys_required" });
          return;
        }
        const totalCount = docIds.length || orderKeys.length;
        if (totalCount > 50) {
          res.status(400).json({ error: "order_keys_limit_exceeded", limit: 50 });
          return;
        }

        const role = String(req.user?.role ?? "").trim();
        const storeId =
          role === ROLE_ADMIN
            ? String(req.body?.storeId ?? "").trim().toLowerCase()
            : String(req.user?.storeId ?? "").trim().toLowerCase();
        if (!storeId) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const collectionId = CONSIGNMENTS_COLLECTION;
        const storeDoc = await loadStoreDoc({ firestore, env, storeId });
        const storeData = storeDoc?.data() ?? {};
        const shopDomainCandidate = String(storeData?.storeDomain ?? storeDoc?.id ?? "").trim();
        const shopDomain = shopDomainCandidate || storeId;
        const storedStoreId = String(storeData?.storeId ?? storeDoc?.id ?? storeId).trim();

        const missing = [];
        const docs = [];
        const idsToFetch = docIds.length ? docIds : orderKeys.map((k) => toOrderDocId(k));
        for (let i = 0; i < idsToFetch.length; i += 1) {
          const docId = idsToFetch[i];
          let snap = await firestore.collection(collectionId).doc(docId).get();
          if (!snap.exists && orderKeys[i]) {
            const found = await firestore
              .collection(collectionId)
              .where("order.orderId", "==", orderKeys[i])
              .limit(1)
              .get();
            if (!found.empty) snap = found.docs[0];
          }
          if (!snap?.exists) {
            missing.push(docIds.length ? docId : orderKeys[i]);
            continue;
          }
          docs.push({ docId: snap.id, data: snap.data() ?? {} });
        }

        if (missing.length) {
          res.status(422).json({ error: "shipment_not_found", missing });
          return;
        }

        const merged = await PDFDocument.create();
        for (const { data } of docs) {
          const labelBytes = await generateShippingLabelPdfBuffer({
            env,
            shopDomain,
            storeId: storedStoreId,
            firestoreDoc: data,
          });
          const labelDoc = await PDFDocument.load(labelBytes);
          const [page0] = await merged.copyPages(labelDoc, [0]);
          merged.addPage(page0);
        }

        const out = await merged.save({ useObjectStreams: false });
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="shipping_labels_${docs.length}.pdf"`
        );
        res.status(200).send(Buffer.from(out));
      } catch (error) {
        console.error("bulk label render failed:", error);
        const message = String(error?.message ?? "").trim();
        res.status(500).json({ error: "bulk_label_render_failed", code: String(error?.code ?? ""), message });
      }
    }
  );

  return router;
}
