function getPrimaryFromCommaList(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const first = raw.split(",")[0] ?? "";
  return String(first).trim();
}

export function extractAwbNumber({ firestoreDoc }) {
  const data = firestoreDoc && typeof firestoreDoc === "object" ? firestoreDoc : {};
  const order = data.order && typeof data.order === "object" ? data.order : null;

  const candidates = [
    data?.shipment?.awbNumber,
    data?.shipment?.trackingNumber,
    data?.awbNumber,
    data?.trackingNumber,
    order?.awbNumber,
    order?.trackingNumber,
    Array.isArray(order?.trackingNumbers) ? order.trackingNumbers[0] : "",
    getPrimaryFromCommaList(order?.trackingNumbersText),
  ];

  for (const c of candidates) {
    const s = getPrimaryFromCommaList(c);
    if (s) return s;
  }
  return "";
}

