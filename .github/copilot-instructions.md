# GitHub Copilot Instructions for haul-riders

Short, actionable guidance to help an AI coding agent be immediately productive in this repository.

- Project layout & big picture
  - Node.js (ESM) microservice built with Express. Entry point: `src/server.js` → builds app (`src/app.js`) → mounts routes (`src/routes/*`) → server startup in `src/http/startHttpServer.js`.
  - Primary responsibility: small Shopify Admin API helpers and lightweight endpoints to inspect/fetch orders.
  - Key components: env parsing (`src/config/env.js`), multi-store loader (`src/config/stores.js`), Shopify client (`src/shopify/createShopifyAdminClient.js`), order projection (`src/shopify/projectOrderRow.js`), structured logger (`src/logging/createLogger.js`).

- Important runtime & environment details
  - This project uses ESM ("type": "module" in `package.json`). Use `import`/`export` syntax.
  - Loads environment with `dotenv` via `import "dotenv/config"` in entry scripts.
  - Main env-related file: `src/config/env.js`. Validate and parse all env vars there. Relevant vars:
    - `SHOPIFY_STORE`, `SHOPIFY_TOKEN`, `SHOPIFY_API_VERSION` (default `2025-10`), `SHOPIFY_TIMEOUT_MS`, `SHOPIFY_MAX_RETRIES`.
    - Multi-store: `STORES_FILE` points to a json file (see `stores.example.json`). Tokens can be provided via `token` or `tokenEnvVar` per store; use `src/config/stores.js` patterns when adding multi-store logic.

- Testing & dev workflow
  - Tests use Node's built-in test runner (`node:test`). Run tests with:
    - `node --test` (project root) or `npm exec -- node --test`.
  - Linting: `npm run lint` (ESLint config in repo).
  - Dev server: `npm run dev` (nodemon). Production-like: `npm start`.
  - Fetch latest 10 orders (terminal tool): `npm run orders:latest` (implemented in `src/scripts/printLatestOrders.js`).

- Logging & error conventions
  - Use the project's structured logger via `createLogger({ level })`.
  - Preferred usage: `logger.info({ some: field }, "message")` or `logger.error({ error }, "context")`. The logger serializes Error objects to fields: `name`, `message`, `stack`, `cause`.
  - Avoid logging secrets. Example pattern in repo: `console.error("Failed to fetch orders:", error?.message)` (prints message only).

- Shopify API client conventions
  - Use `createShopifyAdminClient({ storeDomain, accessToken, apiVersion, timeoutMs, maxRetries })` rather than reinventing fetch/headers.
  - The client implements timeouts, backoff retries and respects `Retry-After`. Follow its patterns when adding new Shopify calls (i.e., re-use `.requestJson` style and error messages).

- HTTP & API patterns
  - Routes are composed in `src/routes/buildRoutes.js`. Shopify endpoints live under `/api/shopify/*` and expect store resolution via query `?store=<id>` or `x-store-id` header (see `createShopifyRouter` in `src/routes/shopifyRoutes.js`).
  - Useful endpoints for debugging:
    - `GET /api/shopify/debug` → returns shop info, `accessScopes`, and order counts.
    - `GET /api/shopify/orders/latest?limit=10` → returns projected order rows (uses `projectOrderRow`).
  - Error responses follow simple conventions: `400` with `{ error: "store_not_configured" }`, `404` → `{ error: "not_found" }`, `500` → `{ error: "internal_server_error" }`.

- Code style & tests patterns
  - Functional style, small pure modules. Keep side effects (networking, FS) at top-level scripts or clearly isolated helpers.
  - Tests use small mocks (see `test/startHttpServer-mock.test.js`) and a noop test logger helper (`test/helpers/logger.js`). When adding tests, prefer mocking network interactions and exercising pure logic in isolation.

- Quick checklist for PRs / changes
  - Update `src/config/env.js` if new env vars are added and add validation tests in `test/env.test.js`.
  - Add unit tests for pure logic (`projectOrderRow`, store resolution, env parsing). Network calls should be integration-only and clearly labelled.
  - Run `npm run lint` and `node --test` locally before asking for review.

- Safety & operational notes
  - Respect `SHOPIFY_TIMEOUT_MS` and `SHOPIFY_MAX_RETRIES` bounds when adding requests. Prefer using the existing client which handles retries and `429` rate-limits.
  - For multi-store changes, ensure `stores.example.json` is updated and that `tokenEnvVar` usage is documented in README.
  - App handles graceful shutdown (SIGINT/SIGTERM) and logs unhandled rejections / uncaught exceptions in `src/server.js` — keep these handlers intact.

If anything is unclear or you want a different level of detail in a specific area (tests, API surface, or deployment scripts), tell me which section to expand and I will iterate. ✅
