import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import admin from "firebase-admin";

const DTDC_TRACK_URL = "https://www.dtdc.com/wp-json/custom/v1/domestic/track";
const MAX_BATCH = 60;
const STATUS_LIMIT = 10;

function getShopCollectionInfo({ storeId }) {
  const raw = String(storeId ?? "").trim().toLowerCase();
  if (!raw) return { collectionId: "shop" };
  const cleaned = raw
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  return { collectionId: cleaned || "shop" };
}

async function fetchDtdcStatus(awb) {
  const payload = JSON.stringify({ trackType: "cnno", trackNumber: awb });
  const referer = `https://www.dtdc.com/track-your-shipment/?awb=${encodeURIComponent(awb)}`;
  const response = await fetch(DTDC_TRACK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: referer,
    },
    body: payload,
  });
  if (!response.ok) {
    throw new Error(`dtc status fetch failed ${response.status}`);
  }
  const data = await response.json();
  if (data?.statusCode && data.statusCode !== 200) {
    throw new Error(`DTDC API error: ${data.statusDescription || data.errorMessage || "unknown"}`);
  }
  if (String(data?.statusDescription ?? "").toLowerCase() === "failed") {
    throw new Error("DTDC reported failed status");
  }
  return data;
}

function buildStatusTimeline(statuses = []) {
  const entries = Array.isArray(statuses) ? statuses : [];
  return entries
    .slice(0, STATUS_LIMIT)
    .map((entry) => ({
      statusTimestamp: entry.statusTimestamp ?? "",
      statusDescription: entry.statusDescription ?? "",
      remarks: String(entry.remarks ?? "")
        .replace(/<[^>]+>/g, "")
        .trim(),
      actBranchName: entry.actBranchName ?? "",
      actCityName: entry.actCityName ?? "",
    }));
}

function pickHeader(header = {}) {
  return {
    currentStatusCode: header.currentStatusCode ?? "",
    currentStatusDescription: header.currentStatusDescription ?? "",
    currentStatusDate: header.currentStatusDate ?? "",
    currentStatusTime: header.currentStatusTime ?? "",
    currentLocationCityName: header.currentLocationCityName ?? "",
    originCity: header.originCity ?? "",
    destinationCity: header.destinationCity ?? "",
    opsEdd: header.opsEdd ?? "",
  };
}

function normalizeShipmentStatus(header, timeline) {
  const latestHeader = String(header?.currentStatusDescription ?? "").trim();
  if (latestHeader) return latestHeader;
  const fallback = timeline[0]?.statusDescription ?? "";
  return fallback || "In Transit";
}

export const syncAwbStatus = onSchedule(
  {
    schedule: "0 12 * * *",
    timeZone: "Asia/Kolkata",
  },
  async () => {
    if (!admin.apps.length) {
      // In Cloud Functions Gen2, initialize with default service account.
      admin.initializeApp();
    }
    const firestore = admin.firestore();
    const fieldValue = admin.firestore.FieldValue;

    const metaRef = firestore.collection("meta").doc("lastAwbStatusSync");
    const awbSnapshot = await firestore
      .collection("awbPool")
      .where("assigned", "==", true)
      .where("delivered", "!=", true)
      .limit(MAX_BATCH)
      .get();

    if (!awbSnapshot.docs.length) {
      await metaRef.set(
        {
          name: "last awbStatus sync",
          time: fieldValue.serverTimestamp(),
          updatedCount: 0,
        },
        { merge: true }
      );
      logger.info("syncAwbStatus: no assigned/non-delivered AWBs to refresh");
      return;
    }

    let updatedCount = 0;

    if (!awbSnapshot.docs.length) {
      logger.info("syncAwbStatus: no assigned/non-delivered AWBs to refresh");
      return;
    }

    for (const doc of awbSnapshot.docs) {
      const awb = String(doc.id ?? "").trim().toUpperCase();
      if (!awb) continue;
      const data = doc.data();
      try {
        const payload = await fetchDtdcStatus(awb);
        const header = pickHeader(payload.header ?? {});
        const statusTimeline = buildStatusTimeline(payload.statuses);
        const normalizedStatus = normalizeShipmentStatus(header, statusTimeline);

        await firestore.collection("awbUpdates").doc(awb).set(
          {
            lastFetchedAt: fieldValue.serverTimestamp(),
            header,
            statusTimeline,
            storeId: data.assignedStoreId ?? "",
            source: "dtdc-rest",
          },
          { merge: true }
        );

        const assignedDocId = String(data.assignedDocId ?? "").trim();
        const assignedStoreId = String(data.assignedStoreId ?? "").trim();
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
        } else {
          logger.warn("syncAwbStatus: missing assignment metadata", { awb, assignedDocId, assignedStoreId });
        }
        if (String(normalizedStatus ?? "").trim().toLowerCase() === "delivered") {
          await firestore.collection("awbPool").doc(awb).set(
            {
              delivered: true,
            },
            { merge: true }
          );
        }
        updatedCount += 1;
      } catch (error) {
        logger.error("syncAwbStatus: failed to refresh AWB", {
          awb,
          error: String(error?.message ?? error ?? "unknown"),
        });
        await firestore
          .collection("awbUpdates")
          .doc(awb)
          .collection("errors")
          .doc(new Date().toISOString())
          .set({
            error: String(error?.message ?? error ?? "unknown"),
            capturedAt: fieldValue.serverTimestamp(),
            payload: {
              header: data,
            },
          });
      }
    }

    await metaRef.set(
      {
        name: "last awbStatus sync",
        time: fieldValue.serverTimestamp(),
        updatedCount,
      },
      { merge: true }
    );
  }
);
