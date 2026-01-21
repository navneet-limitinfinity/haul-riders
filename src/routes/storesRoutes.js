import { Router } from "express";

export function createStoresRouter({ storesConfig, auth }) {
  const router = Router();

  router.get("/stores", auth.requireRole("admin"), (_req, res) => {
    res.setHeader("Cache-Control", "no-store");

    if (!storesConfig) {
      res.json({ defaultStoreId: "", stores: [] });
      return;
    }

    res.json({
      defaultStoreId: storesConfig.defaultStoreId,
      stores: storesConfig.stores.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
      })),
    });
  });

  return router;
}
