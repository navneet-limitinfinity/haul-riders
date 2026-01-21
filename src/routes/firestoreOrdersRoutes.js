import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";

export function createFirestoreOrdersRouter({ env, auth }) {
  const router = Router();

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
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(req.query?.limit ?? "100", 10) || 100)
      );

      const admin = await getFirebaseAdmin({ env });
      const { collectionId, displayName } = getShopCollectionInfo({ env, storeId });

      let query = admin.firestore().collection(collectionId);
      if (status && status !== "all") {
        // Avoid composite-index requirement (where + orderBy) by sorting in-memory.
        query = query.where("shipmentStatus", "==", status).limit(limit);
      } else {
        // Simple query (no composite index) while still giving stable ordering.
        query = query.orderBy("requestedAt", "desc").limit(limit);
      }

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
      res.json({ shopName: displayName, storeId, status, count: orders.length, orders });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
