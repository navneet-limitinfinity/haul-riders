const getBestShippingAddress = (order) => {
  return order?.shipping_address ?? order?.customer?.default_address ?? null;
};

const getFirstFulfillment = (order) => {
  const fulfillments = order?.fulfillments;
  if (!Array.isArray(fulfillments) || fulfillments.length === 0) return null;
  return fulfillments[0];
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

export const projectOrderRow = ({ order, index }) => {
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

  const trackingNumbers = uniqueStrings([
    ...(Array.isArray(firstFulfillment?.tracking_numbers)
      ? firstFulfillment.tracking_numbers
      : []),
    firstFulfillment?.tracking_number,
  ]);
  const trackingNumbersText = trackingNumbers.join(", ");

  const primaryTrackingNumber = trackingNumbers[0] ?? "";
  const trackingCompany =
    firstFulfillment?.tracking_company ?? (primaryTrackingNumber ? "DTDC" : "");
  const trackingUrls = uniqueStrings([buildDtdcTrackingUrl(primaryTrackingNumber)]);
  const trackingUrl = trackingUrls[0] ?? "";
  const orderGid = order?.admin_graphql_api_id ?? "";
  const orderKey = orderGid || (order?.id == null ? "" : String(order.id));

  return {
    index: index + 1,
    orderName: order?.name,
    orderId: order?.id == null ? "" : String(order.id),
    orderKey,
    orderGid,
    shipping,
    totalPrice: order?.total_price,
    fulfillmentStatus: order?.fulfillment_status,
    trackingNumbers,
    trackingNumbersText,
    trackingCompany,
    trackingUrls,
    trackingUrl,
  };
};
