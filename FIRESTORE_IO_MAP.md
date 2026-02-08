# Firestore I/O Map (Read/Write Keys + Locations)

This file is the single reference for **where we read/write Firestore** in this repo and **which keys are used**. Use this first before adding new fields or changing any Firestore-related behavior.

## 0) Collection Naming & Document IDs

### Shop Orders/Shipments Collection ID
All per-shop order/shipment documents live in a Firestore collection derived from `storeId`:
- Source: `src/firestore/shopCollections.js`
- Input `storeId` can be:
  - full domain: `smylo-devstore.myshopify.com`
  - store key: `64dd6e-2`
- Normalization:
  - `storeKey` = domain without `.myshopify.com` (or already a key)
  - `collectionId` = sanitized `storeKey` (lowercased, non `[a-z0-9_-]` replaced with `_`)

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
  - Reads `users/<uid>` to resolve:
    - `role` (`admin|shop`)
    - `storeId` (shop domain like `abc.myshopify.com`)

**Writes**
- None in this repo.

### 1.2 Shops Collection (`FIREBASE_SHOPS_COLLECTION`, default: `shops`)
**Reads**
- `src/firestore/shops.js` (helper)
- `src/routes/shopsRoutes.js` (admin store dropdown)
- `src/shopify/resolveShopifyAccessToken.js` reads `shops/<shopDomain>/shopify/config.accessToken`

**Writes**
- `src/routes/shopifyOAuthRoutes.js`
  - `shops/<shopDomain>`:
    - `shopDomain`
    - `installedAt`
    - `updatedAt`
    - `oauth` (object; minimal metadata)
  - `shops/<shopDomain>/shopify/config`:
    - `accessToken`
    - `scopes`
    - `updatedAt`

### 1.3 Fulfillment Centers Subcollection
Path:
- `shops/<shopDomain>/fulfillmentCenter/<centerId>`

**Reads/Writes**
- `src/routes/firestoreOrdersRoutes.js`
  - `GET /api/firestore/fulfillment-centers`
  - `POST /api/firestore/fulfillment-centers`
  - `PUT /api/firestore/fulfillment-centers/:id`
  - `DELETE /api/firestore/fulfillment-centers/:id`

Keys in a center doc:
- `originName`
- `contactPersonName`
- `address1`, `address2`, `city`, `state`, `pinCode`, `country`
- `phone`
- `default` (boolean)
- `createdAt`, `updatedAt`

### 1.4 Store Details + Branding (Shop-only)

**Store details**
- Path: `shops/<shopDomain>` (doc field: `storeDetails`)
- File: `src/routes/storeRoutes.js`
- Endpoints:
  - `GET /api/store/details`
  - `POST /api/store/details`
- Keys written (under `storeDetails`):
  - `storeName`
  - `registeredAddress`
  - `gstNumber`
  - `stateCode`
  - `stateName`
  - `websiteAddress`
  - `contactPerson { name, email, phone }`
  - `updatedAt`

**Shopify UI links (Shop Store Details page)**
- Path: `shops/<shopDomain>` (doc field: `shopifyUi`)
- Files: `src/routes/storeRoutes.js`, `src/public/store-details.js`
- Keys read:
  - `connectUrl`
  - `authenticateUrl`

**Branding logo**
- Path: `shops/<shopDomain>/branding/logo`
- File: `src/routes/storeRoutes.js`
- Endpoints:
  - `GET /api/store/branding/logo`
  - `POST /api/store/branding/logo` (multipart; field: `logo`)
- Keys written:
  - `contentType`
  - `sizeBytes`
  - `updatedAt`
  - `data` (Firestore Blob; max 1MB)

**Reads**
- `src/public/store-details.js` (upload UI)
- `src/routes/pagesRoutes.js` (shop pages render top-right logo `<img>`)
- `src/shipments/label/shippingLabelPdf.js` (embeds logo into PDF)

### 1.5 Meta Counters (Global)
Used for generating unique, increasing manual `orderName` values (non-Shopify orders).
- Path: `meta/counters`
- File: `src/firestore/orderSequence.js`
- Keys written:
  - `nextOrderSeq` (number)
  - `updatedAt` (ISO)

## 2) Shop Orders/Shipments Collection (Per-Store)

Path:
- `/<collectionId>/<orderDocId>`

### 2.0 Canonical Schema + Startup Migration
This project enforces a **single canonical schema** for order docs. Any legacy/duplicate keys are removed by a **startup migration**:
- Migration: `src/firestore/migrateOrders.js`
- Hook: `src/server.js` calls `migrateAllOrdersAtStartup({ env, logger })`

### 2.1 Canonical Keys (Order Doc)
Identity / ownership:
- `orderKey` (string; primary key used throughout UI)
- `docId` (string; `order_<sha256(orderKey)>`)
- `storeId` (string; normalized store key)
- `shopName` (string; display)

Order object (sanitized; no tracking/status duplicates inside):
- `order` (object)
  - `index`
  - `orderKey`
  - `orderId`
  - `orderGid`
  - `orderName`
  - `createdAt` (ISO)
  - `customerEmail`
  - `financialStatus`
  - `paymentStatus`
  - `totalPrice`
  - `invoiceValue`
  - `productDescription`
  - `fulfillmentCenter`
  - `fulfillmentStatus`
  - `shipping`:
    - `fullName`
    - `address1`
    - `address2`
    - `city`
    - `state`
    - `pinCode`
    - `phone1`
    - `phone2`

Shipment/dashboard fields (top-level):
- `shipmentStatus` (display string; e.g. `Assigned`, `In Transit`, `Delivered`, `RTO Accepted`, …)
- `courierPartner` (e.g. `DTDC`)
- `consignmentNumber` (AWB / tracking code)
- `weightKg` (number or string; kg; 1 decimal preferred)
- `courierType` (string)
- `shippingDate` (ISO; used for sorting in In Transit/Delivered/RTO)
- `expectedDeliveryDate` (ISO; optional)
- `updatedAt` (ISO; updated on every status change)

Metadata:
- `requestedAt` (ISO; “ship requested” timestamp used for ordering in Assigned)
- `event` (string)
- `requestedBy { uid, email, role }`
- `updatedBy { uid, email, role }`

### 2.2 Status History Subcollection
Path:
- `/<collectionId>/<orderDocId>/shipment_status_history/<autoId>`

Written on every status change (admin update + bulk status + consignments update-status):
- `changed_at` (ISO)
- `from_shipment_status` (display)
- `to_shipment_status` (display)
- `from_internal_status` (always empty string)
- `to_internal_status` (always empty string)
- `updated_by { uid, email, role }`

## 3) Writers (Order Docs)

### 3.1 Shipments: Assign (Shop)
- File: `src/routes/shipmentsRoutes.js`
- Endpoint: `POST /api/shipments/assign` (role: shop)
- Writes to `/<collectionId>/<orderDocId>` with `{ merge:true }`

Keys written/updated:
- `orderKey`, `docId`, `storeId`, `shopName`
- `order` (sanitized order object from client)
- `shipmentStatus: "Assigned"`
- `shippingDate` (ISO; set to assign time)
- `updatedAt` (ISO; set to assign time)
- optional: `weightKg`, `courierType`
- `event: "ship_requested"`
- `requestedBy { uid, email, role }`
- `requestedAt`

### 3.2 Manual Orders: Create/Import (Admin/Shop)
- Files: `src/routes/manualOrdersRoutes.js`, `src/orders/manualOrdersService.js`
- Endpoints:
  - `POST /api/orders/import` (multipart; field: `file`)
  - `POST /api/orders/create` (JSON)

Keys written:
- `orderKey`, `docId`, `storeId`, `shopName`
- `order` (sanitized order object)
- `shipmentStatus: "New"`
- `courierPartner`, `consignmentNumber`, `weightKg`, `courierType`, `shippingDate`, `expectedDeliveryDate`
- `updatedAt`
- `event: "manual_order_create"`
- `requestedBy`, `requestedAt`

### 3.3 Manual Orders: Assign to Ship (Admin/Shop)
- Files: `src/routes/manualOrdersRoutes.js`, `src/orders/manualOrdersService.js`
- Endpoint: `POST /api/orders/assign`

Keys updated:
- `shipmentStatus: "Assigned"`
- `shippingDate`, `updatedAt`
- `event: "manual_order_assign"`
- `updatedBy`

### 3.4 Shipments: Update Status/Tracking (Admin)
- File: `src/routes/shipmentsRoutes.js`
- Endpoint: `POST /api/shipments/update`
- Transaction:
  - Updates `/<collectionId>/<orderDocId>`
  - Inserts `shipment_status_history/<autoId>`

Keys updated:
- `shipmentStatus` (display)
- optional: `consignmentNumber`
- `shippingDate` (preserved/backfilled)
- `updatedAt`
- `event: "admin_update"`
- `updatedBy`

### 3.5 Bulk Orders Upload (Admin)
- File: `src/routes/bulkOrdersRoutes.js`
- Endpoint: `POST /api/admin/bulk-orders/upload`
- Writes to `/<collectionId>/<orderDocId>` with `{ merge:true }`

Keys written/updated:
- `orderKey`, `docId`, `storeId`, `shopName`
- `order` (sanitized order object; `createdAt` is the upload timestamp)
- `shipmentStatus: "Assigned"` (or preserved if already present)
- `courierPartner`, `consignmentNumber`
- optional: `weightKg`, `courierType`
- `shippingDate`
- optional: `expectedDeliveryDate`
- `updatedAt`
- `event: "bulk_csv_upload"`
- `requestedBy`, `requestedAt`

### 3.6 Bulk Status Upload (Admin)
- File: `src/routes/bulkOrdersRoutes.js`
- Endpoint: `POST /api/admin/bulk-status/upload`
- Transaction:
  - Updates `/<collectionId>/<orderDocId>`
  - Inserts `shipment_status_history/<autoId>`

Keys updated:
- `shipmentStatus` (display)
- `consignmentNumber` (from CSV)
- `courierPartner` (from CSV or default)
- `shippingDate` (preserved/backfilled)
- `updatedAt` (defaults to now; CSV may provide `updatedAt` / `updated_at` / `Updated On`)
- `event: "bulk_status_csv"`
- `updatedBy`

### 3.7 Consignments Status Update (Admin)
- File: `src/routes/consignmentsRoutes.js`
- Endpoint: `POST /api/consignments/update-status`
- Transaction:
  - Updates `/<collectionId>/<orderDocId>`
  - Inserts `shipment_status_history/<autoId>`

Keys updated:
- `shipmentStatus` (display; strict allowed values per tab)
- `shippingDate` (preserved/backfilled)
- `updatedAt`
- `event: "status_update"`
- `updatedBy`

### 3.8 Shop Edit Shipping Address (Shop)
- File: `src/routes/firestoreOrdersRoutes.js`
- Endpoint: `POST /api/firestore/orders/update-shipping`
- Writes to `/<collectionId>/<orderDocId>` with `{ merge:true }`

Keys updated:
- `order.shipping.{ fullName, address1, address2, city, state, pinCode, phone1, phone2 }`
- `event: "shop_edit"`
- `updatedAt`

## 4) Readers (Order Docs)

### 4.1 Server-side list endpoints (HTTP)
- `src/routes/firestoreOrdersRoutes.js`
  - `GET /api/firestore/orders` (shop)
  - `GET /api/firestore/admin/orders` (admin)
  - Reads: `order`, `orderKey`, `shipmentStatus`, `consignmentNumber`, `courierPartner`, `weightKg`, `courierType`, `shippingDate`, `expectedDeliveryDate`, `updatedAt`, `requestedAt` (with legacy fallbacks during migration).

- `src/routes/consignmentsRoutes.js`
  - `GET /api/consignments/in_transit|delivered|rto` (shop/admin)
  - Reads canonical top-level shipment fields + `order` to project tab rows.

### 4.2 Client-side Firestore realtime (Shop Assigned tab)
- File: `src/public/orders.js`
- Reads: `shipmentStatus`, `consignmentNumber`, `courierPartner`, `weightKg`, `courierType`, `shippingDate`, `expectedDeliveryDate`, `updatedAt`, `order`, `requestedAt` (with legacy fallbacks during migration).

## 5) Removed Legacy Keys (Startup Migration Deletes These)
These must not be written by current code. If found in DB, startup migration removes them:
- `shipment_status`
- `trackingNumber`
- `awbNumber`
- `trackingCompany`
- `updated_at`
- `shipment` (entire object)
- `order.trackingNumbers`, `order.trackingNumbersText`, `order.trackingCompany`, `order.trackingUrl`, `order.trackingUrls`
- `order.shipping.phoneNumbers`, `order.shipping.phoneNumbersText`
- `consignment_number`, `courier_partner`, `courier_type`, `weight`, `shipping_date`, `expected_delivery_date`
