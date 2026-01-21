const normalizeWhitespace = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizeDomain = (domain) => String(domain ?? "").trim().toLowerCase();

const toDomainKey = (domain) => {
  const d = normalizeDomain(domain);
  if (!d) return "";
  const withoutScheme = d.replace(/^https?:\/\//, "");
  const host = withoutScheme.split("/")[0] ?? "";
  return host.endsWith(".myshopify.com") ? host.slice(0, -".myshopify.com".length) : host;
};

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

  // If `storeId` is an internal id (e.g. `64dd6e-2`) we still want the Firestore
  // collection id to be the shopDomain key (e.g. `abc`).
  const storeKey = store ? toDomainKey(store.domain) || id : id;

  const displayName = normalizeWhitespace(store?.name || storeKey || "Shop");
  const collectionId = toFirestoreCollectionId(storeKey || displayName);
  return { collectionId, displayName, storeId: storeKey };
}
