export function resolveShipFrom({ env, storeId }) {
  const storeKey = String(storeId ?? "").trim().toLowerCase();
  const stores = env?.storesConfig?.stores ?? [];
  const toDomainKey = (domain) => {
    const raw = String(domain ?? "").trim().toLowerCase();
    if (!raw) return "";
    const withoutScheme = raw.replace(/^https?:\/\//, "");
    const host = withoutScheme.split("/")[0] ?? "";
    return host.endsWith(".myshopify.com") ? host.slice(0, -".myshopify.com".length) : host;
  };

  const store = storeKey
    ? stores.find((s) => {
        const id = String(s?.id ?? "").trim().toLowerCase();
        const domain = String(s?.domain ?? "").trim().toLowerCase();
        const domainKey = toDomainKey(domain);
        return storeKey === id || storeKey === domain || storeKey === domainKey;
      })
    : null;

  const candidate = store?.shipFrom ?? env?.shipFrom ?? null;
  const fallbackName =
    String(store?.name ?? "").trim() ||
    String(store?.id ?? "").trim() ||
    "Haul Riders";

  return {
    name: String(candidate?.name ?? "").trim() || fallbackName,
    address1: String(candidate?.address1 ?? "").trim(),
    address2: String(candidate?.address2 ?? "").trim(),
    city: String(candidate?.city ?? "").trim(),
    state: String(candidate?.state ?? "").trim(),
    pinCode: String(candidate?.pinCode ?? "").trim(),
    country: String(candidate?.country ?? "IN").trim() || "IN",
    phone: String(candidate?.phone ?? "").trim(),
  };
}
