import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";

export function createFirestoreOrdersRouter({ env, auth }) {
  const router = Router();

  const normalizeShipmentStatus = (value) => {
    const s = String(value ?? "").trim().toLowerCase();
    if (!s) return "";
    if (s === "new") return "new";
    if (s === "assigned") return "assigned";
    if (s === "delivered") return "delivered";
    if (s === "in_transit" || s === "in transit") return "in_transit";
    if (s === "rto") return "rto";
    return s.replaceAll(/\s+/g, "_");
  };

  const getStatusVariants = (status) => {
    if (status === "new") return ["New"];
    if (status === "assigned") return ["Assigned"];
    if (status === "delivered") return ["Delivered"];
    if (status === "in_transit")
      return ["In Transit", "Undelivered", "At Destination", "Out for Delivery", "Set RTO"];
    if (status === "rto")
      return ["RTO Accepted", "RTO In Transit", "RTO Reached At Destination", "RTO Delivered"];
    return [];
  };

  const fetchDocsForStatus = async ({ firestore, collectionId, status, limit }) => {
    const col = firestore.collection(collectionId);
    const statusNorm = String(status ?? "").trim().toLowerCase();

    if (!statusNorm || statusNorm === "all") {
      return col.orderBy("requestedAt", "desc").limit(limit).get();
    }

    const variants = getStatusVariants(statusNorm);
    if (!variants.length) return { docs: [] };

    const runQuery = async (field) => {
      if (variants.length === 1) {
        const snap = await col.where(field, "==", variants[0]).limit(limit).get();
        return snap.docs;
      }
      const snap = await col.where(field, "in", variants).limit(limit).get();
      return snap.docs;
    };

    let docs = [];
    try {
      docs = await runQuery("shipmentStatus");
    } catch {
      docs = [];
    }

    if (docs.length < limit) {
      try {
        const legacy = await runQuery("shipment_status");
        if (legacy.length > 0) {
          const seen = new Set(docs.map((d) => d.id));
          for (const d of legacy) {
            if (seen.has(d.id)) continue;
            docs.push(d);
            seen.add(d.id);
            if (docs.length >= limit) break;
          }
        }
      } catch {
        // ignore legacy query failures
      }
    }

    return { docs };
  };

  const toStoreIdFromShopDomain = (domain) => {
    const raw = String(domain ?? "").trim().toLowerCase();
    if (!raw) return "";
    const withoutScheme = raw.replace(/^https?:\/\//, "");
    const host = withoutScheme.split("/")[0] ?? "";
    return host.endsWith(".myshopify.com") ? host.slice(0, -".myshopify.com".length) : host;
  };

  router.get("/firestore/admin/orders", auth.requireRole("admin"), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const shopDomain = String(req.query?.shopDomain ?? "").trim().toLowerCase();
      const storeIdRaw = String(req.query?.storeId ?? req.query?.store ?? "").trim().toLowerCase();
      const storeId = storeIdRaw || toStoreIdFromShopDomain(shopDomain);
      if (!storeId && !shopDomain) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const status = String(req.query?.status ?? "assigned").trim().toLowerCase();
      const statusNorm = normalizeShipmentStatus(status) || (status === "all" ? "all" : "");
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(req.query?.limit ?? "200", 10) || 200)
      );

      const admin = await getFirebaseAdmin({ env });
      const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
        storeId: storeId || shopDomain,
      });

      const firestore = admin.firestore();
      const snap = await fetchDocsForStatus({
        firestore,
        collectionId,
        status: statusNorm || "assigned",
        limit,
      });
      const docs = Array.isArray(snap?.docs) ? snap.docs : [];

      const rows = docs.map((doc) => {
        const data = doc.data() ?? {};
        const order = data.order && typeof data.order === "object" ? data.order : null;
        const docId = String(doc.id ?? "").trim();
        const shipmentStatus = String(data?.shipmentStatus ?? data?.shipment_status ?? "").trim();
        const consignmentNumber = String(data?.consignmentNumber ?? data?.consignment_number ?? "").trim();
        const courierPartner = String(data?.courierPartner ?? data?.courier_partner ?? "").trim();
        const weightKg = data?.weightKg ?? data?.weight ?? "";
        const courierType = String(data?.courierType ?? data?.courier_type ?? "").trim();
        const shippingDate = String(data?.shippingDate ?? data?.shipping_date ?? "").trim();
        const expectedDeliveryDate = String(
          data?.expectedDeliveryDate ?? data?.expected_delivery_date ?? ""
        ).trim();
        const updatedAt = String(data?.updatedAt ?? data?.updated_at ?? "").trim();
        const orderId = String(order?.orderId ?? order?.orderName ?? order?.order_id ?? "").trim();
        const orderName = String(order?.orderName ?? orderId).trim();
        const orderKey = String(data.orderKey ?? orderId).trim();
        const requestedAt = String(data.requestedAt ?? data.updatedAt ?? data.updated_at ?? "").trim();
        return {
          ...(order ?? {}),
          docId,
          orderKey,
          orderId,
          orderName,
          shipmentStatus,
          consignmentNumber,
          courierPartner,
          weightKg,
          courierType,
          shippingDate,
          expectedDeliveryDate,
          updatedAt,
          firestore: {
            shopName: String(data.shopName ?? displayName),
            requestedAt,
          },
        };
      });

      const orders = rows.sort((a, b) =>
        String(b?.firestore?.requestedAt ?? "").localeCompare(
          String(a?.firestore?.requestedAt ?? "")
        )
      );

      res.setHeader("Cache-Control", "no-store");
      res.json({
        shopName: displayName,
        storeId: normalizedStoreId,
        status: statusNorm || "assigned",
        count: orders.length,
        orders,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/firestore/orders/exists",
    auth.requireRole("shop"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const orderKey = String(req.body?.orderKey ?? req.body?.orderId ?? "").trim();
        if (!orderKey) {
          res.status(400).json({ error: "order_key_required" });
          return;
        }

        const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
        if (!storeId) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const { collectionId } = getShopCollectionInfo({ storeId });
        const docId = toOrderDocId(orderKey);

        const snap = await admin.firestore().collection(collectionId).doc(docId).get();
        res.setHeader("Cache-Control", "no-store");
        res.json({ exists: Boolean(snap?.exists), collectionId, docId, orderKey });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/firestore/orders", auth.requireRole("shop"), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const status = String(req.query?.status ?? "assigned").trim().toLowerCase();
      const statusNorm = normalizeShipmentStatus(status) || (status === "all" ? "all" : "");
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(req.query?.limit ?? "100", 10) || 100)
      );

      const admin = await getFirebaseAdmin({ env });
      const { collectionId, displayName } = getShopCollectionInfo({ storeId });

      const firestore = admin.firestore();
      const snap = await fetchDocsForStatus({
        firestore,
        collectionId,
        status: statusNorm || "assigned",
        limit,
      });
      const docs = Array.isArray(snap?.docs) ? snap.docs : [];

      const rows = docs.map((doc) => {
        const data = doc.data() ?? {};
        const order = data.order && typeof data.order === "object" ? data.order : null;
        const docId = String(doc.id ?? "").trim();
        const shipmentStatus = String(data?.shipmentStatus ?? data?.shipment_status ?? "").trim();
        const consignmentNumber = String(data?.consignmentNumber ?? data?.consignment_number ?? "").trim();
        const courierPartner = String(data?.courierPartner ?? data?.courier_partner ?? "").trim();
        const weightKg = data?.weightKg ?? data?.weight ?? "";
        const courierType = String(data?.courierType ?? data?.courier_type ?? "").trim();
        const shippingDate = String(data?.shippingDate ?? data?.shipping_date ?? "").trim();
        const expectedDeliveryDate = String(
          data?.expectedDeliveryDate ?? data?.expected_delivery_date ?? ""
        ).trim();
        const updatedAt = String(data?.updatedAt ?? data?.updated_at ?? "").trim();
        const orderId = String(order?.orderId ?? order?.orderName ?? order?.order_id ?? "").trim();
        const orderName = String(order?.orderName ?? orderId).trim();
        const orderKey = String(data.orderKey ?? orderId).trim();
        const requestedAt = String(data.requestedAt ?? data.updatedAt ?? data.updated_at ?? "").trim();
        return {
          ...(order ?? {}),
          docId,
          orderKey,
          orderId,
          orderName,
          shipmentStatus,
          consignmentNumber,
          courierPartner,
          weightKg,
          courierType,
          shippingDate,
          expectedDeliveryDate,
          updatedAt,
          firestore: {
            shopName: String(data.shopName ?? displayName),
            requestedAt,
          },
        };
      });

      const orders = rows.sort((a, b) =>
        String(b?.firestore?.requestedAt ?? "").localeCompare(
          String(a?.firestore?.requestedAt ?? "")
        )
      );

      res.setHeader("Cache-Control", "no-store");
      res.json({
        shopName: displayName,
        storeId,
        status: statusNorm || "assigned",
        count: orders.length,
        orders,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/firestore/orders/update-shipping", auth.requireRole("shop"), async (req, res, next) => {
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

      const shipping = req.body?.shipping && typeof req.body.shipping === "object" ? req.body.shipping : null;
      if (!shipping) {
        res.status(400).json({ error: "shipping_required" });
        return;
      }

      const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const normalize = (v) => String(v ?? "").trim();

      const admin = await getFirebaseAdmin({ env });
      const { collectionId } = getShopCollectionInfo({ storeId });
      const docId = docIdFromBody || toOrderDocId(orderKey);
      const updatedAt = new Date().toISOString();

      await admin
        .firestore()
        .collection(collectionId)
        .doc(docId)
        .set(
          {
            docId,
            storeId,
            order: {
              shipping: {
                fullName: normalize(shipping.fullName),
                address1: normalize(shipping.address1),
                address2: normalize(shipping.address2),
                city: normalize(shipping.city),
                state: normalize(shipping.state),
                pinCode: normalize(shipping.pinCode),
                phone1: normalize(shipping.phone1),
                phone2: normalize(shipping.phone2),
              },
            },
            event: "shop_edit",
            updatedAt,
          },
          { merge: true }
        );

      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, docId, orderKey, updatedAt });
    } catch (error) {
      next(error);
    }
  });

  const resolveShopDomain = ({ storeId }) => {
    const raw = String(storeId ?? "").trim().toLowerCase();
    if (!raw) return "";
    if (raw.includes(".")) return raw;
    return `${raw}.myshopify.com`;
  };

  const getFulfillmentCentersRef = ({ firestore, shopDomain }) => {
    const shopsCollection = String(env?.auth?.firebase?.shopsCollection ?? "shops").trim() || "shops";
    return firestore.collection(shopsCollection).doc(shopDomain).collection("fulfillmentCenter");
  };

  router.get(
    "/firestore/admin/fulfillment-centers",
    auth.requireRole("admin"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const storeId = String(req.query?.storeId ?? req.query?.store ?? req.query?.shopDomain ?? "").trim().toLowerCase();
        const shopDomain = resolveShopDomain({ storeId });
        if (!shopDomain) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, shopDomain });
        const snap = await centersRef.orderBy("originName", "asc").get();
        const centers = snap.docs.map((d) => ({ id: d.id, ...(d.data() ?? {}) }));

        res.setHeader("Cache-Control", "no-store");
        res.json({ shopDomain, count: centers.length, centers });
      } catch (error) {
        next(error);
      }
    }
  );

  const normalizeCenterPayload = (body) => {
    const pinCode = String(body?.pinCode ?? "")
      .replaceAll(/[^\d]/g, "")
      .slice(0, 6);
    const phone = String(body?.phone ?? "")
      .replaceAll(/[^\d]/g, "")
      .slice(0, 10);

    return {
      originName: String(body?.originName ?? "").trim(),
      contactPersonName: String(body?.contactPersonName ?? "").trim(),
      address1: String(body?.address1 ?? "").trim(),
      address2: String(body?.address2 ?? "").trim(),
      city: String(body?.city ?? "").trim(),
      state: String(body?.state ?? "").trim(),
      pinCode,
      country: String(body?.country ?? "IN").trim() || "IN",
      phone,
      default: Boolean(body?.default),
    };
  };

  router.get(
    "/firestore/fulfillment-centers",
    auth.requireRole("shop"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
        const shopDomain = resolveShopDomain({ storeId });
        if (!shopDomain) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, shopDomain });
        const snap = await centersRef.orderBy("originName", "asc").get();
        const centers = snap.docs.map((d) => ({ id: d.id, ...(d.data() ?? {}) }));

        res.setHeader("Cache-Control", "no-store");
        res.json({ shopDomain, count: centers.length, centers });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/firestore/fulfillment-centers",
    auth.requireRole("shop"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
        const shopDomain = resolveShopDomain({ storeId });
        if (!shopDomain) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const payload = normalizeCenterPayload(req.body ?? {});
        if (!payload.originName) {
          res.status(400).json({ error: "origin_name_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, shopDomain });
        const existing = await centersRef.get();

        const isFirst = existing.empty;
        const makeDefault = Boolean(payload.default) || isFirst;
        const docRef = centersRef.doc();

        const batch = firestore.batch();
        if (makeDefault) {
          for (const doc of existing.docs) {
            if (doc.id === docRef.id) continue;
            batch.update(doc.ref, { default: false });
          }
        }

        const createdAt = new Date().toISOString();
        batch.set(docRef, { ...payload, default: makeDefault, createdAt, updatedAt: createdAt });
        await batch.commit();

        res.setHeader("Cache-Control", "no-store");
        res.status(201).json({ id: docRef.id, center: { id: docRef.id, ...payload, default: makeDefault } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    "/firestore/fulfillment-centers/:id",
    auth.requireRole("shop"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const centerId = String(req.params?.id ?? "").trim();
        if (!centerId) {
          res.status(400).json({ error: "center_id_required" });
          return;
        }

        const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
        const shopDomain = resolveShopDomain({ storeId });
        if (!shopDomain) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const payload = normalizeCenterPayload(req.body ?? {});
        if (!payload.originName) {
          res.status(400).json({ error: "origin_name_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, shopDomain });
        const docRef = centersRef.doc(centerId);
        const snap = await docRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "center_not_found" });
          return;
        }

        const makeDefault = Boolean(payload.default);
        const batch = firestore.batch();
        if (makeDefault) {
          const all = await centersRef.get();
          for (const doc of all.docs) {
            batch.update(doc.ref, { default: doc.id === centerId });
          }
          batch.update(docRef, { ...payload, default: true, updatedAt: new Date().toISOString() });
        } else {
          batch.update(docRef, { ...payload, default: Boolean(snap.data()?.default), updatedAt: new Date().toISOString() });
        }

        await batch.commit();
        const updatedSnap = await docRef.get();
        res.setHeader("Cache-Control", "no-store");
        res.json({ id: centerId, center: { id: centerId, ...(updatedSnap.data() ?? {}) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/firestore/fulfillment-centers/:id/default",
    auth.requireRole("shop"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const centerId = String(req.params?.id ?? "").trim();
        if (!centerId) {
          res.status(400).json({ error: "center_id_required" });
          return;
        }

        const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
        const shopDomain = resolveShopDomain({ storeId });
        if (!shopDomain) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, shopDomain });
        const all = await centersRef.get();
        if (all.empty) {
          res.status(404).json({ error: "center_not_found" });
          return;
        }

        const batch = firestore.batch();
        let found = false;
        for (const doc of all.docs) {
          const isDefault = doc.id === centerId;
          if (isDefault) found = true;
          batch.update(doc.ref, { default: isDefault });
        }
        if (!found) {
          res.status(404).json({ error: "center_not_found" });
          return;
        }

        await batch.commit();
        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, id: centerId });
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    "/firestore/fulfillment-centers/:id",
    auth.requireRole("shop"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const centerId = String(req.params?.id ?? "").trim();
        if (!centerId) {
          res.status(400).json({ error: "center_id_required" });
          return;
        }

        const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
        const shopDomain = resolveShopDomain({ storeId });
        if (!shopDomain) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, shopDomain });
        const all = await centersRef.get();
        if (all.empty) {
          res.status(404).json({ error: "center_not_found" });
          return;
        }

        if (all.docs.length <= 1) {
          res.status(400).json({ error: "cannot_delete_last_center" });
          return;
        }

        const target = all.docs.find((d) => d.id === centerId) ?? null;
        if (!target) {
          res.status(404).json({ error: "center_not_found" });
          return;
        }

        const wasDefault = Boolean(target.data()?.default);
        const batch = firestore.batch();
        batch.delete(target.ref);
        if (wasDefault) {
          const nextDefault = all.docs.find((d) => d.id !== centerId) ?? null;
          if (nextDefault) batch.update(nextDefault.ref, { default: true });
        }
        await batch.commit();

        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, id: centerId });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
