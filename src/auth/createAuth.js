import { parseCookies } from "./cookies.js";
import { ROLE_ADMIN, ROLE_SHOP, normalizeRole } from "./roles.js";
import { getFirebaseAdmin } from "./firebaseAdmin.js";

const BEARER_PREFIX = "bearer ";
const SESSION_COOKIE = "haul_session";

function toShopDomainKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const withoutScheme = raw.replace(/^https?:\/\//, "");
  const host = withoutScheme.split("/")[0] ?? "";
  return host.endsWith(".myshopify.com") ? host.slice(0, -".myshopify.com".length) : host;
}

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

  // Primary source of truth: `users/<uid>` with `role: "admin" | "shop"`.
  let profile = null;
  try {
    const snap = await firestore.collection(env.auth.firebase.usersCollection).doc(uid).get();
    profile = snap?.exists ? snap.data() : null;
  } catch (error) {
    logger?.warn?.({ error }, "Failed to fetch user profile from Firestore");
  }

  const role = normalizeRole(profile?.role ?? decoded?.role);

  // Admin users: go straight to admin dashboard (no store required).
  if (role === ROLE_ADMIN) {
    return {
      provider: "firebase",
      uid,
      email,
      role: ROLE_ADMIN,
      storeId: "",
      claims: decoded ?? {},
    };
  }

  // Shop users: use users/<uid>.storeId (full shop domain like `abc.myshopify.com`).
  const profileStoreId = String(profile?.storeId ?? "").trim().toLowerCase();
  const tokenStoreId = String(decoded?.storeId ?? decoded?.shopDomain ?? decoded?.shop ?? "")
    .trim()
    .toLowerCase();
  // Always prefer Firestore profile storeId (source of truth); fall back to token only if missing.
  const storeId = profileStoreId || tokenStoreId;
  const storeKey = toShopDomainKey(storeId);

  return {
    provider: "firebase",
    uid,
    email,
    role: role || "",
    storeId,
    storeKey,
    claims: decoded ?? {},
  };
}

function resolveUserFromDev({ env }) {
  const storeId = String(env.auth.dev.storeId ?? "").trim();
  return {
    provider: "dev",
    uid: "dev",
    email: "",
    role: env.auth.dev.role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_SHOP,
    storeId,
    storeKey: toShopDomainKey(storeId),
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
        try {
          req.user = await resolveUserFromFirebase({ env, logger, req });
        } catch (error) {
          // Treat auth failures as unauthenticated, not as a server error.
          // This avoids breaking all routes when Firebase is temporarily unavailable or misconfigured.
          logger?.warn?.({ error }, "Failed to resolve user from Firebase");
          req.user = null;
        }
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
