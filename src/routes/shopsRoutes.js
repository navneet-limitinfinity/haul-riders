import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";

const normalizeDomain = (domain) => String(domain ?? "").trim().toLowerCase();

const resolveStoreName = (data) => {
  if (!data || typeof data !== "object") return "";
  const details = data.storeDetails && typeof data.storeDetails === "object" ? data.storeDetails : {};
  return (
    String(
      details.storeName ?? data.storeName ?? data.name ?? data.shopName ?? data.displayName ?? ""
    ).trim()
  );
};

export function createShopsRouter({ env, auth }) {
  const router = Router();

  router.get("/shops", auth.requireRole("admin"), async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");

      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";
      const admin = await getFirebaseAdmin({ env });

      const snap = await admin.firestore().collection(shopsCollection).get();
      const stores = snap.docs
        .map((doc) => {
          const data = doc.data() ?? {};
          const storeId = normalizeDomain(data.shopDomain || data.storeId || doc.id);
          if (!storeId) return null;
          const storeName = resolveStoreName(data);
          return { storeId, shopDomain: storeId, storeName };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.storeId).localeCompare(String(b.storeId)));

      res.json({ defaultStoreId: String(stores[0]?.storeId ?? ""), stores });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
