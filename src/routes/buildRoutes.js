import { Router } from "express";
import { createAuth } from "../auth/createAuth.js";
import { createHealthRouter } from "./healthRoutes.js";
import { createAuthApiRouter } from "./authApiRoutes.js";
import { createAuthRouter } from "./authRoutes.js";
import { createFirestoreOrdersRouter } from "./firestoreOrdersRoutes.js";
import { createBulkOrdersRouter } from "./bulkOrdersRoutes.js";
import { createPagesRouter } from "./pagesRoutes.js";
import { createPincodeRouter } from "./pincodeRoutes.js";
import { createShipmentsRouter } from "./shipmentsRoutes.js";
import { createShopifyRouter } from "./shopifyRoutes.js";
import { createShopsRouter } from "./shopsRoutes.js";

/**
 * Builds and returns the top-level router.
 */
export function buildRoutes({ env, logger }) {
  const router = Router();
  const auth = createAuth({ env, logger });

  router.use(createHealthRouter());
  router.use(auth.attachUser);
  router.use(createAuthRouter({ env }));
  router.use(createPagesRouter({ env, auth }));
  router.use("/api", createAuthApiRouter({ auth, env, logger }));
  router.use("/api", createBulkOrdersRouter({ env, auth }));
  router.use("/api", createFirestoreOrdersRouter({ env, auth }));
  router.use("/api", createShopsRouter({ env, auth }));
  router.use("/api", createPincodeRouter({ auth }));
  router.use("/api", createShipmentsRouter({ env, auth }));
  router.use("/api/shopify", createShopifyRouter({ env, logger, auth }));

  return router;
}
