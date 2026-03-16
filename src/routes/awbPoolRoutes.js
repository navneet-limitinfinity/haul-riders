import { Router } from "express";
import multer from "multer";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { parseCsvRows } from "../orders/import/parseCsvRows.js";
import { uploadAwbPoolCsv } from "../awb/awbPoolService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export function createAwbPoolRouter({ env, auth }) {
  const router = Router();

  const DTDC_TRACK_URL = "https://www.dtdc.com/wp-json/custom/v1/domestic/track";

  const normalizeAwb = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    return raw.replaceAll(/[^a-zA-Z0-9]/g, "").trim().toUpperCase();
  };

  const buildStatusTimeline = (statuses = [], limit = 10) => {
    const entries = Array.isArray(statuses) ? statuses : [];
    return entries.slice(0, limit).map((entry) => ({
      statusTimestamp: entry.statusTimestamp ?? "",
      statusDescription: entry.statusDescription ?? "",
      remarks: String(entry.remarks ?? "")
        .replace(/<[^>]+>/g, "")
        .trim(),
      actBranchName: entry.actBranchName ?? "",
      actCityName: entry.actCityName ?? "",
    }));
  };

  const pickHeader = (header = {}) => ({
    currentStatusCode: header.currentStatusCode ?? "",
    currentStatusDescription: header.currentStatusDescription ?? "",
    currentStatusDate: header.currentStatusDate ?? "",
    currentStatusTime: header.currentStatusTime ?? "",
    currentLocationCityName: header.currentLocationCityName ?? "",
    originCity: header.originCity ?? "",
    destinationCity: header.destinationCity ?? "",
    opsEdd: header.opsEdd ?? "",
  });

  const normalizeShipmentStatus = (header, timeline) => {
    const latestHeader = String(header?.currentStatusDescription ?? "").trim();
    if (latestHeader) return latestHeader;
    const fallback = timeline?.[0]?.statusDescription ?? "";
    return fallback || "In Transit";
  };

  const fetchDtdcStatus = async (awb) => {
    const payload = JSON.stringify({ trackType: "cnno", trackNumber: awb });
    const referer = "https://www.dtdc.com/track-your-shipment/?awb=" + encodeURIComponent(awb);
    const response = await fetch(DTDC_TRACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: referer,
      },
      body: payload,
    });
    if (!response.ok) {
      throw new Error("dtdc_status_fetch_failed_" + response.status);
    }
    const data = await response.json();
    if (data?.statusCode && data.statusCode !== 200) {
      throw new Error(String(data.statusDescription || data.errorMessage || "dtdc_api_error"));
    }
    if (String(data?.statusDescription ?? "").toLowerCase() === "failed") {
      throw new Error("dtdc_reported_failed_status");
    }
    return data;
  };

  const parsePendingLimit = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 50;
    return Math.max(10, Math.min(500, Math.trunc(n)));
  };

  const buildAwbPayload = (doc) => {
    const data = doc.data() ?? {};
    return {
      awbNumber: doc.id,
      assignedDocId: String(data?.assignedDocId ?? ""),
      assignedStoreId: String(data?.assignedStoreId ?? ""),
      assignedAt: String(data?.assignedAt ?? data?.assigned_at ?? ""),
      updatedAt: String(data?.updatedAt ?? data?.updated_at ?? ""),
      category: String(data?.category ?? ""),
    };
  };

  router.post(
    "/admin/awb-pool/upload",
    auth.requireRole("admin"),
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const file = req.file;
        if (!file?.buffer) {
          res.status(400).json({ error: "file_required" });
          return;
        }

        // CSV only (XLSX explicitly not supported).
        const name = String(file?.originalname ?? "").toLowerCase();
        if (!name.endsWith(".csv")) {
          res.status(400).json({ error: "unsupported_file_type" });
          return;
        }

        let rows = [];
        try {
          rows = parseCsvRows(file.buffer);
        } catch (error) {
          res.status(400).json({ error: "invalid_csv", message: String(error?.message ?? "") });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();

        const result = await uploadAwbPoolCsv({
          firestore,
          rows,
          uploadedBy: {
            uid: String(req.user?.uid ?? ""),
            email: String(req.user?.email ?? ""),
            role: String(req.user?.role ?? ""),
          },
        });

        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, ...result });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/admin/awb-pool/pending", auth.requireRole("admin"), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const limit = parsePendingLimit(req.query?.limit);
      const pool = firestore.collection("awbPool");
      const docMap = new Map();

      const runQuery = async (query) => {
        const snapshot = await query.get();
        for (const doc of snapshot.docs) {
          if (!doc.exists) continue;
          docMap.set(doc.id, doc);
        }
      };

      await runQuery(pool.where("assigned", "==", true).where("delivered", "==", false).limit(limit));
      await runQuery(pool.where("assigned", "==", true).where("delivered", "==", null).limit(limit));

      const items = Array.from(docMap.values())
        .sort((a, b) => {
          const aStamp = String(a.data()?.updatedAt ?? a.data()?.updated_at ?? "");
          const bStamp = String(b.data()?.updatedAt ?? b.data()?.updated_at ?? "");
          return bStamp.localeCompare(aStamp);
        })
        .slice(0, limit)
        .map((doc) => buildAwbPayload(doc));

      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, total: items.length, items });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/awb-updates/:awb", auth.requireRole("admin"), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const awb = normalizeAwb(req.params?.awb);
      if (!awb) {
        res.status(400).json({ error: "awb_required" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const snap = await firestore.collection("awbUpdates").doc(awb).get();
      const data = snap.exists ? snap.data() ?? {} : null;
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, awb, exists: Boolean(snap.exists), data });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/awb-updates/:awb/refresh", auth.requireRole("admin"), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const awb = normalizeAwb(req.params?.awb);
      if (!awb) {
        res.status(400).json({ error: "awb_required" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const fieldValue = admin.firestore.FieldValue;

      const poolRef = firestore.collection("awbPool").doc(awb);
      const poolSnap = await poolRef.get();
      if (!poolSnap.exists) {
        res.status(404).json({ error: "awb_not_found" });
        return;
      }

      const poolData = poolSnap.data() ?? {};
      const payload = await fetchDtdcStatus(awb);
      const header = pickHeader(payload.header ?? {});
      const statusTimeline = buildStatusTimeline(payload.statuses);
      const normalizedStatus = normalizeShipmentStatus(header, statusTimeline);

      await firestore.collection("awbUpdates").doc(awb).set(
        {
          lastFetchedAt: fieldValue.serverTimestamp(),
          header,
          statusTimeline,
          storeId: poolData.assignedStoreId ?? "",
          source: "dtdc-rest",
        },
        { merge: true }
      );

      const assignedDocId = String(poolData.assignedDocId ?? "").trim();
      const assignedStoreId = String(poolData.assignedStoreId ?? "").trim();
      if (assignedDocId && assignedStoreId) {
        const { collectionId } = getShopCollectionInfo({ storeId: assignedStoreId });
        await firestore.collection(collectionId).doc(assignedDocId).set(
          {
            shipmentStatus: normalizedStatus,
            updatedAt: fieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await firestore.collection("consignments").doc(assignedDocId).set(
          {
            shipmentStatus: normalizedStatus,
            updatedAt: fieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (String(normalizedStatus ?? "").trim().toLowerCase() === "delivered") {
        await poolRef.set({ delivered: true }, { merge: true });
      }

      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, awb, shipmentStatus: normalizedStatus, header, statusTimeline });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
