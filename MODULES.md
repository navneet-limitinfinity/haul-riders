# Module Guide

This repository is layered so each concern lives in a dedicated folder and exposes a predictable contract. Follow these descriptions when you need to add endpoints, UI assets, or persistence rules.

## 1. Entrypoint + environment
- `src/server.js` — boots the server. It loads env vars via `loadEnv`, creates the structured logger, prebuilds the pincode asset (`ensurePincodeDirectoryAsset`), starts the HTTP server (`startHttpServer`), kicks off the Firestore migration (`migrateAllOrdersAtStartup`), and wires graceful shutdown handlers. This file is the only place that should call `.listen`.
- `src/config/env.js` — centralizes every environment key, validation, and normalization. All new env values must be added here so deployments stay deterministic.
- `src/logging/createLogger.js` & `src/http/startHttpServer.js` — provide a structured JSON logger and a promise-based `listen` helper. Use `logger` everywhere instead of `console`.
- `src/app.js` — builds Express middleware: security headers (Helmet + CSP), static assets (`/static`, `/vendor/firebase`), request logging (`morgan` → logger), and route mounting via `src/routes/buildRoutes.js`.

## 2. Authentication layer (`src/auth`)
- `createAuth.js` attaches a `req.user` object based on the configured provider (`none`, `dev`, `firebase`), exposes guards (`requireAuth`, `requireRole`, `requireAnyRole`), and handles unauthorized redirects to `/login`.
- `firebaseAdmin.js` lazily initializes `firebase-admin` with credentials from a file, JSON payload, or environment variables.
- `roles.js` defines the `admin`/`shop` roles, and `cookies.js` parses session cookies such as `haul_session`.

## 3. Shopify integration (`src/shopify`)
- `resolveShopifyAccessToken.js` (used by routes and scripts) reads tokens from Firestore (`shops/<store>/shopify/config`).
- `createShopifyAdminClient.js` wraps Shopify REST calls with configured timeout/retry (used by `/api/shopify/*`).
- `projectOrderRow.js` normalizes Shopify order responses for the frontend dashboards.

## 4. Firestore helpers (`src/firestore`)
- `shopCollections.js` computes Firestore collection IDs per store key/domain so each store has its own `consignments` collection.
- `storeDocs.js`, `shopCollections`, `storeIdGenerator.js`, `shopCollections`, and `shops.js` locate stores, generate numeric IDs, and resolve documents for `storeRoutes`, OAuth, and label generation.
- `ids.js`, `hrGid.js`, `orderSequence.js`, and `searchTokens.js` are shared helpers for `consignments` document IDs, HR GID allocation, manual order sequencing, and Firestore search indexing.
- `migrateOrders.js` is triggered at startup to normalize legacy docs (removes snake_case fields, populates `searchTokens`, enforces `order`, `shipmentStatus`, etc.).

## 5. Web routes (`src/routes`)
- `buildRoutes.js` wires every router behind `/api` and `/oauth`. It also attaches auth middleware.
- `pagesRoutes.js` renders the HTML dashboards and SPA shell for `/shop/*` and `/admin/*`, injecting role-aware nav, asset versions, and debug footer toggles.
- `authRoutes.js` serves login HTML + Firebase config, while `authApiRoutes.js` handles session cookies (`/api/auth/*`) and `/api/me`.
- `shopifyRoutes.js` exposes `/api/shopify/*` helpers for admins and shops to fetch Shopify data, latest orders, and product lists.
- `shopifyOAuthRoutes.js` performs the OAuth install flow, stores access tokens under `shops/<store>/shopify/config`, and expects multiple secrets (rotated in `.env`).
- `shipmentsRoutes.js`, `consignmentsRoutes.js`, `firestoreOrdersRoutes.js`, `bulkOrdersRoutes.js`, `manualOrdersRoutes.js`, `awbPoolRoutes.js`, `storeRoutes.js`, `pincodeRoutes.js`, and `shopsRoutes.js` form the API surface: assigning shipments, uploading CSVs, searching Firestore collections, uploading AWB pools, and managing store/admin dashboards. They rely heavily on Firestore helper modules listed above.

## 6. Orders + shipments logic
- `src/orders/manualOrdersService.js` normalizes CSV rows, auto-fills city/state via `src/pincodes/serviceablePins.js`, reserves HR GIDs, builds `consignments` docs, and optionally allocates AWBs.
- `src/orders/import/*` contains CSV/XLSX parsers used by bulk/manual import routes.
- `src/awb/awbPoolService.js` manages AWB inventory with Firestore transactions so `allocateAwbFromPool` is atomic. `AWB_POOL_CATEGORIES` map courier types to buckets.
- `src/shipments/label/*` builds 4x6 PDFs on-demand using `pdf-lib`, overlays data from `src/public/Blank Docket.pdf`, and renders barcodes with `bwip-js`. `resolveShipFrom` and `extractAwb` keep payloads consistent.
- `src/shipments/state.js` keeps `shipments_state.json` in sync when `/api/shipments/state` or `/orders` pages need quick lookups outside Firestore.

## 7. Supporting assets (`src/public`, `src/pincodes`)
- `src/public/*.js` + CSS power the SPA dashboards, bulk upload flows, create order pages, store details, and login experience. They fetch `/api/*` endpoints documented above and respect asset caching set in `src/app.js`.
- `src/public/Pincode_master.csv` maps all PIN codes; `src/pincodes/serviceablePins.js` loads it at runtime, and `src/pincodes/buildPincodeDirectoryAsset.js` pre-compresses a JSON directory so the frontend can download a single `pincodes_directory.json.gz`.

## 8. Scripts & tooling (`src/scripts`)
- `extractDocketTemplateMap.js` and `makeBlankDocketTemplate.js` are helpers for maintaining PDF templates.
- `printLatestOrders.js` is a CLI that uses `src/shopify/*` helpers to log the latest Shopify orders (mirrors `GET /api/shopify/orders/latest`).

## 9. Tests & deployment
- `test/` covers critical helpers (`env`, `projectOrderRow`, `extractAwb`, `startHttpServer` and test helpers in `test/helpers/`).
- Root files such as `docker-compose.yml`, `deploy/pm2/*`, `deploy/nginx/*`, and `.github/workflows/docker-image.yml` describe how the container is built and deployed (see README for step-by-step instructions).

## 10. Future contributions
- Add new routes via `buildRoutes`.
- Keep Firestore read/write in dedicated helpers under `src/firestore`.
- When adjusting frontend behavior, bump the `assetVersion` strings inside `pagesRoutes.js` and the `v=` query params in the static script tags to force cache invalidation.
- Always document any new environment variables in `src/config/env.js` and update `README.md` plus this file so the architecture remains self-documenting.
