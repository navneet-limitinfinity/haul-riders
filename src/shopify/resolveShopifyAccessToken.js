import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { loadStoreDoc } from "../firestore/storeDocs.js";

const CACHE_TTL_MS = 60_000;
const tokenCache = new Map();

const normalizeValue = (value) => String(value ?? "").trim().toLowerCase();

async function readAccessTokenFromDoc({ doc }) {
  if (!doc?.exists) return "";
  const data = doc.data() ?? {};
  const shopify = data.shopify && typeof data.shopify === "object" ? data.shopify : null;
  const direct = String(data.accessToken ?? "").trim();
  const legacy = String(data.shopifyAccessToken ?? "").trim();
  const nested = String(shopify?.accessToken ?? "").trim();
  if (nested) return nested;
  if (direct) return direct;
  if (legacy) return legacy;

  try {
    const configSnap = await doc.ref.collection("shopify").doc("config").get();
    if (!configSnap.exists) return "";
    const config = configSnap.data() ?? {};
    return String(config?.accessToken ?? "").trim();
  } catch {
    return "";
  }
}

export async function resolveShopifyAccessToken({ env, storeId, shopDomain }) {
  const identifier = normalizeValue(storeId ?? shopDomain ?? "");
  if (!identifier) return "";

  const cached = tokenCache.get(identifier);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  if (env?.auth?.provider !== "firebase") return "";

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();

  const doc = await loadStoreDoc({ env, firestore, storeId: identifier });
  const token = await readAccessTokenFromDoc({ doc });

  tokenCache.set(identifier, { token, expiresAt: Date.now() + CACHE_TTL_MS });
  return token;
}
