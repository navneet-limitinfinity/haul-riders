import test from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../src/config/env.js";

test("loadEnv parses defaults and booleans", () => {
  const env = loadEnv({
    PORT: "3000",
    TRUST_PROXY: "yes",
    SHOPIFY_TIMEOUT_MS: "1234",
    SHOPIFY_MAX_RETRIES: "1",
  });

  assert.equal(env.port, 3000);
  assert.equal(env.trustProxy, true);
  assert.equal(env.shopify.timeoutMs, 1234);
  assert.equal(env.shopify.maxRetries, 1);
});

test("loadEnv rejects invalid PORT", () => {
  assert.throws(() => loadEnv({ PORT: "nope" }), /PORT must be a positive integer/);
  assert.throws(() => loadEnv({ PORT: "0" }), /PORT must be a positive integer/);
});

test("loadEnv rejects invalid log level", () => {
  assert.throws(() => loadEnv({ PORT: "3000", LOG_LEVEL: "trace" }), /LOG_LEVEL/);
});

test("loadEnv rejects invalid Shopify timeout/retry bounds", () => {
  assert.throws(
    () => loadEnv({ PORT: "3000", SHOPIFY_TIMEOUT_MS: "0" }),
    /SHOPIFY_TIMEOUT_MS/
  );
  assert.throws(
    () => loadEnv({ PORT: "3000", SHOPIFY_MAX_RETRIES: "10" }),
    /SHOPIFY_MAX_RETRIES/
  );
});

