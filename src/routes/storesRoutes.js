import { Router } from "express";

export function createStoresRouter({ storesConfig }) {
  const router = Router();

  router.get("/stores", (_req, res) => {
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

