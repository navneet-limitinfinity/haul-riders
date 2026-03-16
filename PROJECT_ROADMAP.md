# Project Roadmap

This document captures what we ship today, why it is structured this way, and how future work should be planned so anyone stepping into the repo can reason about the direction of Haul Riders.

## Today’s baseline
1. **Multi-store Shopify automation** – The Express app (`src/server.js` → `src/app.js` → `src/routes/*`) routes both admin and shop personas through Firebase-authenticated flows, exposing dashboards (`/shop/orders`, `/admin/orders`), bulk/manual order tools, AWB pool uploads, and Shopify helper APIs (`/api/shopify/*`).
2. **Firestore-backed operational state** – Firestore collections (`/src/firestore/*`, `FIRESTORE_*` env) track registered shops, consignments, AWB pools, metadata counters, and onboarding data. `src/firestore/migrateOrders.js` keeps legacy docs aligned.
3. **Shipping label + AWB automation** – `src/shipments/label` builds 4x6 PDFs with `pdf-lib`+`bwip-js`, `src/awb/awbPoolService.js` stewards AWBs, and `src/routes/shipmentsRoutes.js` wires up assignment + label downloads, all backed by the `shipments_state.json` volume for quick lookups.
4. **Frontend tooling** – Static assets in `src/public/*.js/.css` power dashboards, forms, and login experiences with targeted caching, while `src/pincodes` pre-builds lookup data.

## Roadmap pillars
1. **Hardening onboarding + multi-store controls**
   - Finalize `shops` metadata (shopDetails, fulfillment centers, branding) and surface them in the dashboards and Shopify OAuth flow (`src/routes/shopifyOAuthRoutes.js`, `src/routes/storeRoutes.js`).
   - Add more telemetry around `ensureStoreIdForShop` allocations for tracing (especially in migrations run in `migrateOrders`).
2. **Operational visibility + search**
   - Expand `consignments` search tokens (`src/firestore/searchTokens.js`) and surface them in the UI (`src/public/orders.js`) so admins can filter by phone/awb/order quickly.
   - Consider paginated Firestore snapshots to avoid scanning >500 docs per query.
3. **AWB + label resilience**
   - Add better retry/logging around `allocateAwbFromPool` transactions and watch for `awb_unavailable` in `src/routes/shipmentsRoutes.js` and `orders/manualOrdersService.js`.
   - Revisit `generateShippingLabelPdfBuffer` to reuse cached template map (`src/shipments/label/docketTemplateMap.json`) and pre-warm fonts in memory if PDF load latency increases.
4. **Server observability + CI**
   - Build out tests that hit `routes/pagesRoutes` and `shipments` logic; `test/` already covers helpers (`env`, `projectOrderRow`, `extractAwb`, `startHttpServer`).
   - Consider linting or formatting guard (ESLint already configured) and monitor `LOG_LEVEL`.

## Maintenance checklist
- Keep environment parsing centralized (`src/config/env.js`); any new config keys must run through `loadEnv`.
- Add routes through `buildRoutes` so they inherit auth/caching/404 behavior.
- Always log via `src/logging/createLogger.js` (structured JSON) rather than `console`.
- Use Firestore helper modules (`storeDocs`, `shopCollections`, `ids`, `hrGid`, `orderSequence`, `searchTokens`) in new features to keep document keys consistent.
- When touching shipping labels, update `src/public/Blank Docket.pdf`, `src/public/Sample Docket.pdf`, and `src/scripts/extractDocketTemplateMap.js` if coordinates change.

## Next-action suggestions
1. Confirm multi-store data flow: audit `shops/<domain>` documents, ensure `storeRoutes` and `/api/shops` remain in sync.
2. Automate AWB pool health checks (maybe add a scheduled job or dashboard panel to highlight low AWB counts per `category`).
3. Improve manual import feedback by tracking `jobs` in `manualOrdersRoutes` beyond in-memory (persist to Firestore if the service is distributed).

Always reference this roadmap before adding new features. If anything diverges (new persistence, major refactor), update this file so the road stays current.
