import "dotenv/config";

import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { loadStoresConfig } from "./config/stores.js";
import { startHttpServer } from "./http/startHttpServer.js";
import { createLogger } from "./logging/createLogger.js";

/**
 * Entry point.
 * - Loads env vars
 * - Builds the Express app
 * - Starts the HTTP server
 */
async function main() {
  const env = loadEnv(process.env);
  const logger = createLogger({ level: env.logLevel });

  let storesConfig = null;
  if (env.storesFile) {
    try {
      storesConfig = await loadStoresConfig({ filePath: env.storesFile });
      logger.info(
        { storesFile: env.storesFile, storeCount: storesConfig.stores.length },
        "Loaded multi-store config"
      );
    } catch (error) {
      logger.error(
        { error, storesFile: env.storesFile },
        "Failed to load STORES_FILE"
      );
      process.exit(1);
    }
  }

  const appEnv = { ...env, storesConfig };

  if (!storesConfig) {
    if (!env.shopify.storeDomain) {
      logger.warn(
        { envVar: "SHOPIFY_STORE" },
        "Missing Shopify store domain; Shopify routes will fail until set"
      );
    }

    if (!env.shopify.accessToken) {
      logger.warn(
        { envVar: "SHOPIFY_TOKEN" },
        "Missing Shopify access token; Shopify routes will fail until set"
      );
    }
  }

  const app = createApp({ env: appEnv, logger });
  const server = await startHttpServer({ app, env: appEnv, logger });

  // Graceful shutdown for local dev and production (PM2, systemd, Docker, etc.)
  const handleShutdownSignal = (signalName) => {
    logger.info({ signalName }, "Shutdown signal received");
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
  process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
}

main().catch((error) => {
  // Last-resort logging.
  // If env parsing fails or logger can't start, we still want something visible.
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
