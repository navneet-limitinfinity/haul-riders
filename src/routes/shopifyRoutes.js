import { Router } from "express";
import { createShopifyAdminClient } from "../shopify/createShopifyAdminClient.js";
import { projectOrderRow } from "../shopify/projectOrderRow.js";
import { resolveStore } from "../config/stores.js";

/**
 * Shopify-related routes.
 * This is intentionally small now; you can add coupon/discount endpoints later.
 */
export function createShopifyRouter({ env, logger, auth }) {
  const router = Router();

  const getStoreIdFromRequest = (req) =>
    String(req.query?.store ?? req.get?.("x-store-id") ?? "").trim();

  const getStoreIdForRequest = (req) => {
    const role = String(req.user?.role ?? "").trim().toLowerCase();
    if (role === "shop") return String(req.user?.storeId ?? "").trim();
    return getStoreIdFromRequest(req);
  };

  const getStoreForRequest = (req) => {
    if (env.storesConfig) {
      const storeId = getStoreIdForRequest(req);
      if (String(req.user?.role ?? "").trim().toLowerCase() === "shop" && !storeId) {
        return null;
      }
      return resolveStore({
        storesConfig: env.storesConfig,
        storeId,
        env: process.env,
      });
    }

    return {
      id: "default",
      name: "default",
      domain: env.shopify.storeDomain,
      apiVersion: env.shopify.apiVersion,
      token: env.shopify.accessToken,
    };
  };

  router.get("/shop", auth.requireAnyRole(["admin", "shop"]), async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const store = getStoreForRequest(req);
      if (!store?.domain || !store?.token) {
        res.status(400).json({ error: "store_not_configured" });
        return;
      }
      const client = createShopifyAdminClient({
        storeDomain: store.domain,
        accessToken: store.token,
        apiVersion: store.apiVersion,
        timeoutMs: env.shopify.timeoutMs,
        maxRetries: env.shopify.maxRetries,
      });

      const shop = await client.getShop();
      res.json({ storeId: store.id, shop });
    } catch (error) {
      logger.error({ error }, "Failed to fetch shop");
      next(error);
    }
  });

  router.get("/debug", auth.requireRole("admin"), async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const store = getStoreForRequest(req);
      if (!store?.domain || !store?.token) {
        res.status(400).json({ error: "store_not_configured" });
        return;
      }
      const client = createShopifyAdminClient({
        storeDomain: store.domain,
        accessToken: store.token,
        apiVersion: store.apiVersion,
        timeoutMs: env.shopify.timeoutMs,
        maxRetries: env.shopify.maxRetries,
      });

      const [shop, accessScopes, ordersCountAny] = await Promise.all([
        client.getShop(),
        client.getAccessScopes(),
        client.getOrdersCount({ status: "any" }),
      ]);

      res.json({
        config: {
          storeId: store.id,
          storeDomain: store.domain,
          apiVersion: store.apiVersion,
          tokenPresent: Boolean(store.token),
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

  router.get(
    "/orders/latest",
    auth.requireAnyRole(["admin", "shop"]),
    async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const rawLimit = req.query?.limit;
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(rawLimit ?? "250", 10) || 250)
      );
      const rawSince = String(req.query?.since ?? "").trim();
      const createdAtMin = rawSince ? new Date(rawSince) : null;
      const createdAtMinIso =
        createdAtMin && !Number.isNaN(createdAtMin.getTime())
          ? createdAtMin.toISOString()
          : "";

      const store = getStoreForRequest(req);
      if (!store?.domain || !store?.token) {
        res.status(400).json({ error: "store_not_configured" });
        return;
      }

      const client = createShopifyAdminClient({
        storeDomain: store.domain,
        accessToken: store.token,
        apiVersion: store.apiVersion,
        timeoutMs: env.shopify.timeoutMs,
        maxRetries: env.shopify.maxRetries,
      });

      const orders = await client.getLatestOrders({ limit, createdAtMin: createdAtMinIso });
      const projected = orders.map((order, index) =>
        projectOrderRow({ order, index, overrides: null })
      );

      res.json({
        storeId: store.id,
        count: projected.length,
        limit,
        since: createdAtMinIso,
        orders: projected,
      });
    } catch (error) {
      logger.error({ error }, "Failed to fetch latest orders");
      next(error);
    }
  });

  return router;
}
