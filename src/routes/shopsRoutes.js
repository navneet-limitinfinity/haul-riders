import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";

const normalizeDomain = (domain) => String(domain ?? "").trim().toLowerCase();

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
          const shopDomain = normalizeDomain(data.shopDomain || doc.id);
          if (!shopDomain) return null;
          return { shopDomain };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.shopDomain).localeCompare(String(b.shopDomain)));

      res.json({ defaultStoreId: String(stores[0]?.shopDomain ?? ""), stores });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
