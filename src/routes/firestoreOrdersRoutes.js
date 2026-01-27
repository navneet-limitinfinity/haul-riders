import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";

export function createFirestoreOrdersRouter({ env, auth }) {
  const router = Router();

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

  const getAdminQueryForStatus = ({ query, status, limit }) => {
    if (!status || status === "all") {
      return query.orderBy("requestedAt", "desc").limit(limit);
    }

    if (status === "assigned") {
      return query
        .where("shipmentStatus", "in", ["assigned", "Assigned", "ASSIGNED"])
        .limit(limit);
    }

    if (status === "delivered") {
      return query
        .where("shipmentStatus", "in", ["delivered", "Delivered", "DELIVERED"])
        .limit(limit);
    }

    if (status === "rto") {
      return query
        .where("shipmentStatus", "in", [
          "rto",
          "RTO",
          "rto_initiated",
          "rto initiated",
          "RTO Initiated",
          "rto_delivered",
          "rto delivered",
          "RTO Delivered",
        ])
        .limit(limit);
    }

    if (status === "in_transit") {
      // Firestore 'not-in' doesn't match missing fields; our docs always set shipmentStatus.
      return query
        .where("shipmentStatus", "not-in", [
          "assigned",
          "delivered",
          "rto",
          "rto_initiated",
          "rto_delivered",
        ])
        .limit(limit);
    }

    return query.where("shipmentStatus", "==", status).limit(limit);
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
        env,
        storeId: storeId || shopDomain,
      });

      const baseQuery = admin.firestore().collection(collectionId);
      const query = getAdminQueryForStatus({
        query: baseQuery,
        status: statusNorm || "assigned",
        limit,
      });

      const snap = await query.get();
      const rows = snap.docs.map((doc) => {
        const data = doc.data() ?? {};
        const order = data.order && typeof data.order === "object" ? data.order : null;
        const shipmentStatus = String(data.shipmentStatus ?? "").trim();
        const orderKey = String(data.orderKey ?? doc.id).trim();
        const requestedAt = String(data.requestedAt ?? data.updatedAt ?? "").trim();
        return {
          ...(order ?? {}),
          orderKey,
          shipmentStatus: shipmentStatus || "assigned",
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
        const { collectionId } = getShopCollectionInfo({ env, storeId });
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
      const { collectionId, displayName } = getShopCollectionInfo({ env, storeId });

      const baseQuery = admin.firestore().collection(collectionId);
      const query = getAdminQueryForStatus({
        query: baseQuery,
        status: statusNorm || "assigned",
        limit,
      });

      const snap = await query.get();
      const rows = snap.docs.map((doc) => {
        const data = doc.data() ?? {};
        const order = data.order && typeof data.order === "object" ? data.order : null;
        const shipmentStatus = String(data.shipmentStatus ?? "").trim();
        const orderKey = String(data.orderKey ?? doc.id).trim();
        const requestedAt = String(data.requestedAt ?? "").trim();
        return {
          ...(order ?? {}),
          orderKey,
          shipmentStatus: shipmentStatus || "assigned",
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

  return router;
}
