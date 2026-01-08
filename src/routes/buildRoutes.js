import { Router } from "express";
import { createHealthRouter } from "./healthRoutes.js";
import { createPagesRouter } from "./pagesRoutes.js";
import { createShopifyRouter } from "./shopifyRoutes.js";

/**
 * Builds and returns the top-level router.
 */
export function buildRoutes({ env, logger }) {
  const router = Router();

  router.use(createHealthRouter());
  router.use(createPagesRouter());
  router.use("/api/shopify", createShopifyRouter({ env, logger }));

  return router;
}
