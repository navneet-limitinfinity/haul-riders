import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ROLE_ADMIN, ROLE_SHOP } from "../auth/roles.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { toOrderDocId } from "../firestore/ids.js";
import { generateShippingLabelPdfBuffer } from "../shipments/label/shippingLabelPdf.js";
import { renderShippingLabelHtml } from "../shipments/label/shippingLabelHtml.js";

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

  const parseWeightKg = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number.parseFloat(String(value));
    if (Number.isNaN(n) || n < 0) return null;
    return Number.parseFloat(n.toFixed(1));
  };

  const normalizeCourierType = (value) => {
    const v = String(value ?? "").trim();
    const allowed = new Set(["Z- Express", "D- Surface", "D- Air"]);
    return allowed.has(v) ? v : "";
  };

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

      const weightKg = parseWeightKg(req.body?.weightKg);
      const courierType = normalizeCourierType(req.body?.courierType);

      const assignedAt = new Date().toISOString();
      const shipment = {
        shipmentStatus: "assigned",
        assignedAt,
        ...(weightKg != null ? { weightKg } : {}),
        ...(courierType ? { courierType } : {}),
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

  router.get(
    "/shipments/label.pdf",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    async (req, res) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const orderKey = String(req.query?.orderKey ?? "").trim();
        if (!orderKey) {
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
        const { collectionId, storeId: normalizedStoreId } = getShopCollectionInfo({
          env,
          storeId,
        });
        const docId = toOrderDocId(orderKey);
        const snap = await admin.firestore().collection(collectionId).doc(docId).get();
        if (!snap.exists) {
          res.status(404).json({ error: "shipment_not_found" });
          return;
        }

        const format = String(req.query?.format ?? "").trim().toLowerCase();
        const doc = snap.data() ?? {};

        if (format === "html") {
          const labelHtml = await renderShippingLabelHtml({
            env,
            storeId: normalizedStoreId,
            firestoreDoc: doc,
          });
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.status(200).send(labelHtml);
          return;
        }

        const pdf = await generateShippingLabelPdfBuffer({ env, storeId: normalizedStoreId, firestoreDoc: doc });

        const filenameSafe = `label_${docId}.pdf`;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filenameSafe}"`);
        res.status(200).send(pdf);
      } catch (error) {
        if (error?.code === "order_missing") {
          res.status(422).json({ error: "order_missing" });
          return;
        }
        const message = String(error?.message ?? "").trim();
        const hint = message.includes("ENOTFOUND www.googleapis.com")
          ? "firebase_network_dns_blocked"
          : message.includes("chromium_launch_failed") || message.includes("Failed to launch")
            ? "chromium_missing_deps_or_sandbox"
            : "";

        res.status(500).json({
          error: "label_render_failed",
          code: String(error?.code ?? ""),
          message,
          ...(hint ? { hint } : {}),
        });
      }
    }
  );

  return router;
}
