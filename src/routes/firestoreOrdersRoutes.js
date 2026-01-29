import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";

export function createFirestoreOrdersRouter({ env, auth }) {
  const router = Router();

  const getDocShipmentStatusRaw = (data) => {
    const direct = String(data?.shipmentStatus ?? "").trim();
    if (direct) return direct;
    const nested = data?.shipment && typeof data.shipment === "object" ? data.shipment : null;
    return String(nested?.shipmentStatus ?? "").trim();
  };

  const normalizeShipmentStatus = (value) => {
    const s = String(value ?? "").trim().toLowerCase();
    if (!s) return "";
    if (s === "assigned") return "assigned";
    if (s === "delivered") return "delivered";
    if (s === "in_transit" || s === "in transit") return "in_transit";
    if (s === "rto") return "rto";
    if (s === "rto_initiated" || s === "rto initiated") return "rto_initiated";
    if (s === "rto_delivered" || s === "rto delivered") return "rto_delivered";
    if (s.includes("rto") && s.includes("initi")) return "rto_initiated";
    if (s.includes("rto") && s.includes("deliver")) return "rto_delivered";
    if (s.includes("deliver")) return "delivered";
    if (s.includes("transit")) return "in_transit";
    if (s.includes("assign")) return "assigned";
    return s.replaceAll(/\s+/g, "_");
  };

  const getStatusVariants = (status) => {
    if (status === "assigned") return ["assigned", "Assigned", "ASSIGNED"];
    if (status === "delivered") return ["delivered", "Delivered", "DELIVERED"];
    if (status === "rto") {
      return [
        "rto",
        "RTO",
        "rto_initiated",
        "rto initiated",
        "RTO Initiated",
        "rto_delivered",
        "rto delivered",
        "RTO Delivered",
      ];
    }
    return [status];
  };

  const fetchDocsForStatus = async ({ firestore, collectionId, status, limit }) => {
    const col = firestore.collection(collectionId);
    const statusNorm = String(status ?? "").trim().toLowerCase();

    if (!statusNorm || statusNorm === "all") {
      return col.orderBy("requestedAt", "desc").limit(limit).get();
    }

    if (statusNorm === "in_transit") {
      // Use in-memory filtering so we catch docs where status might be stored under `shipment.shipmentStatus`.
      const excluded = new Set(["assigned", "delivered", "rto", "rto_initiated", "rto_delivered"]);
      const snap = await col.orderBy("requestedAt", "desc").limit(limit).get();
      const filteredDocs = snap.docs.filter((d) => {
        const data = d.data() ?? {};
        const raw = getDocShipmentStatusRaw(data);
        const norm = normalizeShipmentStatus(raw);
        return norm && !excluded.has(norm);
      });
      return { docs: filteredDocs };
    }

    const variants = getStatusVariants(statusNorm);
    if (variants.length === 1) {
      const [v] = variants;
      const [a, b] = await Promise.all([
        col.where("shipmentStatus", "==", v).limit(limit).get(),
        col.where("shipment.shipmentStatus", "==", v).limit(limit).get(),
      ]);
      const seen = new Set();
      const docs = [];
      for (const d of [...a.docs, ...b.docs]) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        docs.push(d);
      }
      return { docs };
    }

    // Firestore 'in' supports up to 10 values; our variant lists are <= 8.
    const [a, b] = await Promise.all([
      col.where("shipmentStatus", "in", variants).limit(limit).get(),
      col.where("shipment.shipmentStatus", "in", variants).limit(limit).get(),
    ]);
    const seen = new Set();
    const docs = [];
    for (const d of [...a.docs, ...b.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      docs.push(d);
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
        const shipmentStatus = getDocShipmentStatusRaw(data);
        const trackingNumber =
          String(data.trackingNumber ?? "").trim() ||
          String(data?.shipment?.trackingNumber ?? "").trim();
        const orderKey = String(data.orderKey ?? doc.id).trim();
        const requestedAt = String(data.requestedAt ?? data.updatedAt ?? "").trim();
        return {
          ...(order ?? {}),
          orderKey,
          shipmentStatus: shipmentStatus || "assigned",
          trackingNumber,
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

        const orderKey = String(req.body?.orderKey ?? "").trim();
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
        const shipmentStatus = getDocShipmentStatusRaw(data);
        const trackingNumber =
          String(data.trackingNumber ?? "").trim() ||
          String(data?.shipment?.trackingNumber ?? "").trim();
        const orderKey = String(data.orderKey ?? doc.id).trim();
        const requestedAt = String(data.requestedAt ?? "").trim();
        return {
          ...(order ?? {}),
          orderKey,
          shipmentStatus: shipmentStatus || "assigned",
          trackingNumber,
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

      const orderKey = String(req.body?.orderKey ?? "").trim();
      if (!orderKey) {
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
      const docId = toOrderDocId(orderKey);
      const updatedAt = new Date().toISOString();

      await admin
        .firestore()
        .collection(collectionId)
        .doc(docId)
        .set(
          {
            orderKey,
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
      res.json({ ok: true, orderKey, updatedAt });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
