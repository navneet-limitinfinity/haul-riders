# Firestore Order Document Reference

This file captures the key/value shape that every order document currently exposes, so you can refer back when you need to read or write order data from any tab (`Assigned`, `In Transit`, `Delivered`, `RTO`, `All`).

### Top-level fields

| Field | Type | Description / Sample |
| --- | --- | --- |
| `docId` | `string` | Document id (e.g. `order_0a115...881fc2`). |
| `order` | `map` | Shopify-originated metadata (see “order” map). |
| `orderId` | `string` | Shopify order name / order id (e.g. `O000069`). |
| `orderName` | `string` | Alias of `orderId` for backward compatibility. |
| `orderGid` | `string` | Shopify GraphQL id (optional). |
| `createdAt` | `string` | Timestamp when order created in your panel (ISO). |
| `invoiceValue` | `string` | Total invoice amount (same as `totalPrice`). |
| `paymentStatus` | `string` | `paid`, `cod`, etc. |
| `paymentMode` | `string` | (if present) `Prepaid` / `COD`. |
| `shipmentStatus` | `string` | Human-friendly status (`Assigned`, `In Transit`, etc.). |
| `shippingDate` | `string` | ISO timestamp when order was marked as shipped. |
| `expectedDeliveryDate` | `string` | ISO string (can be empty). |
| `updatedAt` | `string` | ISO timestamp for last change. |
| `requestedAt` | `string` | ISO timestamp the row was picked for assignment/status work. |
| `requestedBy` | `map` | `{ uid, email, role }` of the user who triggered the action. |
| `consignmentNumber` | `string` | AWB / tracking number (e.g. `D2006597794`). |
| `courierPartner` | `string` | `DTDC`, etc. |
| `courierType` | `string` | e.g. `D - Surface`. |
| `weightKg` | `string` | weight value (`"2.4"`). |
| `event` | `string` | Last event (e.g. `manual_assign`). |
| `searchTokens` | `array` | Indexed list used for dashboard search. |

### `order` map fields

| Field | Type | Notes |
| --- | --- | --- |
| `createdAt` | `string` | When the order record was created in Firestore. |
| `customerEmail` | `string` | Customer email (optional). |
| `financialStatus` | `string` | `paid`, etc. |
| `fulfillmentStatus` | `string` | `fulfilled`, etc. |
| `productDescription` | `string` | Human-readable item summary (used in UI). |
| `fulfillmentCenter` | `string` | `Name | Phone | Address` string used for labels. |

### `shipping` map

| Field | Type | Notes |
| --- | --- | --- |
| `fullName` | `string` | Customer name. |
| `address1` | `string` | Address line 1. |
| `address2` | `string` | Address line 2. |
| `city` | `string` | City (e.g. `HOWRAH`). |
| `state` | `string` | State (e.g. `WEST BENGAL`). |
| `pinCode` | `string` | PIN (e.g. `711201`). |
| `phone1` | `string` | Primary phone. |
| `phone2` | `string` | Secondary phone (may be empty). |
| `phoneNumbers` | `array` | Deduplicated phone list. |
| `phoneNumbersText` | `string` | Joined phone list. |

When building UI rows for each tab, these fields are the ones you should read from Firestore. Use this document whenever you need to confirm the canonical key names and data types. If the schema changes, update this file immediately so it continues to reflect reality.
