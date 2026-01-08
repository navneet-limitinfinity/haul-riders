const getBestShippingAddress = (order) => {
  return order?.shipping_address ?? order?.customer?.default_address ?? null;
};

const getFirstFulfillment = (order) => {
  const fulfillments = order?.fulfillments;
  if (!Array.isArray(fulfillments) || fulfillments.length === 0) return null;
  return fulfillments[0];
};

export const projectOrderRow = ({ order, index }) => {
  const shippingAddress = getBestShippingAddress(order);
  const firstFulfillment = getFirstFulfillment(order);

  const formattedShippingAddress = {
    name: shippingAddress?.name ?? "",
    phone: shippingAddress?.phone ?? "",
    address2: shippingAddress?.address2 ?? "",
    address1: shippingAddress?.address1 ?? "",
    city: shippingAddress?.city ?? "",
    zip: shippingAddress?.zip ?? "",
    province: shippingAddress?.province ?? "",
    country: shippingAddress?.country ?? "",
  };

  const trackingNumbers = Array.isArray(firstFulfillment?.tracking_numbers)
    ? firstFulfillment.tracking_numbers
    : [];
  const trackingNumber =
    firstFulfillment?.tracking_number ?? trackingNumbers[0] ?? null;

  const trackingCompany = firstFulfillment?.tracking_company ?? "";

  return {
    index: index + 1,
    orderName: order?.name,
    orderId: order?.id,
    shippingAddress: formattedShippingAddress,
    totalPrice: order?.total_price,
    fulfillmentStatus: order?.fulfillment_status,
    trackingNumber,
    trackingNumbers,
    trackingCompany,
    phone: formattedShippingAddress.phone || order?.phone || "",
  };
};
