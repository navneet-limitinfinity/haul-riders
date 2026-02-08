import test from "node:test";
import assert from "node:assert/strict";
import { extractAwbNumber } from "../src/shipments/label/extractAwb.js";

test("extractAwbNumber returns consignmentNumber", () => {
  const awb = extractAwbNumber({
    firestoreDoc: {
      consignmentNumber: "Z74202084",
      shipment: { awbNumber: "LEGACY_SHOULD_NOT_BE_USED" },
      trackingNumber: "LEGACY_SHOULD_NOT_BE_USED",
      order: { trackingNumbersText: "LEGACY_SHOULD_NOT_BE_USED" },
    },
  });
  assert.equal(awb, "Z74202084");
});

test("extractAwbNumber returns empty string when missing", () => {
  const awb = extractAwbNumber({
    firestoreDoc: {
      order: { trackingNumbersText: "Z111, Z222" },
    },
  });
  assert.equal(awb, "");
});
