import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "./shopCollections.js";

function nowIso() {
  return new Date().toISOString();
}

const INTERNAL_TO_DISPLAY = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "new") return "New";
  if (s === "assigned") return "Assigned";
  if (s === "in_transit" || s === "in transit") return "In Transit";
  if (s === "undelivered") return "Undelivered";
  if (s === "at_destination" || s === "atdestination") return "At Destination";
  if (s === "out_for_delivery" || s === "outfordelivery") return "Out for Delivery";
  if (s === "set_rto" || s === "setrto") return "Set RTO";
  if (s === "delivered") return "Delivered";
  if (s === "rto_accepted") return "RTO Accepted";
  if (s === "rto_in_transit" || s === "rto in transit" || s === "rto_intransit") return "RTO In Transit";
  if (s === "rto_reached_at_destination" || s === "rto reached at destination") return "RTO Reached At Destination";
  if (s === "rto_delivered") return "RTO Delivered";
  if (s === "rto") return "RTO In Transit";
  if (s.includes("deliver")) return "Delivered";
  if (s.includes("out") && s.includes("deliver")) return "Out for Delivery";
  if (s.includes("at") && s.includes("dest")) return "At Destination";
  if (s.includes("undeliver")) return "Undelivered";
  if (s.includes("set") && s.includes("rto")) return "Set RTO";
  if (s.includes("transit") && s.includes("rto")) return "RTO In Transit";
  if (s.includes("transit")) return "In Transit";
  if (s.includes("assign")) return "Assigned";
  if (s.includes("new")) return "New";
  return "";
};

function pickFirstString(...values) {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function canonicalOrderObject(order) {
  const o = order && typeof order === "object" ? order : {};
  const shipping = o.shipping && typeof o.shipping === "object" ? o.shipping : {};
  const orderId = String(o.orderId ?? o.orderName ?? o.name ?? o.order_id ?? o.id ?? "").trim();
  return {
    index: o.index ?? "",
    orderId,
    orderGid: String(o.orderGid ?? o.admin_graphql_api_id ?? "").trim(),
    createdAt: String(o.createdAt ?? o.created_at ?? "").trim(),
    customerEmail: String(o.customerEmail ?? o.email ?? "").trim(),
    financialStatus: String(o.financialStatus ?? o.financial_status ?? "").trim(),
    paymentStatus: String(o.paymentStatus ?? o.financialStatus ?? "").trim(),
    totalPrice: o.totalPrice ?? "",
    invoiceValue: o.invoiceValue ?? o.invoice_value ?? "",
    productDescription: String(o.productDescription ?? o.content_and_quantity ?? "").trim(),
    fulfillmentCenter: String(o.fulfillmentCenter ?? "").trim(),
    fulfillmentStatus: String(o.fulfillmentStatus ?? "").trim(),
    shipping: {
      fullName: String(shipping.fullName ?? "").trim(),
      address1: String(shipping.address1 ?? "").trim(),
      address2: String(shipping.address2 ?? "").trim(),
      city: String(shipping.city ?? "").trim(),
      state: String(shipping.state ?? "").trim(),
      pinCode: String(shipping.pinCode ?? "").trim(),
      phone1: String(shipping.phone1 ?? "").trim(),
      phone2: String(shipping.phone2 ?? "").trim(),
    },
  };
}

function computeCanonicalPatch(data) {
  const d = data && typeof data === "object" ? data : {};
  const order = d.order && typeof d.order === "object" ? d.order : {};
  const shipment = d.shipment && typeof d.shipment === "object" ? d.shipment : {};

  const shipmentStatus = pickFirstString(
    d.shipmentStatus,
    d.shipment_status,
    INTERNAL_TO_DISPLAY(d.shipmentStatus),
    INTERNAL_TO_DISPLAY(shipment.shipmentStatus)
  ) || "";

  const consignmentNumber = pickFirstString(
    d.consignmentNumber,
    d.consignment_number,
    d.trackingNumber,
    d.awbNumber,
    shipment.awbNumber,
    shipment.trackingNumber,
    order.trackingNumber,
    Array.isArray(order.trackingNumbers) ? order.trackingNumbers[0] : "",
    order.trackingNumbersText
  );

  const courierPartner = pickFirstString(
    d.courierPartner,
    d.courier_partner,
    d.trackingCompany,
    order.trackingCompany,
    consignmentNumber ? "DTDC" : ""
  );

  const courierType = pickFirstString(d.courierType, d.courier_type, shipment.courierType);
  const weightKg = pickFirstString(d.weightKg, d.weight, shipment.weightKg);

  const shippingDate = pickFirstString(
    d.shippingDate,
    d.shipping_date,
    shipment.shippingDate,
    shipment.assignedAt,
    d.requestedAt,
    d.updatedAt,
    d.updated_at,
    shipment.updatedAt
  );

  const expectedDeliveryDate = pickFirstString(
    d.expectedDeliveryDate,
    d.expected_delivery_date,
    shipment.expectedDeliveryDate
  );
  const updatedAt = pickFirstString(d.updatedAt, d.updated_at, shipment.updatedAt) || nowIso();

  const patch = {
    shipmentStatus: shipmentStatus || (d.shipmentStatus === undefined ? "" : d.shipmentStatus),
    consignmentNumber,
    courierPartner,
    ...(courierType ? { courierType } : {}),
    ...(weightKg !== "" ? { weightKg } : {}),
    ...(shippingDate ? { shippingDate } : {}),
    ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
    updatedAt,
    order: canonicalOrderObject(order),
  };

  // Remove legacy/duplicate keys via FieldValue.delete() in the caller.
  const deletes = [
    // old/duplicate keys (snake_case + legacy objects)
    "orderKey",
    "shipment_status",
    "consignment_number",
    "courier_partner",
    "courier_type",
    "weight",
    "shipping_date",
    "expected_delivery_date",
    "updated_at",
    "trackingNumber",
    "awbNumber",
    "trackingCompany",
    "shipment",
    "order.orderKey",
    "order.orderName",
    "order.fulfillmentCenterAddress",
    "fulfillmentCenterAddress",
    "order.trackingNumbers",
    "order.trackingNumbersText",
    "order.trackingCompany",
    "order.trackingUrl",
    "order.trackingUrls",
  ];

  return { patch, deletes };
}

function hasLegacyKeys(data) {
  const d = data && typeof data === "object" ? data : {};
  const order = d.order && typeof d.order === "object" ? d.order : {};
  const shipment = d.shipment && typeof d.shipment === "object" ? d.shipment : {};
  return Boolean(
    d.orderKey !== undefined ||
    d.shipment_status !== undefined ||
      d.consignment_number !== undefined ||
      d.courier_partner !== undefined ||
      d.courier_type !== undefined ||
      d.weight !== undefined ||
      d.shipping_date !== undefined ||
      d.expected_delivery_date !== undefined ||
      d.updated_at !== undefined ||
      d.shipmentStatus !== undefined ||
      d.trackingNumber !== undefined ||
      d.awbNumber !== undefined ||
      d.updatedAt !== undefined ||
      shipment.shipmentStatus !== undefined ||
      shipment.trackingNumber !== undefined ||
      shipment.awbNumber !== undefined ||
      shipment.courierType !== undefined ||
      shipment.weightKg !== undefined ||
      order.orderKey !== undefined ||
      order.orderName !== undefined ||
      order.trackingNumbers !== undefined ||
      order.trackingNumbersText !== undefined ||
      order.trackingCompany !== undefined
  );
}

export async function migrateAllOrdersAtStartup({ env, logger }) {
  if (env?.auth?.provider !== "firebase") return;

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";
  let shopDomains = [];
  try {
    const snap = await firestore.collection(shopsCollection).get();
    shopDomains = snap.docs.map((d) => String(d.id ?? "").trim()).filter(Boolean);
  } catch (error) {
    logger?.error?.({ error }, "startup_migration_failed_list_shops");
    return;
  }

  logger?.info?.({ shops: shopDomains.length }, "startup_migration_begin");

  for (const shopDomain of shopDomains) {
    const { collectionId, storeId } = getShopCollectionInfo({ storeId: shopDomain });
    const col = firestore.collection(collectionId);

    let lastId = "";
    let migrated = 0;
    let scanned = 0;

    while (true) {
      let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(200);
      if (lastId) q = q.startAfter(lastId);
      const snap = await q.get();
      if (snap.empty) break;

      const batch = firestore.batch();
      let batchOps = 0;

      for (const doc of snap.docs) {
        scanned += 1;
        lastId = doc.id;
        const data = doc.data() ?? {};
        if (!hasLegacyKeys(data)) continue;

        const { patch, deletes } = computeCanonicalPatch(data);
        const deletePatch = {};
        for (const key of deletes) {
          deletePatch[key] = FieldValue.delete();
        }

        batch.set(
          doc.ref,
          {
            ...patch,
            ...deletePatch,
            docId: String(data?.docId ?? "").trim() || doc.id,
            storeId: String(data?.storeId ?? "").trim() || storeId,
            shopName: String(data?.shopName ?? "").trim(),
          },
          { merge: true }
        );
        batchOps += 1;
        migrated += 1;
        if (batchOps >= 450) break;
      }

      if (batchOps) {
        try {
          await batch.commit();
        } catch (error) {
          logger?.error?.({ error, shopDomain, collectionId }, "startup_migration_batch_failed");
        }
      }

      if (snap.docs.length < 200) break;
    }

    logger?.info?.({ shopDomain, collectionId, scanned, migrated }, "startup_migration_shop_done");
  }

  logger?.info?.({ finishedAt: nowIso() }, "startup_migration_done");
}
