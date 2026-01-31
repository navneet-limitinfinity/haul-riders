# Firestore I/O Map (Read/Write Keys + Locations)

This file is the single reference for **where we read/write Firestore** in this repo and **which keys are used**. Use this first before adding new fields or changing any Firestore-related behavior.

## 0) Collection Naming & Document IDs

### Shop Orders/Shipments Collection ID
All order/shipment documents for a shop live in a Firestore collection derived from `storeId`:
- Source: `src/firestore/shopCollections.js`
- Input `storeId` can be:
  - full domain: `smylo-devstore.myshopify.com`
  - store key: `64dd6e-2`
- Normalization:
  - `storeKey` = domain without `.myshopify.com` (or already a key)
  - `collectionId` = sanitized version of `storeKey` (lowercased, non `[a-z0-9_-]` replaced with `_`)

Examples:
- `smylo-devstore.myshopify.com` → `storeKey: smylo-devstore` → `collectionId: smylo-devstore`
- `64dd6e-2` → `storeKey: 64dd6e-2` → `collectionId: 64dd6e-2`

### Order Document ID
Order docs are stored as deterministic IDs derived from `orderKey`:
- Source: `src/firestore/ids.js`
- Function: `toOrderDocId(orderKey)` → `order_<sha256(orderKey)>`

## 1) Global Collections (Non-Orders)

### 1.1 Users Collection (`FIREBASE_USERS_COLLECTION`, default: `users`)
**Reads**
- `src/auth/createAuth.js`
  - `users/<uid>` read to resolve:
    - `role` (`admin|shop`)
    - `storeId` (shop domain like `abc.myshopify.com`)

**Writes**
- None in this repo (auth only reads).

### 1.2 Shops Collection (`FIREBASE_SHOPS_COLLECTION`, default: `shops`)
**Reads**
- `src/firestore/shops.js` (helper)
- `src/routes/shopsRoutes.js`
  - Lists all shops for admin store dropdown.

**Writes**
- `src/routes/shopifyOAuthRoutes.js`
  - `shops/<shopDomain>` `.set(..., { merge:true })`
    - Keys written (top-level):
      - `shopDomain`
      - `installedAt`
      - `updatedAt`
      - `oauth` (object; minimal metadata)
  - `shops/<shopDomain>/shopify/config` `.set(..., { merge:true })`
    - Keys written:
      - `accessToken`
      - `scopes`
      - `updatedAt`

**Reads (token fetch)**
- `src/shopify/resolveShopifyAccessToken.js`
  - Reads `shops/<shopDomain>/shopify/config.accessToken`

### 1.3 Fulfillment Centers Subcollection
Stored under the shops collection:
- Path: `shops/<shopDomain>/fulfillmentCenter/<centerId>`

**Reads/Writes**
- `src/routes/firestoreOrdersRoutes.js`
  - `GET /api/firestore/fulfillment-centers` → reads list ordered by `originName`
  - `POST /api/firestore/fulfillment-centers` → creates new doc, may batch-update other docs to unset `default`
  - `PUT /api/firestore/fulfillment-centers/:id` → updates center, may batch-update others to set/unset `default`
  - `DELETE /api/firestore/fulfillment-centers/:id` → deletes center, may batch-update another center as next default

Keys written in a center doc:
- `originName`
- `address1`
- `address2`
- `city`
- `state`
- `pinCode`
- `country`
- `phone`
- `default` (boolean)
- `createdAt`
- `updatedAt`

## 2) Shop Orders/Shipments Collection (Per-Store)

Path:
- `/<collectionId>/<orderDocId>`

This collection contains the “orders dashboard” documents (orders + shipment metadata).

### 2.1 Canonical/Current Keys Used by New Tabs + APIs
These are the keys the **Consignments APIs** and **new tabs** aim to rely on:

Top-level (snake_case “dashboard fields”):
- `shipment_status` (display string; e.g. `In Transit`, `Delivered`, `RTO Accepted`, …)
- `courier_partner` (e.g. `DTDC`)
- `consignment_number` (AWB / tracking code)
- `weight` (number, kg)
- `courier_type` (string)
- `shipping_date` (ISO string; used for sorting)
- `expected_delivery_date` (ISO string; optional)
- `updated_at` (ISO string; updated on each status change)

Top-level (existing/legacy keys still present and used):
- `shipmentStatus` (internal string; e.g. `assigned`, `in_transit`, `delivered`, `rto_initiated`, …)
- `trackingNumber` (tracking code, historically used)
- `requestedAt` (ISO string; used historically for ordering)
- `updatedAt` (ISO string; historically used)
- `order` (object; projected from Shopify/bulk import)
- `shipment` (object; internal shipment details)
- `event` (string)
- `requestedBy` (object)
- `updatedBy` (object)
- `storeId` (normalized store key, not full domain)
- `shopName`
- `docId`
- `orderKey`

Nested `shipment` object keys commonly used:
- `shipment.shipmentStatus`
- `shipment.trackingNumber`
- `shipment.assignedAt`
- `shipment.shippingDate`
- `shipment.updatedAt`
- `shipment.weightKg`
- `shipment.courierType`

### 2.2 Status History Subcollection
Path:
- `/<collectionId>/<orderDocId>/shipment_status_history/<autoId>`

Written on every status change (admin update + bulk status + consignments update-status):
- `changed_at` (ISO)
- `from_shipment_status` (display)
- `to_shipment_status` (display)
- `from_internal_status` (internal)
- `to_internal_status` (internal)
- `updated_by`:
  - `uid`
  - `email`
  - `role`

## 3) Endpoints / Modules That WRITE Shop Order Docs

### 3.1 Shipments: Assign (Shop)
- File: `src/routes/shipmentsRoutes.js`
- Endpoint: `POST /api/shipments/assign` (role: shop)
- Write: `/<collectionId>/<orderDocId>` with `{ merge:true }`

Writes/updates keys (top-level):
- `orderKey`, `docId`, `storeId`, `shopName`
- `order` (full order object submitted by client)
- `shipmentStatus: "assigned"`
- `shipment_status: "Assigned"`
- `shipping_date` (ISO)
- `updated_at` (ISO)
- `updatedAt` (ISO)
- `weight` (from `weightKg`, if provided)
- `courier_type` (from `courierType`, if provided)
- `shipment`:
  - `shipmentStatus`, `assignedAt`, `shippingDate`, `updatedAt`
  - optional: `weightKg`, `courierType`
- `event: "ship_requested"`
- `requestedBy { uid, email, role }`
- `requestedAt`

### 3.2 Shipments: Update Status/Tracking (Admin)
- File: `src/routes/shipmentsRoutes.js`
- Endpoint: `POST /api/shipments/update` (role: admin)
- Write: Firestore transaction:
  - Updates `/<collectionId>/<orderDocId>` (merge)
  - Inserts `shipment_status_history/<autoId>`

Updates keys:
- `shipmentStatus` (internal)
- `shipment_status` (display)
- `trackingNumber` (if provided)
- `consignment_number` (mirrors trackingNumber, if provided)
- `shipping_date` (preserved/backfilled)
- `updated_at`, `updatedAt`
- `shipment.{ shipmentStatus, trackingNumber?, shippingDate, updatedAt }`
- `event: "admin_update"`
- `updatedBy { uid, email, role }`

### 3.3 Bulk Orders Upload (Admin)
- File: `src/routes/bulkOrdersRoutes.js`
- Endpoint: `POST /api/admin/bulk-orders/upload` (role: admin)
- Write: `/<collectionId>/<orderDocId>` `{ merge:true }`

Writes/updates keys:
- `orderKey`, `docId`, `storeId`, `shopName`
- `order` (projected from CSV)
- `shipmentStatus: "assigned"`
- `shipment_status: "Assigned"`
- `trackingNumber` (if AWB provided)
- `consignment_number` (if AWB provided)
- `courier_partner` (CSV `trackingCompany` or default)
- `weight`, `courier_type` (if provided)
- `shipping_date` (set to assignedAt)
- `updated_at` (set to assignedAt)
- `shipment`:
  - `shipmentStatus`, `assignedAt`, `shippingDate`, `updatedAt`
  - optional: `courierType`, `weightKg`, `awbNumber`, `trackingNumber`
- `event: "bulk_csv_upload"`
- `requestedBy { uid, email, role }`
- `requestedAt`
- `updatedAt`

### 3.4 Bulk Status Upload (Admin)
- File: `src/routes/bulkOrdersRoutes.js`
- Endpoint: `POST /api/admin/bulk-status/upload` (role: admin)
- Write: For each matched doc, Firestore transaction:
  - Updates `/<collectionId>/<orderDocId>` (merge)
  - Inserts `shipment_status_history/<autoId>`

Updates keys:
- `shipmentStatus` (internal, normalized)
- `shipment_status` (display, normalized)
- `trackingNumber` (from CSV)
- `consignment_number` (mirrors trackingNumber)
- `shipping_date` (preserved/backfilled)
- `updated_at`, `updatedAt` (defaults to "now"; can be provided as `Updated On` / `updated_at` in CSV)
- `shipment.{ shipmentStatus, trackingNumber, shippingDate, updatedAt }`
- `event: "bulk_status_csv"`
- `updatedBy { uid, email, role }`

### 3.5 Consignments Status Update (Admin)
- File: `src/routes/consignmentsRoutes.js`
- Endpoint: `POST /api/consignments/update-status` (role: admin)
- Write: Firestore transaction:
  - Updates `/<collectionId>/<orderDocId>` (merge)
  - Inserts `shipment_status_history/<autoId>`

Updates keys:
- `shipment_status` (display; strict allowed values for that UI)
- `shipmentStatus` (internal mapped value)
- `shipping_date` (preserved/backfilled)
- `updated_at`, `updatedAt`
- `shipment.{ shipmentStatus, shippingDate, updatedAt }`
- `event: "status_update"`
- `updatedBy { uid, email, role }`

### 3.6 Shop Edit Shipping Address (Shop)
- File: `src/routes/firestoreOrdersRoutes.js`
- Endpoint: `POST /api/firestore/orders/update-shipping` (role: shop)
- Write: `/<collectionId>/<orderDocId>` `{ merge:true }`

Updates keys:
- `order.shipping.{ fullName, address1, address2, city, state, pinCode, phone1, phone2 }`
- `event: "shop_edit"`
- `updatedAt`

## 4) Endpoints / Modules That READ Shop Order Docs

### 4.1 Server-side list endpoints (HTTP)
- `src/routes/firestoreOrdersRoutes.js`
  - `GET /api/firestore/orders` (shop)
  - `GET /api/firestore/admin/orders` (admin)
  - Reads:
    - `order` (object)
    - `orderKey`
    - `shipmentStatus` OR `shipment.shipmentStatus`
    - `trackingNumber` OR `shipment.trackingNumber`
    - `requestedAt`

- `src/routes/consignmentsRoutes.js`
  - `GET /api/consignments/in_transit|delivered|rto` (shop/admin)
  - Reads (and backfills when missing):
    - `shipping_date` (or derived)
    - `shipment_status` (or derived from internal)
    - `updated_at` (or derived)
    - `consignment_number` (or derived from trackingNumber)
    - `courier_partner` (or derived/default)
    - order fields from `order` object (for UI display)

### 4.2 Client-side Firestore realtime (Shop Assigned tab)
- File: `src/public/orders.js`
- Uses Firebase Web SDK to listen to `/<collectionId>` (collection id injected into HTML).
- Reads:
  - `shipmentStatus` OR `shipment.shipmentStatus`
  - `trackingNumber` OR `shipment.trackingNumber`
  - `order` object
  - `requestedAt`

## 5) Key Mapping Notes (Legacy vs New)

### 5.1 Status Keys
- **Internal**: `shipmentStatus` (legacy) / `shipment.shipmentStatus` (legacy)
  - Examples seen in DB: `assigned`, `in_transit`, `delivered`, `rto_initiated`, `at_destination`, etc.
- **Display**: `shipment_status` (new; required for the new tabs filtering)
  - Examples: `In Transit`, `At Destination`, `Delivered`, `RTO Accepted`, `RTO Delivered`, etc.

### 5.2 Tracking Keys
- Legacy: `trackingNumber`, `shipment.trackingNumber`
- New: `consignment_number` (AWB)
- Partner: `courier_partner` (defaults to `DTDC` when AWB exists and partner missing)

### 5.3 Time Keys
- Legacy ordering: `requestedAt`
- New sorting requirement: `shipping_date` (if missing, derived from `shipment.shippingDate` → `shipment.assignedAt` → `requestedAt` → `updatedAt`)
- Updated timestamp: `updated_at` (if missing, derived from `shipment.updatedAt` or `updatedAt`)
