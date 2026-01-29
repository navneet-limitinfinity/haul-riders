const getBestShippingAddress = (order) => {
  return order?.shipping_address ?? order?.customer?.default_address ?? null;
};

const getFirstFulfillment = (order) => {
  const fulfillments = order?.fulfillments;
  if (!Array.isArray(fulfillments) || fulfillments.length === 0) return null;
  return fulfillments[0];
};

const buildProductDescription = (order) => {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  const parts = [];
  for (const item of items) {
    const title = String(item?.title ?? "").trim();
    if (!title) continue;
    const qtyRaw = item?.quantity;
    const qty =
      qtyRaw == null ? null : Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null;
    parts.push(qty && qty > 1 ? `${title} x${qty}` : title);
  }
  if (parts.length === 0) return "";
  return parts.join(", ");
};

const resolveFulfillmentCenter = (order, firstFulfillment) => {
  const locationId = firstFulfillment?.location_id ?? order?.location_id ?? "";
  const locationName = firstFulfillment?.location?.name ?? "";
  return String(locationName || locationId || "").trim();
};

const uniqueStrings = (values) => {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const normalizePhone10 = (value) => {
  const digits = String(value ?? "").replaceAll(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 10) return "";
  return digits.slice(-10);
};

const buildDtdcTrackingUrl = (trackingNumber) => {
  const tn = String(trackingNumber ?? "").trim();
  if (!tn) return "";
  return `https://txk.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCITrackingDetails&cType=Consignment&cnNo=${encodeURIComponent(
    tn
  )}`;
};

export const projectOrderRow = ({ order, index, overrides = null }) => {
  const shippingAddress = getBestShippingAddress(order);
  const firstFulfillment = getFirstFulfillment(order);

  const phoneNumbers = uniqueStrings([
    normalizePhone10(shippingAddress?.phone),
    normalizePhone10(order?.phone ? String(order.phone) : ""),
  ]);
  const phone1 = phoneNumbers[0] ?? "";
  const phone2 = phoneNumbers[1] ?? "";

  const shipping = {
    fullName: shippingAddress?.name ?? "",
    address1: shippingAddress?.address1 ?? "",
    address2: shippingAddress?.address2 ?? "",
    city: shippingAddress?.city ?? "",
    state: shippingAddress?.province ?? "",
    pinCode: shippingAddress?.zip ?? "",
    phoneNumbers,
    phone1,
    phone2,
    phoneNumbersText: phoneNumbers.join(", "),
  };

  const overrideTrackingNumber = String(overrides?.trackingNumber ?? "").trim();
  const trackingNumbers = uniqueStrings(
    overrideTrackingNumber
      ? [overrideTrackingNumber]
      : [
          ...(Array.isArray(firstFulfillment?.tracking_numbers)
            ? firstFulfillment.tracking_numbers
            : []),
          firstFulfillment?.tracking_number,
        ]
  );
  const trackingNumbersText = trackingNumbers.join(", ");

  const primaryTrackingNumber = trackingNumbers[0] ?? "";
  const trackingCompany =
    firstFulfillment?.tracking_company ?? (primaryTrackingNumber ? "DTDC" : "");
  const trackingUrls = uniqueStrings([buildDtdcTrackingUrl(primaryTrackingNumber)]);
  const trackingUrl = trackingUrls[0] ?? "";
  const orderGid = order?.admin_graphql_api_id ?? "";
  const orderKey = orderGid || (order?.id == null ? "" : String(order.id));
  const shipmentStatus = String(
    overrides?.shipmentStatus ??
      firstFulfillment?.status ??
      order?.fulfillment_status ??
      ""
  ).trim();

  const customerEmail = String(order?.email ?? order?.customer?.email ?? "").trim();
  const productDescription = buildProductDescription(order);
  const fulfillmentCenter = resolveFulfillmentCenter(order, firstFulfillment);
  const invoiceValue = order?.total_price ?? "";
  const paymentStatus = order?.financial_status ?? "";

  return {
    index: index + 1,
    orderName: order?.name,
    orderId: order?.id == null ? "" : String(order.id),
    orderKey,
    orderGid,
    createdAt: order?.created_at ?? "",
    customerEmail,
    financialStatus: order?.financial_status ?? "",
    shipping,
    totalPrice: order?.total_price,
    invoiceValue,
    paymentStatus,
    productDescription,
    fulfillmentCenter,
    fulfillmentStatus: order?.fulfillment_status,
    trackingNumbers,
    trackingNumbersText,
    trackingCompany,
    trackingUrls,
    trackingUrl,
    shipmentStatus,
  };
};
