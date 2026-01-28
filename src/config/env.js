/**
 * Loads and validates environment variables.
 * Keep all env var parsing in one place so deployment is predictable.
 */
export function loadEnv(rawEnv) {
  const port = parseInt(rawEnv.PORT ?? "3000", 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  const host = rawEnv.HOST ?? "0.0.0.0";
  const logLevel = rawEnv.LOG_LEVEL ?? "info";
  const allowedLogLevels = new Set(["debug", "info", "warn", "error"]);
  if (!allowedLogLevels.has(logLevel)) {
    throw new Error("LOG_LEVEL must be one of: debug, info, warn, error");
  }

  const trustProxyRaw = (rawEnv.TRUST_PROXY ?? "false").toLowerCase().trim();
  const trustProxy =
    trustProxyRaw === "true" || trustProxyRaw === "1" || trustProxyRaw === "yes";

  const shopifyStore = rawEnv.SHOPIFY_STORE ?? "";
  const shopifyToken = rawEnv.SHOPIFY_TOKEN ?? "";
  const shopifyApiVersion = rawEnv.SHOPIFY_API_VERSION ?? "2025-10";
  const shopifyTimeoutMs = parseInt(rawEnv.SHOPIFY_TIMEOUT_MS ?? "10000", 10);
  if (Number.isNaN(shopifyTimeoutMs) || shopifyTimeoutMs <= 0) {
    throw new Error("SHOPIFY_TIMEOUT_MS must be a positive integer");
  }

  const shopifyMaxRetries = parseInt(rawEnv.SHOPIFY_MAX_RETRIES ?? "2", 10);
  if (
    Number.isNaN(shopifyMaxRetries) ||
    shopifyMaxRetries < 0 ||
    shopifyMaxRetries > 5
  ) {
    throw new Error("SHOPIFY_MAX_RETRIES must be an integer between 0 and 5");
  }
  const adminName = String(rawEnv.ADMIN_NAME ?? "Haul Riders Admin").trim() || "Haul Riders Admin";
  const shipmentsStateFile = String(
    rawEnv.SHIPMENTS_STATE_FILE ?? "./shipments_state.json"
  ).trim();

  const authProvider = String(rawEnv.AUTH_PROVIDER ?? "dev").trim().toLowerCase();
  const allowedAuthProviders = new Set(["none", "dev", "firebase"]);
  if (!allowedAuthProviders.has(authProvider)) {
    throw new Error("AUTH_PROVIDER must be one of: none, dev, firebase");
  }

  const authRequiredRaw = String(rawEnv.AUTH_REQUIRED ?? "true").trim().toLowerCase();
  const authRequired = authRequiredRaw === "true" || authRequiredRaw === "1" || authRequiredRaw === "yes";

  const devAuthRoleRaw = String(rawEnv.DEV_AUTH_ROLE ?? "shop").trim().toLowerCase();
  const devAuthRole = devAuthRoleRaw === "admin" ? "admin" : "shop";
  const devAuthStoreId = String(rawEnv.DEV_AUTH_STORE_ID ?? "").trim();

  const firebaseAdminCredentialsJson = String(rawEnv.FIREBASE_ADMIN_CREDENTIALS_JSON ?? "").trim();
  const firebaseAdminCredentialsFile = String(rawEnv.FIREBASE_ADMIN_CREDENTIALS_FILE ?? "").trim();
  const firebaseProjectId = String(rawEnv.FIREBASE_PROJECT_ID ?? "").trim();
  const firebaseClientEmail = String(rawEnv.FIREBASE_CLIENT_EMAIL ?? "").trim();
  const firebasePrivateKey = String(rawEnv.FIREBASE_PRIVATE_KEY ?? "")
    .replaceAll("\\n", "\n")
    .trim();

  const firebaseWebConfigJson = String(rawEnv.FIREBASE_WEB_CONFIG_JSON ?? "").trim();
  const firebaseUsersCollection = String(rawEnv.FIREBASE_USERS_COLLECTION ?? "users").trim() || "users";
  const firebaseShopsCollection = String(rawEnv.FIREBASE_SHOPS_COLLECTION ?? "shops").trim() || "shops";

  const shopifyOauthApiKey = String(rawEnv.SHOPIFY_OAUTH_API_KEY ?? "").trim();
  const shopifyOauthApiSecretRaw = String(rawEnv.SHOPIFY_OAUTH_API_SECRET ?? "").trim();
  const shopifyOauthApiSecrets = shopifyOauthApiSecretRaw
    ? shopifyOauthApiSecretRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const shopifyOauthScopes = String(rawEnv.SHOPIFY_OAUTH_SCOPES ?? "read_orders").trim() || "read_orders";
  const shopifyOauthRedirectUri = String(rawEnv.SHOPIFY_OAUTH_REDIRECT_URI ?? "").trim();

  const shipFrom = {
    name: String(rawEnv.SHIP_FROM_NAME ?? "").trim(),
    address1: String(rawEnv.SHIP_FROM_ADDRESS1 ?? "").trim(),
    address2: String(rawEnv.SHIP_FROM_ADDRESS2 ?? "").trim(),
    city: String(rawEnv.SHIP_FROM_CITY ?? "").trim(),
    state: String(rawEnv.SHIP_FROM_STATE ?? "").trim(),
    pinCode: String(rawEnv.SHIP_FROM_PIN ?? "").trim(),
    country: String(rawEnv.SHIP_FROM_COUNTRY ?? "IN").trim(),
    phone: String(rawEnv.SHIP_FROM_PHONE ?? "").trim(),
  };

  const shipLabelLogoUrl = String(rawEnv.SHIP_LABEL_LOGO_URL ?? "").trim();

  return {
    port,
    host,
    logLevel,
    trustProxy,
    adminName,
    shipmentsStateFile,
    auth: {
      provider: authProvider,
      required: authRequired,
      dev: {
        role: devAuthRole,
        storeId: devAuthStoreId,
      },
      firebase: {
        adminCredentialsJson: firebaseAdminCredentialsJson,
        adminCredentialsFile: firebaseAdminCredentialsFile,
        projectId: firebaseProjectId,
        clientEmail: firebaseClientEmail,
        privateKey: firebasePrivateKey,
        webConfigJson: firebaseWebConfigJson,
        usersCollection: firebaseUsersCollection,
        shopsCollection: firebaseShopsCollection,
      },
    },
    shopify: {
      storeDomain: shopifyStore,
      accessToken: shopifyToken,
      apiVersion: shopifyApiVersion,
      timeoutMs: shopifyTimeoutMs,
      maxRetries: shopifyMaxRetries,
      oauth: {
        apiKey: shopifyOauthApiKey,
        apiSecrets: shopifyOauthApiSecrets,
        scopes: shopifyOauthScopes,
        redirectUri: shopifyOauthRedirectUri,
      },
    },
    shipFrom,
    shipLabelLogoUrl,
  };
}
