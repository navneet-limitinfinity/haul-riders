import "dotenv/config";

import { loadEnv } from "../config/env.js";
import { createLogger } from "../logging/createLogger.js";
import { createShopifyAdminClient } from "../shopify/createShopifyAdminClient.js";
import { projectOrderRow } from "../shopify/projectOrderRow.js";

const printOrdersToTerminal = (orders) => {
  // NDJSON output:
  // - Easy to copy/paste
  // - Avoids any truncation/padding that table renderers can do
  orders.forEach((order, index) => {
    const row = projectOrderRow({ order, index });
    process.stdout.write(JSON.stringify(row) + "\n");
  });
};

async function main() {
  const env = loadEnv(process.env);
  const logger = createLogger({ level: env.logLevel });

  const client = createShopifyAdminClient({
    storeDomain: env.shopify.storeDomain,
    accessToken: env.shopify.accessToken,
    apiVersion: env.shopify.apiVersion,
  });

  // Fetch the latest 10 orders and print the requested fields to terminal.
  const orders = await client.getLatestOrders({ limit: 10 });
  logger.info({ count: orders.length }, "Fetched latest orders from Shopify");

  printOrdersToTerminal(orders);
}

main().catch((error) => {
  // Avoid printing secrets; Shopify errors may include response snippets.
  console.error("Failed to fetch orders:", error?.message ?? error);
  process.exit(1);
});
