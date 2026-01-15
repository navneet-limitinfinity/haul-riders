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
  const storesFile = rawEnv.STORES_FILE ?? "";
  const adminName = String(rawEnv.ADMIN_NAME ?? "Haul Riders Admin").trim() || "Haul Riders Admin";

  return {
    port,
    host,
    logLevel,
    trustProxy,
    storesFile,
    adminName,
    shopify: {
      storeDomain: shopifyStore,
      accessToken: shopifyToken,
      apiVersion: shopifyApiVersion,
      timeoutMs: shopifyTimeoutMs,
      maxRetries: shopifyMaxRetries,
    },
  };
}
