import crypto from "node:crypto";
import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ensureStoreIdForShop } from "../firestore/storeIdGenerator.js";

const STATE_COOKIE = "shopify_oauth_state";

const normalizeShopDomain = (shop) =>
  String(shop ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*/, "");

const timingSafeEqualHex = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const computeShopifyHmac = ({ queryParams, secret }) => {
  const params = new URLSearchParams(queryParams);
  params.delete("hmac");
  params.delete("signature");

  const keys = Array.from(params.keys()).sort();
  const message = keys.map((key) => `${key}=${params.get(key) ?? ""}`).join("&");
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
};

const findMatchingSecret = ({ queryParams, secrets }) => {
  const params = new URLSearchParams(queryParams);
  const hmac = params.get("hmac") ?? "";
  if (!hmac) return "";

  for (const secret of secrets) {
    const digest = computeShopifyHmac({ queryParams, secret });
    if (timingSafeEqualHex(digest, hmac)) return secret;
  }
  return "";
};

async function exchangeCodeForToken({ shop, apiKey, apiSecret, code }) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `Non-JSON response from Shopify (HTTP ${response.status}): ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} exchanging token: ${JSON.stringify(payload, null, 2)}`
    );
  }

  const token = String(payload?.access_token ?? "").trim();
  if (!token) {
    throw new Error(`No access_token in response: ${JSON.stringify(payload, null, 2)}`);
  }

  return token;
}

function getOAuthConfig({ env }) {
  const apiKey = String(env?.shopify?.oauth?.apiKey ?? "").trim();
  const secrets = Array.isArray(env?.shopify?.oauth?.apiSecrets)
    ? env.shopify.oauth.apiSecrets
    : [];
  const scopes = String(env?.shopify?.oauth?.scopes ?? "read_orders").trim() || "read_orders";
  const redirectUri = String(env?.shopify?.oauth?.redirectUri ?? "").trim();
  return { apiKey, secrets, scopes, redirectUri };
}

function getCallbackUrl({ req, configuredRedirectUri }) {
  if (configuredRedirectUri) return configuredRedirectUri;
  return `${req.protocol}://${req.get("host")}/oauth/callback`;
}

function getCookieOptions(req) {
  return {
    httpOnly: true,
    secure: Boolean(req.secure),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  };
}

export function createShopifyOAuthRouter({ env, logger }) {
  const router = Router();

  // Start Shopify OAuth (redirects to Shopify install screen).
  // Example:
  //   GET /oauth/install?shop=64dd6e-2.myshopify.com
  router.get("/oauth/install", (req, res) => {
    const { apiKey, secrets, scopes, redirectUri } = getOAuthConfig({ env });
    if (!apiKey || secrets.length === 0) {
      res.status(500).json({ error: "shopify_oauth_not_configured" });
      return;
    }

    const shop = normalizeShopDomain(req.query?.shop);
    if (!shop || !shop.endsWith(".myshopify.com")) {
      res.status(400).json({ error: "invalid_shop_domain" });
      return;
    }

    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE, state, getCookieOptions(req));

    const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", apiKey);
    authorizeUrl.searchParams.set("scope", scopes);
    authorizeUrl.searchParams.set("redirect_uri", getCallbackUrl({ req, configuredRedirectUri: redirectUri }));
    authorizeUrl.searchParams.set("state", state);

    res.redirect(302, authorizeUrl.toString());
  });

  // Shopify OAuth callback (exchanges code for token and stores it).
  router.get("/oauth/callback", async (req, res, next) => {
    try {
      const { apiKey, secrets, scopes, redirectUri } = getOAuthConfig({ env });
      if (!apiKey || secrets.length === 0) {
        res.status(500).send("Shopify OAuth not configured on server.");
        return;
      }

      const reqUrl = new URL(req.originalUrl ?? req.url ?? "", "http://localhost");

      const shop = normalizeShopDomain(req.query?.shop);
      if (!shop || !shop.endsWith(".myshopify.com")) {
        res.status(400).send("Invalid shop domain.");
        return;
      }

      const state = String(req.query?.state ?? "").trim();
      const cookies = String(req.headers?.cookie ?? "");
      const match = cookies.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`));
      const expectedState = match ? decodeURIComponent(match[1]) : "";
      if (!state || !expectedState || state !== expectedState) {
        res.status(400).send("Invalid state (possible CSRF).");
        return;
      }

      const matchingSecret = findMatchingSecret({
        queryParams: reqUrl.searchParams,
        secrets,
      });
      if (!matchingSecret) {
        res.status(400).send("HMAC verification failed.");
        return;
      }

      const code = String(req.query?.code ?? "").trim();
      if (!code) {
        res.status(400).send("Missing code.");
        return;
      }

      const token = await exchangeCodeForToken({
        shop,
        apiKey,
        apiSecret: matchingSecret,
        code,
      });

      // Store token in Firestore so the main app can use it (resolveShopifyAccessToken()).
      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const shopsCollection = String(env?.auth?.firebase?.shopsCollection ?? "shops").trim() || "shops";
      const nowIso = new Date().toISOString();
      const normalizedShopDomain = normalizeShopDomain(shop);
      const storeIdValue = await ensureStoreIdForShop({
        firestore,
        shopsCollection,
        shopDomain: normalizedShopDomain,
        referenceDate: new Date(),
      });

      const shopDoc = firestore.collection(shopsCollection).doc(storeIdValue);
      await shopDoc.set(
        {
          storeId: storeIdValue,
          shopDomain: normalizedShopDomain,
          accessToken: token,
          shopifyAccessToken: token,
          shopify: {
            accessToken: token,
          },
          scopes,
          apiVersion: env?.shopify?.apiVersion ?? "2025-10",
          installedAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Also write into a predictable subcollection doc (preferred by resolveShopifyAccessToken()).
      await shopDoc
        .collection("shopify")
        .doc("config")
        .set(
          {
            accessToken: token,
            scopes,
            apiVersion: env?.shopify?.apiVersion ?? "2025-10",
            redirectUri: getCallbackUrl({ req, configuredRedirectUri: redirectUri }),
            updatedAt: nowIso,
          },
          { merge: true }
        );

      res.clearCookie(STATE_COOKIE, { path: "/" });
      res.setHeader("Cache-Control", "no-store");
      res
        .status(200)
        .send(
          `Installed for ${shop}. Token stored in Firestore collection "${shopsCollection}" (doc id: ${storeIdValue}).`
        );
    } catch (error) {
      logger?.error?.({ error }, "Shopify OAuth callback failed");
      next(error);
    }
  });

  return router;
}
