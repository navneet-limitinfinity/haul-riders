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
      res.setHeader("Cache-Control", "no-store");
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

  router.get("/debug", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const client = createShopifyAdminClient({
        storeDomain: env.shopify.storeDomain,
        accessToken: env.shopify.accessToken,
        apiVersion: env.shopify.apiVersion,
      });

      const [shop, accessScopes, ordersCountAny] = await Promise.all([
        client.getShop(),
        client.getAccessScopes(),
        client.getOrdersCount({ status: "any" }),
      ]);

      res.json({
        config: {
          storeDomain: env.shopify.storeDomain,
          apiVersion: env.shopify.apiVersion,
          tokenPresent: Boolean(env.shopify.accessToken),
        },
        shop: {
          id: shop?.id,
          name: shop?.name,
          myshopify_domain: shop?.myshopify_domain,
          domain: shop?.domain,
        },
        accessScopes: accessScopes.map((s) => s.handle).filter(Boolean),
        ordersCountAny,
      });
    } catch (error) {
      logger.error({ error }, "Failed to fetch Shopify debug info");
      next(error);
    }
  });

  router.get("/orders/latest", async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
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

      res.json({ count: projected.length, limit, orders: projected });
    } catch (error) {
      logger.error({ error }, "Failed to fetch latest orders");
      next(error);
    }
  });

  return router;
}
