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

export function getShopCollectionInfo({ storeId }) {
  const id = String(storeId ?? "").trim().toLowerCase();
  // Firestore collection id should be the shop domain key (e.g. `abc`) derived from:
  // - users/<uid>.storeId (full domain: `abc.myshopify.com`)
  // - query params for admin (full domain)
  const looksLikeDomain = id.includes(".");
  const storeKey = looksLikeDomain ? toDomainKey(id) : id;

  const displayName = normalizeWhitespace(storeKey || "Shop");
  const collectionId = toFirestoreCollectionId(storeKey || displayName);
  return { collectionId, displayName, storeId: storeKey };
}
