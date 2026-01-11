import fs from "node:fs/promises";

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const normalizeStoreId = (id) => String(id ?? "").trim().toLowerCase();

export async function loadStoresConfig({ filePath }) {
  if (!isNonEmptyString(filePath)) return null;

  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  const stores = Array.isArray(parsed?.stores) ? parsed.stores : [];
  const normalizedStores = stores.map((s) => {
    const id = normalizeStoreId(s?.id);
    const name = String(s?.name ?? "").trim();
    const domain = String(s?.domain ?? "").trim();
    const apiVersion = String(s?.apiVersion ?? "2025-10").trim();
    const token = isNonEmptyString(s?.token) ? String(s.token).trim() : "";
    const tokenEnvVar = isNonEmptyString(s?.tokenEnvVar)
      ? String(s.tokenEnvVar).trim()
      : "";

    if (!id) throw new Error("stores.json: each store requires a non-empty `id`");
    if (!domain)
      throw new Error(`stores.json: store '${id}' requires a non-empty \`domain\``);
    if (!apiVersion)
      throw new Error(
        `stores.json: store '${id}' requires a non-empty \`apiVersion\``
      );

    return { id, name: name || id, domain, apiVersion, token, tokenEnvVar };
  });

  const seen = new Set();
  for (const s of normalizedStores) {
    if (seen.has(s.id)) throw new Error(`stores.json: duplicate store id '${s.id}'`);
    seen.add(s.id);
  }

  const defaultStoreIdRaw = parsed?.defaultStoreId;
  const defaultStoreId = normalizeStoreId(defaultStoreIdRaw);
  const effectiveDefaultStoreId =
    defaultStoreId && seen.has(defaultStoreId)
      ? defaultStoreId
      : normalizedStores[0]?.id ?? "";

  if (!effectiveDefaultStoreId) {
    throw new Error("stores.json: must contain at least one store");
  }

  return {
    defaultStoreId: effectiveDefaultStoreId,
    stores: normalizedStores,
  };
}

export function resolveStore({ storesConfig, storeId, env }) {
  if (!storesConfig) return null;
  const id = normalizeStoreId(storeId) || storesConfig.defaultStoreId;
  const store = storesConfig.stores.find((s) => s.id === id);
  if (!store) return null;

  const token =
    store.token ||
    (store.tokenEnvVar ? String(env?.[store.tokenEnvVar] ?? "").trim() : "");

  return {
    id: store.id,
    name: store.name,
    domain: store.domain,
    apiVersion: store.apiVersion,
    token,
  };
}

