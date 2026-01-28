import "dotenv/config";

import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
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

  // Ensure unexpected crashes still leave a log trail.
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
    process.exit(1);
  });

  process.on("uncaughtException", (error) => {
    logger.error({ error }, "Uncaught exception");
    process.exit(1);
  });

  const appEnv = env;

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
