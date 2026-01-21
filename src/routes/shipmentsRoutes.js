import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";

const normalizeShipmentStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "new") return "new";
  if (s === "assigned") return "assigned";
  if (s === "in_transit" || s === "in transit") return "in_transit";
  if (s === "delivered") return "delivered";
  if (s === "rto") return "rto";
  if (s === "fulfilled") return "delivered";
  if (s === "unfulfilled") return "new";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("rto")) return "rto";
  if (s.includes("assign")) return "assigned";
  return "new";
};

export function createShipmentsRouter({ env, auth }) {
  const router = Router();

  router.post("/shipments/assign", auth.requireRole("shop"), async (req, res, next) => {
    try {
      const orderKey = String(req.body?.orderKey ?? "").trim();
      if (!orderKey) {
        res.status(400).json({ error: "order_key_required" });
        return;
      }

      const order = req.body?.order && typeof req.body.order === "object" ? req.body.order : null;
      const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const assignedAt = new Date().toISOString();
      const shipment = {
        shipmentStatus: "assigned",
        assignedAt,
      };

      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
        env,
        storeId,
      });
      const docId = toOrderDocId(orderKey);
      const docRef = admin.firestore().collection(collectionId).doc(docId);

      const existing = await docRef.get();
      if (existing.exists) {
        res.json({
          ok: true,
          alreadyAssigned: true,
          shipment: existing.data()?.shipment ?? shipment,
          firestore: { collectionId, docId, storeId },
        });
        return;
      }

      await docRef.set(
          {
            orderKey,
            docId,
            storeId: normalizedStoreId,
            shopName: displayName,
            order,
            shipment,
            shipmentStatus: "assigned",
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
        shipment,
        firestore: { collectionId, docId, storeId: normalizedStoreId },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipments/update", auth.requireRole("admin"), async (req, res, next) => {
    try {
      const orderKey = String(req.body?.orderKey ?? "").trim();
      if (!orderKey) {
        res.status(400).json({ error: "order_key_required" });
        return;
      }

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

      const admin = await getFirebaseAdmin({ env });
      const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
        env,
        storeId,
      });
      const docId = toOrderDocId(orderKey);

      await admin
        .firestore()
        .collection(collectionId)
        .doc(docId)
        .set(
          {
            orderKey,
            docId,
            storeId: normalizedStoreId,
            shopName: displayName,
            shipmentStatus,
            trackingNumber,
            shipment: {
              shipmentStatus,
              trackingNumber,
              updatedAt,
            },
            event: "admin_update",
            updatedBy: {
              uid: String(req.user?.uid ?? ""),
              email: String(req.user?.email ?? ""),
              role: String(req.user?.role ?? ""),
            },
            updatedAt,
          },
          { merge: true }
        );

      res.json({
        ok: true,
        shipment: { shipmentStatus, trackingNumber, updatedAt },
        firestore: { collectionId, docId, storeId: normalizedStoreId },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
