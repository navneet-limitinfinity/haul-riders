# Server Optimization Guide

This file explains how the server is built for reliability, security, and observability so new contributions can keep the same constraints.

## Startup pipeline (see `src/server.js`)
1. `dotenv/config` loads `.env` so `loadEnv(process.env)` always receives parsed keys.
2. `createLogger` spins up a structured JSON logger with `logLevel` control. All modules log through this single logger (e.g., `app.js`, migrations).
3. `ensurePincodeDirectoryAsset` prebuilds `src/public/pincodes_directory.json.gz`; the gzipped payload is refreshed only when `Pincode_master.csv` changes, reducing repeated parsing in production.
4. `startHttpServer` listens once the Express app is ready and resolves/rejects formally, enabling graceful shutdown logic and health logging.
5. `migrateAllOrdersAtStartup` runs in the background to clean legacy data without blocking incoming traffic. Fatal migrations are logged using the same logger.
6. Signal handlers (`SIGINT`, `SIGTERM`) close the HTTP server and exit cleanly so process managers (PM2/systemd/Docker) can restart the app.

## Middleware & security (`src/app.js`)
- `helmet()` shields headers and disables `X-Powered-By`.
- A custom CSP via `helmet.contentSecurityPolicy` allows Firebase scripts (`https://www.gstatic.com`) and Google APIs while remaining restrictive for other domains.
- `express.json({ limit: "1mb" })` protects against large request bodies.
- `morgan("tiny")` feeds access logs through the structured logger (not `console.log`) so logs stay machine-readable.
- `trust proxy` is enabled when `TRUST_PROXY=true`, allowing accurate client IP/protocol detection behind Nginx/Apache.
- Static assets under `/static` have conservative caching (5 minutes) except for dashboard JS/CSS which are forced to `no-store` to avoid stale UI. `/vendor/firebase` is also cached for 5 minutes to reuse Firebase SDK bundles.

## Static data & assets
- The dashboard HTML served by `src/routes/pagesRoutes.js` refers to `orders.js`, `bulk-upload.js`, etc. Each `<script>`/`<link>` includes `?v=<assetVersion>` so cache invalidation only happens when you bump that constant in the route.
- `src/public/Pincode_master.csv` is parsed on startup and compressed into `pincodes_directory.json.gz` so clients can download a lightweight binary via the `/pincodes/lookup` endpoints.
- `shipments_state.json` (mounted via `docker-compose` or created manually) persists local shipment state outside Firestore (`src/shipments/state.js`). Writes are atomic (`.tmp` files) to survive crashes.

## Data handling & transactions
- Firestore writes are normalized before persisting (`firestore/searchTokens.js`, `manualOrdersService`, `shipmentsRoutes`), reducing duplicated fields and easing indexes.
- AWB allocation happens inside Firestore transactions (`src/awb/awbPoolService.js#allocateAwbFromPool`), flipping the `assigned` flag and writing metadata atomically.
- `reserveHrGids`, `reserveOrderSequences`, and `ensureStoreIdForShop` all run inside `firestore.runTransaction` blocks to avoid race conditions when multiple imports/OAuth flows run simultaneously.
- `addTokens` and `buildSearchTokensFromDoc` strip punctuation, keep digit variants (last 10 digits, first 6), and cap arrays at 80 tokens to avoid Firestore field limits.
- Manual/bulk uploads use streaming/`multer.memoryStorage()` with file size limits (5–10 MB) to keep the service responsive.

## Observability & debugging
- Logging is JSON, with `traceId`-like fields (e.g., `host`, `port`) automatically set when `startHttpServer` resolves. Use `logger.warn/error` from inside routes/migrations to ensure the message is visible.
- Errors bubble to the final Express error handler (`res.status(500)`), and the logger records both the stack and optional `cause`.
- Debug footer support in `src/routes/pagesRoutes.js` is toggleable via query/cookie, letting you see logs while keeping production UI clean.
- `LOG_LEVEL` defaults to `info` but can be lowered to `debug` for local troubleshooting.

## Performance & resource hygiene
- Do not import `firebase-admin` except inside `src/auth/firebaseAdmin.js`; this file caches the initialized app so multiple routes can reuse it without duplicating credentials.
- When compiling shipping labels, `generateShippingLabelPdfBuffer` caches template assets (`templateAssetsPromise`) so PDFs reuse the loaded template (`Blank Docket`), reducing repeated disk I/O.
- Barcode generation via `bwip-js` only runs when `consignmentNumber` exists, and `extractAwbNumber` chooses the most authoritative field.
- The AWB pool upload helper splits large CSVs into 200-entry batches to avoid Firestore write limits, while `allocateAwbFromPool` queries only one bucket at a time.

## Operational checks
- Health endpoint (`/health`) responds quickly before any middleware touches Firestore.
- Cron-style migrations (currently handled on startup) log counts for `scanned` vs `migrated` to track progress.
- `shipmentsRoutes` sanitizes incoming payloads, normalizes statuses via helper sets, and rejects unsupported couriers/weights up front.

## Future contributors
1. Always reuse existing helpers (`shopCollections`, `manualOrdersService`, `awbPoolService`) when touching Firestore to keep document shapes uniform.
2. If you add asynchronous background work, log a start/end message and catch errors to avoid unhandled rejections (see `migrateAllOrdersAtStartup`).
3. Keep new static assets behind `/static` and update the asset version string in `pagesRoutes` so clients fetch the latest JavaScript/CSS.
4. Any new environment variable must be validated in `src/config/env.js` and documented in both `README.md` and this file.

Sticking to this guide preserves the optimizations already encoded in `app.js`, `server.js`, and the supporting helpers, enabling new developers to understand the “how” and “why” behind the stack.
