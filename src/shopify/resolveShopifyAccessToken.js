import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";

const normalizeDomain = (domain) => String(domain ?? "").trim().toLowerCase();

const tokenCache = new Map();
const CACHE_TTL_MS = 60_000;

async function readAccessTokenFromShopsDoc({ firestore, shopsCollection, shopDomain }) {
  const docRef = firestore.collection(shopsCollection).doc(shopDomain);
  const snap = await docRef.get();
  if (!snap.exists) return "";
  const data = snap.data() ?? {};

  // Expected structure:
  // shops/<shopDomain> { shopify: { accessToken: "..." } }
  const shopify = data.shopify && typeof data.shopify === "object" ? data.shopify : null;
  const token = shopify ? shopify.accessToken : "";
  return String(token ?? "").trim();
}

export async function resolveShopifyAccessToken({ env, shopDomain }) {
  const domain = normalizeDomain(shopDomain);
  if (!domain) return "";

  const cached = tokenCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  if (env?.auth?.provider !== "firebase") return "";

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

  const token = await readAccessTokenFromShopsDoc({
    firestore,
    shopsCollection,
    shopDomain: domain,
  });

  tokenCache.set(domain, { token, expiresAt: Date.now() + CACHE_TTL_MS });
  return token;
}
