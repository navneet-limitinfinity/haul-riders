import { Router } from "express";
import { createAuth } from "../auth/createAuth.js";
import { createHealthRouter } from "./healthRoutes.js";
import { createAuthApiRouter } from "./authApiRoutes.js";
import { createAuthRouter } from "./authRoutes.js";
import { createFirestoreOrdersRouter } from "./firestoreOrdersRoutes.js";
import { createPagesRouter } from "./pagesRoutes.js";
import { createShipmentsRouter } from "./shipmentsRoutes.js";
import { createShopifyRouter } from "./shopifyRoutes.js";
import { createStoresRouter } from "./storesRoutes.js";

/**
 * Builds and returns the top-level router.
 */
export function buildRoutes({ env, logger }) {
  const router = Router();
  const auth = createAuth({ env, logger });

  router.use(auth.attachUser);
  router.use(createHealthRouter());
  router.use(createAuthRouter({ env }));
  router.use(createPagesRouter({ env, auth }));
  router.use("/api", createAuthApiRouter({ auth, env, logger }));
  router.use("/api", createFirestoreOrdersRouter({ env, auth }));
  router.use(
    "/api",
    createStoresRouter({ storesConfig: env.storesConfig ?? null, auth })
  );
  router.use("/api", createShipmentsRouter({ env, auth }));
  router.use("/api/shopify", createShopifyRouter({ env, logger, auth }));

  return router;
}
