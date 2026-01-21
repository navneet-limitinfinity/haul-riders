import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildRoutes } from "./routes/buildRoutes.js";

/**
 * Creates the Express app (pure construction; no side effects like listening).
 */
export function createApp({ env, logger }) {
  const app = express();

  const publicDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "public"
  );
  const vendorFirebaseDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    "firebase"
  );

  // Needed for correct client IP / protocol when running behind Nginx/Apache.
  if (env.trustProxy) app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );
  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        // Allow Firebase JS SDK ESM modules (loaded from /login via dynamic import()).
        "script-src": ["'self'", "https://www.gstatic.com"],
        // Allow Firebase Auth network calls (identitytoolkit/securetoken are under googleapis.com).
        "connect-src": ["'self'", "https:"],
        // Temporary: allow running over plain HTTP (e.g. IP-based deployments).
        // Remove this once HTTPS is enabled.
        "upgrade-insecure-requests": null,
      },
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use("/static", express.static(publicDir, { etag: true, maxAge: "5m" }));
  app.use(
    "/vendor/firebase",
    express.static(vendorFirebaseDir, { etag: true, maxAge: "5m" })
  );

  // HTTP access logs (short + useful). The logger is used instead of console.
  app.use(
    morgan("tiny", {
      stream: {
        write: (message) => logger.info({ message: message.trim() }, "http"),
      },
    })
  );

  app.get("/", (_req, res) => {
    res.redirect(302, "/shop/orders");
  });

  app.get("/favicon.ico", (_req, res) => {
    res.redirect(302, "/static/icon.png");
  });

  app.use(buildRoutes({ env, logger }));

  // 404 handler (kept after routes, before the error handler).
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Basic error handler (kept last).
  // Note: avoid leaking sensitive data in production.
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    logger.error({ error }, "Unhandled error");
    res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}
