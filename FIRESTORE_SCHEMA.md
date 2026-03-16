# Firestore Schema & Strategy

This file codifies how documents are organized, how keys are generated, and what fields every new piece of data must include so Firestore remains consistent across routes.

## Common principles
- **Collection-per-store**: `src/firestore/shopCollections.js` derives the Firestore collection id from the shop key (`storeId` or domain). Use `getShopCollectionInfo({ storeId })` whenever you need to write/read `consignments` for a shop so the frontend and backend stay in sync.
- **Store documents (`shops` collection)**: each shop doc lives at `shops/<storeId-or-domain>` and stores metadata such as `storeId`, `storeDomain`, `storeDetails`, `accessToken`, `shipFrom`, and `shipLabelLogoUrl`. Routes like `src/routes/storeRoutes.js`, `src/routes/shopsRoutes.js`, and `src/routes/shopifyOAuthRoutes.js` rely on this doc, while `resolveShipFrom` and `resolveStoreName` read from it.
- **Firebase role split**: `users/<uid>` documents hold `{ role: "admin" | "shop", storeId, storeDomain }` and are loaded by `src/auth/createAuth.js`. Keep `role` normalized via `src/auth/roles.js`.
- **Consistent IDs**: Shopify-sourced orders use `toOrderDocId(orderKey)` (`src/firestore/ids.js`) to canonicalize `trade_id → doc id`. Manual orders use `reserveHrGids` (`src/firestore/hrGid.js`) plus `formatManualOrderName` when `orderId` is missing.
- **Farmed counters**: `meta/counters` stores `nextOrderSeq` and `nextHrGid`, while `storeIdCounters/<YYYY-MM>` tracks `nextSerial` for `storeId` allocation (`storeIdGenerator.js`). Always update these through transactions to avoid duplicates.

## Key collections & expected fields

### `shops`
| Field | Description |
| --- | --- |
| `storeId` | Numeric store ID, e.g., `956241200001`. |
| `storeDomain` | Shopify domain (used for Shopify OAuth + routing). |
| `storeDetails` | Object with store name, registered address, contact person, GST, etc. |
| `shipFrom` | Optional default "from" block (`name`, `address1`, `city`, `pinCode`, `country`, `phone`). |
| `shopify` / `shopifyAccessToken` | OAuth access token and metadata (scopes, API version). |
| `shipLabelLogoUrl` | Optional URL used by `generateShippingLabelPdfBuffer`. |
| `branding/logo` subdocument | Stores uploaded PNG/JPEG binary + MIME so labels can show custom logos. |
| `fulfillmentCenter` subcollection | Each doc records `{ originName, address1, city, pinCode, default }`. `manualOrdersService` and `shipmentsRoutes` resolve these. |

Always `merge` when writing so new meta doesn’t overwrite other fields.

### `consignments` (per-store collection)
Each document represents an order/shipment. Write through helpers in `src/orders/manualOrdersService.js`, `src/routes/shipmentsRoutes.js`, and `src/routes/firestoreOrdersRoutes.js`.

| Field | Purpose |
| --- | --- |
| `docId` | Firestore doc id (hash, HR GID, or the doc itself). |
| `storeId` | Numeric store id for filtering (normalized). |
| `shopName` | Human-friendly label (from `storeDetails`). |
| `order` | Normalized order payload: `orderId`, `orderGid`, `customerEmail`, `paymentStatus`, `shipping` object (`fullName`, `phone1`, etc.). |
| `shipmentStatus` | Display status (`Assigned`, `In Transit`, `Delivered`, etc.). Keep canonical via `normalizeDisplayStatus` helpers before writing. |
| `consignmentNumber` | AWB/tracking number. |
| `courierPartner`, `courierType`, `weightKg`, `shippingDate`, `expectedDeliveryDate`, `updatedAt`, `requestedAt` | Operational metadata used by the UI and label generator. |
| `searchTokens` | Array of tokens from `src/firestore/searchTokens.js` for fast filtering by name/phone/awb. |
| `requestedBy` | `{ uid, email, role }` set during manual updates. |
| `event`, `ewayBill`, `hrGid` | Enforcement fields (e.g., `event: "manual_assign"` to show how the assignment happened, `ewayBill` for GST). |

**Query patterns**:
- `where("order.orderId", "==", value)` must be backed by a composite index (Firestore auto-index). Keep docs compact to avoid hitting size limits.
- `where("shipmentStatus", "in", [...])` is supported by `firestoreOrdersRoutes` filters; replicating this filter elsewhere requires proper indexes.

### `tracking_updates` (per-store subcollection)
Stores the latest DTDC REST snapshot per consignment. Keep each doc keyed by the AWB and only persist the fields the automation UI actually needs.

| Field | Description |
| --- | --- |
| `lastFetchedAt` | Firestore server timestamp when we polled DTDC. |
| `header` | Minimal header data: `currentStatusCode`, `currentStatusDescription`, `currentStatusDate`, `currentStatusTime`, `currentLocationCityName`, `originCity`, `destinationCity`, `opsEdd`. |
| `statusTimeline` | Array of the newest `statuses[]` entries with `{ statusTimestamp, statusDescription, remarks, actBranchName, actCityName }`. Keep it sorted newest-first and cap at an application-defined length (e.g., 10). |
| `remarks` | Text from `statusTimeline[0].remarks` to make filtering simple. |

**Query notes**
- Index `tracking_updates` by `lastFetchedAt` and `statusTimeline[0].statusTimestamp` for dashboards showing recency.  
- Use `collectionGroup` queries on `tracking_updates` + `consignmentNumber` when reconciling new snapshots.  

If a fetch fails or DTDC responds with `statusDescription === "Failed"`, stash the raw JSON in `tracking_updates/<consignment>/errors/<ISO timestamp>` instead of overwriting the doc.

### `awbPool`
Holds AWB numbers per courier bucket:

| Field | Purpose |
| --- | --- |
| `awbNumber` (doc id) | Normalized AWB string (uppercase alphanumeric). |
| `category` | One of `z_express`, `d_prepaid`, `d_cod`. |
| `assigned` | Bool (transactionally flipped when `allocateAwbFromPool` runs). |
| `assignedDocId`, `assignedStoreId`, `orderId` | Reference to the order using the AWB. |
| `assignedAt`, `releasedAt`, `lastUploadedAt` | Timestamps to audit usage. |

Uploads via `awbPoolRoutes` call `uploadAwbPoolCsv`, which deduplicates entries and respects existing assignments.

### `meta/counters`
Shared counters for sequential IDs.

| Field | Notes |
| --- | --- |
| `nextOrderSeq` | Used by `manualOrdersService` to generate fallback order names (via `formatManualOrderName`). |
| `nextHrGid` | HR GIDs begin at `100000000000` and are reserved atomically via `reserveHrGids`. |

### `storeIdCounters/<YYYY-MM>`
Tracks monthly `storeId` urns: `nextSerial`. When a new shop installs via `/oauth`, `ensureStoreIdForShop` increments this counter within a transaction and assigns `956<YY><MM><serial>` (leading zeros preserved).

### `users`
(`FIREBASE_USERS_COLLECTION` default `users`)

- Stores `{ role, storeId, storeDomain }`.
- Loaded as the source of truth for `req.user` in `createAuth`.
- Admins do not need a `storeId`, while shop users do.

## Search strategy
- `searchTokens` includes normalized strings/digits derived from consignment, courier, name, phone, PIN, etc. Use `buildSearchTokensFromDoc` before saving.
- When a doc lacks `searchTokens`, `firestoreOrdersRoutes` falls back to manual haystack lookup; keep this fallback for backwards compatibility but prefer tokens moving forward.

## Consistency notes
- Always normalize phone/pincode vectors before storing (`src/orders/manualOrdersService.js` covers this).
- `shipmentsRoutes` writes `shippingDate = assignedAt` plus sanitized `shipmentStatus`. `manualOrdersService` sets `requestedAt`/`updatedAt`.
- When migrating old documents, `migrateAllOrdersAtStartup` deletes snake_case fields and rewrites `order`/`shipmentStatus`/`searchTokens`. If you add new normalized fields, update this migration to clean up legacy copies.
- Document IDs must remain human-friendly when possible: Shopify orders hash the Shopify key, manual orders use `hrGid`, and bulk imports respect existing `hrGid` when reimported.

Follow this schema when building new Firestore interactions; additions that deviate should either reside in new collections (with their own doc) or be gated behind clearly named subcollections.
