import { Router } from "express";
import { createShopifyAdminClient } from "../shopify/createShopifyAdminClient.js";

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

  return router;
}

