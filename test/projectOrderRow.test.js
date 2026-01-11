import test from "node:test";
import assert from "node:assert/strict";
import { projectOrderRow } from "../src/shopify/projectOrderRow.js";

test("projectOrderRow prefers admin_graphql_api_id for orderKey", () => {
  const row = projectOrderRow({
    index: 0,
    order: {
      id: Number.MAX_SAFE_INTEGER + 2, // intentionally beyond safe integer range
      admin_graphql_api_id: "gid://shopify/Order/1234567890123456789",
      name: "#1001",
      total_price: "10.00",
      fulfillments: [],
      shipping_address: { name: "A", address1: "B", city: "C" },
    },
  });

  assert.equal(row.orderKey, "gid://shopify/Order/1234567890123456789");
  assert.equal(row.orderGid, "gid://shopify/Order/1234567890123456789");
  assert.equal(row.orderName, "#1001");
});
