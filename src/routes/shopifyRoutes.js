import { Router } from "express";
import { createShopifyAdminClient } from "../shopify/createShopifyAdminClient.js";
import { projectOrderRow } from "../shopify/projectOrderRow.js";
import { resolveShopifyAccessToken } from "../shopify/resolveShopifyAccessToken.js";

const normalizeDomain = (domain) => String(domain ?? "").trim().toLowerCase();

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

  const getStoreForRequest = async (req) => {
    const storeId = getStoreIdForRequest(req);

    // Always read token from Firestore `shops/<shopDomain>` when using Firebase auth.
    // This removes dependency on SHOPIFY_STORE/SHOPIFY_TOKEN env vars.
    if (env?.auth?.provider !== "firebase") return null;

    const shopDomain = normalizeDomain(storeId);
    if (!shopDomain) return null;
    const token = await resolveShopifyAccessToken({ env, shopDomain });
    return {
      id: shopDomain,
      name: shopDomain,
      domain: shopDomain,
      apiVersion: env.shopify.apiVersion,
      token,
    };
  };

  router.get("/shop", auth.requireAnyRole(["admin", "shop"]), async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const store = await getStoreForRequest(req);
      if (!store?.domain || !store?.token) {
        logger?.warn?.(
          { storeId: store?.id, storeDomain: store?.domain, hasToken: Boolean(store?.token) },
          "Shopify store not configured"
        );
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
      const store = await getStoreForRequest(req);
      if (!store?.domain || !store?.token) {
        logger?.warn?.(
          { storeId: store?.id, storeDomain: store?.domain, hasToken: Boolean(store?.token) },
          "Shopify store not configured"
        );
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

      const store = await getStoreForRequest(req);
      if (!store?.domain || !store?.token) {
        logger?.warn?.(
          { storeId: store?.id, storeDomain: store?.domain, hasToken: Boolean(store?.token) },
          "Shopify store not configured"
        );
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

  router.post(
    "/orders/products",
    auth.requireAnyRole(["admin", "shop"]),
    async (req, res, next) => {
      try {
        res.setHeader("Cache-Control", "no-store");

        const store = await getStoreForRequest(req);
        if (!store?.domain || !store?.token) {
          logger?.warn?.(
            { storeId: store?.id, storeDomain: store?.domain, hasToken: Boolean(store?.token) },
            "Shopify store not configured"
          );
          res.status(400).json({ error: "store_not_configured" });
          return;
        }

        const orderIds = Array.isArray(req.body?.orderIds) ? req.body.orderIds : [];
        const ids = orderIds
          .map((v) => String(v ?? "").trim())
          .filter(Boolean)
          .slice(0, 200);

        const client = createShopifyAdminClient({
          storeDomain: store.domain,
          accessToken: store.token,
          apiVersion: store.apiVersion,
          timeoutMs: env.shopify.timeoutMs,
          maxRetries: env.shopify.maxRetries,
        });

        const chunkSize = 50;
        const results = new Map();
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const orders = await client.getOrdersByIds({ ids: chunk, fields: "id,line_items" });
          for (const order of orders) {
            const id = order?.id == null ? "" : String(order.id);
            if (!id) continue;
            const items = Array.isArray(order?.line_items) ? order.line_items : [];
            const parts = [];
            for (const item of items) {
              const title = String(item?.title ?? "").trim();
              if (!title) continue;
              const qtyRaw = item?.quantity;
              const qty =
                qtyRaw == null ? null : Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null;
              parts.push(qty && qty > 1 ? `${title} x${qty}` : title);
            }
            results.set(id, parts.join(", "));
          }
        }

        res.json({
          storeId: store.id,
          count: results.size,
          products: Object.fromEntries(results.entries()),
        });
      } catch (error) {
        logger?.error?.({ error }, "Failed to lookup Shopify order products");
        next(error);
      }
    }
  );

  return router;
}
