import { Router } from "express";
import { createShopifyAdminClient } from "../shopify/createShopifyAdminClient.js";
import { projectOrderRow } from "../shopify/projectOrderRow.js";

/**
 * Shopify-related routes.
 * This is intentionally small now; you can add coupon/discount endpoints later.
 */
export function createShopifyRouter({ env, logger }) {
  const router = Router();

  router.get("/shop", async (_req, res, next) => {
    try {
      const client = createShopifyAdminClient({
        storeDomain: env.shopify.storeDomain,
        accessToken: env.shopify.accessToken,
        apiVersion: env.shopify.apiVersion,
      });

      const shop = await client.getShop();
      res.json({ shop });
    } catch (error) {
      logger.error({ error }, "Failed to fetch shop");
      next(error);
    }
  });

  router.get("/orders/latest", async (req, res, next) => {
    try {
      const rawLimit = req.query?.limit;
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(rawLimit ?? "10", 10) || 10)
      );

      const client = createShopifyAdminClient({
        storeDomain: env.shopify.storeDomain,
        accessToken: env.shopify.accessToken,
        apiVersion: env.shopify.apiVersion,
      });

      const orders = await client.getLatestOrders({ limit });
      const projected = orders.map((order, index) =>
        projectOrderRow({ order, index })
      );

      res.json({ count: projected.length, orders: projected });
    } catch (error) {
      logger.error({ error }, "Failed to fetch latest orders");
      next(error);
    }
  });

  return router;
}
