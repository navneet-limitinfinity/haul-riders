import { parseCookies } from "./cookies.js";
import { ROLE_ADMIN, ROLE_SHOP, normalizeRole } from "./roles.js";
import { getFirebaseAdmin } from "./firebaseAdmin.js";

const BEARER_PREFIX = "bearer ";
const SESSION_COOKIE = "haul_session";

function getBearerToken(req) {
  const header = String(req.get?.("authorization") ?? "");
  const lower = header.toLowerCase();
  if (!lower.startsWith(BEARER_PREFIX)) return "";
  return header.slice(BEARER_PREFIX.length).trim();
}

function wantsHtml(req) {
  try {
    return Boolean(req.accepts?.("html"));
  } catch {
    return false;
  }
}

function sendUnauthorized(req, res, { code = "unauthorized" } = {}) {
  if (wantsHtml(req) && req.method === "GET") {
    res.redirect(302, "/login");
    return;
  }
  res.status(401).json({ error: code });
}

function sendForbidden(req, res, { code = "forbidden" } = {}) {
  if (wantsHtml(req) && req.method === "GET") {
    res.status(403).send("Forbidden");
    return;
  }
  res.status(403).json({ error: code });
}

async function resolveUserFromFirebase({ env, logger, req }) {
  const token = getBearerToken(req);
  const cookies = parseCookies(req.headers?.cookie);
  const sessionCookie = String(cookies?.[SESSION_COOKIE] ?? "").trim();

  if (!token && !sessionCookie) return null;

  const admin = await getFirebaseAdmin({ env });

  let decoded = null;
  if (token) {
    decoded = await admin.auth().verifyIdToken(token);
  } else {
    decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
  }

  const uid = String(decoded?.uid ?? "").trim();
  if (!uid) return null;

  const email = String(decoded?.email ?? "").trim().toLowerCase();
  const firestore = admin.firestore();

  const toStoreIdFromShopDomain = (domain) => {
    const raw = String(domain ?? "").trim().toLowerCase();
    if (!raw) return "";
    const withoutScheme = raw.replace(/^https?:\/\//, "");
    const host = withoutScheme.split("/")[0] ?? "";
    return host.endsWith(".myshopify.com") ? host.slice(0, -".myshopify.com".length) : host;
  };

  // Shop accounts are resolved from `shops` where `shop_admin == <email>`.
  // The shop's Firestore collection is derived from `shopDomain`.
  if (email) {
    try {
      const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";
      const snap = await firestore
        .collection(shopsCollection)
        .where("shop_admin", "==", email)
        .limit(1)
        .get();
      const doc = snap?.docs?.[0] ?? null;
      const shop = doc?.exists ? doc.data() : null;
      const shopDomain = String(shop?.shopDomain ?? "").trim().toLowerCase();
      const storeIdFromDomain = toStoreIdFromShopDomain(shopDomain);
      if (storeIdFromDomain) {
        return {
          provider: "firebase",
          uid,
          email,
          role: ROLE_SHOP,
          storeId: storeIdFromDomain,
          claims: decoded ?? {},
        };
      }
    } catch (error) {
      logger?.warn?.({ error }, "Failed to resolve shop account from Firestore");
    }
  }

  // Fallback: admin accounts (and any legacy users) resolved from `users/<uid>`.
  let profile = null;
  try {
    const snap = await firestore.collection(env.auth.firebase.usersCollection).doc(uid).get();
    profile = snap?.exists ? snap.data() : null;
  } catch (error) {
    logger?.warn?.({ error }, "Failed to fetch user profile from Firestore");
  }

  const role = normalizeRole(profile?.role ?? decoded?.role);
  const storeId = String(profile?.storeId ?? "").trim().toLowerCase();

  return {
    provider: "firebase",
    uid,
    email,
    role: role || "",
    storeId,
    claims: decoded ?? {},
  };
}

function resolveUserFromDev({ env }) {
  return {
    provider: "dev",
    uid: "dev",
    email: "",
    role: env.auth.dev.role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_SHOP,
    storeId: String(env.auth.dev.storeId ?? "").trim(),
    claims: {},
  };
}

export function createAuth({ env, logger }) {
  const attachUser = async (req, _res, next) => {
    try {
      if (env.auth.provider === "none") {
        req.user = null;
        next();
        return;
      }

      if (env.auth.provider === "dev") {
        req.user = resolveUserFromDev({ env });
        next();
        return;
      }

      if (env.auth.provider === "firebase") {
        req.user = await resolveUserFromFirebase({ env, logger, req });
        next();
        return;
      }

      req.user = null;
      next();
    } catch (error) {
      next(error);
    }
  };

  const requireAuth = (req, res, next) => {
    if (!env.auth.required) return next();
    if (req.user) return next();
    sendUnauthorized(req, res);
  };

  const requireRole = (role) => (req, res, next) => {
    if (!env.auth.required) return next();
    if (!req.user) return sendUnauthorized(req, res);
    if (req.user.role === role) return next();
    sendForbidden(req, res, { code: "insufficient_role" });
  };

  const requireAnyRole = (roles) => (req, res, next) => {
    if (!env.auth.required) return next();
    if (!req.user) return sendUnauthorized(req, res);
    const allowed = new Set(Array.isArray(roles) ? roles : []);
    if (allowed.has(req.user.role)) return next();
    sendForbidden(req, res, { code: "insufficient_role" });
  };

  return {
    attachUser,
    requireAuth,
    requireRole,
    requireAnyRole,
  };
}
