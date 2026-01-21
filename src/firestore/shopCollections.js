const normalizeWhitespace = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

export function toFirestoreCollectionId(value) {
  const raw = normalizeWhitespace(value).toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  return cleaned || "shop";
}

export function getShopCollectionInfo({ env, storeId }) {
  const id = String(storeId ?? "").trim().toLowerCase();
  const stores = env?.storesConfig?.stores ?? [];
  const store = id ? stores.find((s) => String(s?.id ?? "").trim().toLowerCase() === id) : null;

  const displayName = normalizeWhitespace(store?.name || id || "Shop");
  const collectionId = toFirestoreCollectionId(displayName);
  return { collectionId, displayName, storeId: id };
}

