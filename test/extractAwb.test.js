import test from "node:test";
import assert from "node:assert/strict";
import { extractAwbNumber } from "../src/shipments/label/extractAwb.js";

test("extractAwbNumber prefers shipment awb/tracking fields", () => {
  const awb = extractAwbNumber({
    firestoreDoc: {
      shipment: { awbNumber: "Z74202084" },
      trackingNumber: "SHOULD_NOT_WIN",
      order: { trackingNumbersText: "ORDER_SHOULD_NOT_WIN" },
    },
  });
  assert.equal(awb, "Z74202084");
});

test("extractAwbNumber falls back to order trackingNumbersText", () => {
  const awb = extractAwbNumber({
    firestoreDoc: {
      order: { trackingNumbersText: "Z111, Z222" },
    },
  });
  assert.equal(awb, "Z111");
});

