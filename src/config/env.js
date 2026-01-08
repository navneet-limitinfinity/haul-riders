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
  const shopifyApiVersion = rawEnv.SHOPIFY_API_VERSION ?? "2024-07";

  return {
    port,
    host,
    logLevel,
    trustProxy,
    shopify: {
      storeDomain: shopifyStore,
      accessToken: shopifyToken,
      apiVersion: shopifyApiVersion,
    },
  };
}
