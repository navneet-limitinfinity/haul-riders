function getPrimaryFromCommaList(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const first = raw.split(",")[0] ?? "";
  return String(first).trim();
}

export function extractAwbNumber({ firestoreDoc }) {
  const data = firestoreDoc && typeof firestoreDoc === "object" ? firestoreDoc : {};
  return getPrimaryFromCommaList(data?.consignmentNumber ?? data?.consignment_number);
}
