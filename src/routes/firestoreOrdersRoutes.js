import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";
import { buildSearchTokensFromDoc } from "../firestore/searchTokens.js";
import { loadStoreDoc } from "../firestore/storeDocs.js";

export function createFirestoreOrdersRouter({ env, auth }) {
  const router = Router();
  const wantsDebug = (req) =>
    String(req.query?.debug ?? "").trim() === "1" ||
    String(env?.logLevel ?? "").trim().toLowerCase() === "debug" ||
    String(process.env.NODE_ENV ?? "").trim().toLowerCase() !== "production";

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

  const normalizeDisplayShipmentStatus = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const key = raw.toLowerCase();

    const all = [
      "New",
      "Assigned",
      "In Transit",
      "Undelivered",
      "At Destination",
      "Out for Delivery",
      "Set RTO",
      "Delivered",
      "RTO Accepted",
      "RTO In Transit",
      "RTO Reached At Destination",
      "RTO Delivered",
    ];
    for (const s of all) {
      if (s.toLowerCase() === key) return s;
    }

    const canonical = raw
      .replaceAll(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "_")
      .replaceAll(/^_+|_+$/g, "");

    const map = {
      new: "New",
      assigned: "Assigned",
      delivered: "Delivered",

      in_transit: "In Transit",
      intransit: "In Transit",
      undelivered: "Undelivered",
      at_destination: "At Destination",
      atdestination: "At Destination",
      out_for_delivery: "Out for Delivery",
      outfordelivery: "Out for Delivery",
      set_rto: "Set RTO",
      setrto: "Set RTO",

      rto_initiated: "RTO Accepted",
      rto_accepted: "RTO Accepted",
      rto_in_transit: "RTO In Transit",
      rto_intransit: "RTO In Transit",
      rto_reached_at_destination: "RTO Reached At Destination",
      rto_reached_atdestination: "RTO Reached At Destination",
      rto_delivered: "RTO Delivered",
      rto: "RTO In Transit",
    };

    return map[canonical] ?? "";
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

    // Fallback scan: catch legacy variations like "in transit" / "in_transit" / casing differences.
    if (docs.length < limit) {
      try {
        const allowed = new Set(getStatusVariants(statusNorm).map((v) => String(v ?? "").trim()));
        const seen = new Set(docs.map((d) => d.id));
        const scanLimit = Math.min(250, Math.max(limit * 6, 50));
        const scanSnap = await col.orderBy("requestedAt", "desc").limit(scanLimit).get();
        for (const d of scanSnap.docs) {
          if (docs.length >= limit) break;
          if (seen.has(d.id)) continue;
          const data = d.data() ?? {};
          const display = normalizeDisplayShipmentStatus(data?.shipmentStatus ?? data?.shipment_status);
          if (!display) continue;
          if (!allowed.has(display)) continue;
          docs.push(d);
          seen.add(d.id);
        }
      } catch {
        // ignore scan failures
      }
    }

    return { docs };
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
      const order = data?.order && typeof data.order === "object" ? data.order : {};
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

  const encodeCursor = ({ requestedAt, docId }) => {
    const ra = String(requestedAt ?? "").trim();
    const id = String(docId ?? "").trim();
    if (!ra || !id) return "";
    try {
      return Buffer.from(JSON.stringify({ requestedAt: ra, docId: id }), "utf8").toString("base64url");
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
      const requestedAt = String(parsed?.requestedAt ?? "").trim();
      const docId = String(parsed?.docId ?? "").trim();
      if (!requestedAt || !docId) return "";
      return { requestedAt, docId };
    } catch {
      return "";
    }
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
      const q = String(req.query?.q ?? "").trim();
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(req.query?.limit ?? "200", 10) || 200)
      );

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const storeDoc =
        (storeId || shopDomain)
          ? await loadStoreDoc({ env, firestore, storeId: storeId || shopDomain })
          : null;
      const canonicalStoreId = String(storeDoc?.id ?? storeDoc?.data()?.storeId ?? storeId ?? "").trim();
      if (!canonicalStoreId) {
        res.status(404).json({ error: "store_document_missing" });
        return;
      }

      const storeDetails = storeDoc?.data() ?? {};
      const shopName =
        String(
          storeDetails?.storeDetails?.storeName ??
            storeDetails?.storeName ??
            storeDetails?.displayName ??
            canonicalStoreId
        ).trim();

      const collectionId = "consignments";
      const scanLimit = Math.min(Math.max(limit * 3, limit + 10, 50), 500);

      const snapshot = await firestore
        .collection(collectionId)
        .where("storeId", "==", canonicalStoreId)
        .orderBy("requestedAt", "desc")
        .limit(scanLimit)
        .get();

      const statusVariants =
        statusNorm && statusNorm !== "all" ? getStatusVariants(statusNorm) : [];
      const statusSet =
        statusVariants.length > 0
          ? new Set(statusVariants.map((value) => String(value ?? "").trim().toLowerCase()))
          : null;

      const filtered = [];
      for (const doc of snapshot.docs) {
        const data = doc.data() ?? {};
        if (statusSet) {
          const display = String(
            normalizeDisplayShipmentStatus(data?.shipmentStatus ?? data?.shipment_status)
          )
            .toLowerCase()
            .trim();
          if (!display || !statusSet.has(display)) continue;
        }
        if (q && !matchesSearch({ data, q })) continue;
        filtered.push({ docId: doc.id, data });
        if (filtered.length >= limit) break;
      }

      const orders = filtered.map(({ docId, data }) => ({ docId, ...data }));
      const hasMore = filtered.length >= limit && snapshot.docs.length > filtered.length;
      const nextCursor =
        hasMore && filtered.length > 0
          ? encodeCursor({
              requestedAt: String(filtered[filtered.length - 1]?.data?.requestedAt ?? ""),
              docId: filtered[filtered.length - 1]?.docId ?? "",
            })
          : "";

      res.setHeader("Cache-Control", "no-store");
      res.json({
        shopName,
        storeId: canonicalStoreId,
        status: statusNorm || "assigned",
        count: orders.length,
        nextCursor,
        orders,
        ...(wantsDebug(req)
          ? {
              debug: {
                collectionId,
                status: statusNorm || "assigned",
                query: q,
                limit,
                scannedDocs: snapshot.docs.length,
                returnedDocs: orders.length,
              },
            }
          : {}),
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
      const q = String(req.query?.q ?? "").trim();
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(req.query?.limit ?? "100", 10) || 100)
      );

      const { collectionId, displayName } = getShopCollectionInfo({ storeId });
      // NOTE: Firestore order-reading logic intentionally removed for `/shop/orders` and `/admin/orders`.
      // You will implement your new architecture to fetch/read orders in all tabs.
      const orders = [];
      const nextCursor = "";

      res.setHeader("Cache-Control", "no-store");
      res.json({
        shopName: displayName,
        storeId,
        status: statusNorm || "assigned",
        count: orders.length,
        nextCursor: nextCursor || "",
        orders,
        ...(wantsDebug(req)
          ? {
              debug: {
                collectionId,
                status: statusNorm || "assigned",
                query: q,
                limit,
                scannedDocs: 0,
                scannedBatches: 0,
                returnedDocs: 0,
                note: "firestore_read_logic_removed",
              },
            }
          : {}),
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

      const docRef = admin.firestore().collection(collectionId).doc(docId);
      const snap = await docRef.get();
      const existing = snap.data() ?? {};
      const existingOrder = existing?.order && typeof existing.order === "object" ? existing.order : {};
      const existingConsignment = String(existing?.consignmentNumber ?? existing?.consignment_number ?? "").trim();
      const existingCourierPartner = String(existing?.courierPartner ?? existing?.courier_partner ?? "").trim();
      const existingCourierType = String(existing?.courierType ?? existing?.courier_type ?? "").trim();

      const nextShipping = {
        fullName: normalize(shipping.fullName),
        address1: normalize(shipping.address1),
        address2: normalize(shipping.address2),
        city: normalize(shipping.city),
        state: normalize(shipping.state),
        pinCode: normalize(shipping.pinCode),
        phone1: normalize(shipping.phone1),
        phone2: normalize(shipping.phone2),
      };

      const nextOrder = { ...existingOrder, shipping: nextShipping };

      await docRef.set(
        {
          docId,
          storeId,
          order: { shipping: nextShipping },
          searchTokens: buildSearchTokensFromDoc({
            order: nextOrder,
            consignmentNumber: existingConsignment,
            courierPartner: existingCourierPartner,
            courierType: existingCourierType,
          }),
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

  const getFulfillmentCentersRef = ({ firestore, storeDocId }) => {
    const shopsCollection = String(env?.auth?.firebase?.shopsCollection ?? "shops").trim() || "shops";
    const normalized = String(storeDocId ?? "").trim().toLowerCase();
    if (!normalized) return null;
    return firestore.collection(shopsCollection).doc(normalized).collection("fulfillmentCenter");
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

        const rawStoreId = String(req.query?.storeId ?? req.query?.store ?? req.query?.shopDomain ?? "").trim();
        const { storeId: storeKey } = getShopCollectionInfo({ storeId: rawStoreId });
        if (!storeKey) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, storeDocId: storeKey });
        if (!centersRef) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }
        const snap = await centersRef.orderBy("originName", "asc").get();
        const centers = snap.docs.map((d) => ({ id: d.id, ...(d.data() ?? {}) }));

        res.setHeader("Cache-Control", "no-store");
        res.json({ storeId: storeKey, count: centers.length, centers });
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

        const rawStoreId = String(req.user?.storeId ?? "").trim();
        const { storeId: storeKey } = getShopCollectionInfo({ storeId: rawStoreId });
        if (!storeKey) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, storeDocId: storeKey });
        if (!centersRef) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }
        const snap = await centersRef.orderBy("originName", "asc").get();
        const centers = snap.docs.map((d) => ({ id: d.id, ...(d.data() ?? {}) }));

        res.setHeader("Cache-Control", "no-store");
        res.json({ storeId: storeKey, count: centers.length, centers });
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

        const rawStoreId = String(req.user?.storeId ?? "").trim();
        const { storeId: storeKey } = getShopCollectionInfo({ storeId: rawStoreId });
        if (!storeKey) {
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
        const centersRef = getFulfillmentCentersRef({ firestore, storeDocId: storeKey });
        if (!centersRef) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }
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

        const rawStoreId = String(req.user?.storeId ?? "").trim();
        const { storeId: storeKey } = getShopCollectionInfo({ storeId: rawStoreId });
        if (!storeKey) {
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
        const centersRef = getFulfillmentCentersRef({ firestore, storeDocId: storeKey });
        if (!centersRef) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }
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

        const rawStoreId = String(req.user?.storeId ?? "").trim();
        const { storeId: storeKey } = getShopCollectionInfo({ storeId: rawStoreId });
        if (!storeKey) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, storeDocId: storeKey });
        if (!centersRef) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }
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

        const rawStoreId = String(req.user?.storeId ?? "").trim();
        const { storeId: storeKey } = getShopCollectionInfo({ storeId: rawStoreId });
        if (!storeKey) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const centersRef = getFulfillmentCentersRef({ firestore, storeDocId: storeKey });
        if (!centersRef) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }
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
