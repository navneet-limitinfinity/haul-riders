import { Router } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { ROLE_SHOP } from "../auth/roles.js";

const SESSION_COOKIE = "haul_session";

export function createAuthApiRouter({ auth, env, logger }) {
  const router = Router();
  const includeDetails = env?.logLevel === "debug" || process.env.NODE_ENV !== "production";

  router.post("/auth/sessionLogin", async (req, res) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const idToken = String(req.body?.idToken ?? "").trim();
      if (!idToken) {
        res.status(400).json({ error: "id_token_required" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const expiresIn = 5 * 24 * 60 * 60 * 1000;
      const sessionCookie = await admin.auth().createSessionCookie(idToken, {
        expiresIn,
      });

      res.cookie(SESSION_COOKIE, sessionCookie, {
        maxAge: expiresIn,
        httpOnly: true,
        secure: Boolean(req.secure),
        sameSite: "lax",
        path: "/",
      });

      res.json({ ok: true });
    } catch (error) {
      logger?.error?.({ error }, "Failed to create session cookie");

      const message = String(error?.message ?? "");
      const firebaseCode = String(error?.errorInfo?.code ?? error?.code ?? "").trim();
      if (message.includes("Firebase admin credentials missing")) {
        res.status(500).json({
          error: "firebase_admin_not_configured",
          ...(firebaseCode ? { firebaseCode } : {}),
          ...(includeDetails ? { details: message } : {}),
        });
        return;
      }

      if (
        message.includes("Missing dependency 'firebase-admin'") ||
        message.includes("Failed to import 'firebase-admin'")
      ) {
        res.status(500).json({
          error: "firebase_admin_dependency_missing",
          ...(firebaseCode ? { firebaseCode } : {}),
          ...(includeDetails ? { details: message } : {}),
        });
        return;
      }

      res.status(500).json({
        error: "session_login_failed",
        ...(firebaseCode ? { firebaseCode } : {}),
        ...(includeDetails ? { details: message } : {}),
      });
    }
  });

  router.post("/auth/logout", (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/me", auth.requireAuth, (req, res) => {
    const user = req.user ?? null;
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const shopInfo =
      user.role === ROLE_SHOP
        ? (() => {
            const storeId = String(user.storeId ?? "").trim();
            const storeKey = String(user.storeKey ?? "").trim();
            const collectionId = getShopCollectionInfo({ storeId }).collectionId;
            return {
              storeId,
              storeKey,
              firestoreCollectionId: collectionId,
            };
          })()
        : { storeId: "", storeKey: "", firestoreCollectionId: "" };

    res.json({
      uid: user.uid,
      email: user.email,
      role: user.role,
      storeId: shopInfo.storeId || user.storeId,
      storeKey: shopInfo.storeKey || "",
      firestoreCollectionId: shopInfo.firestoreCollectionId || "",
      provider: user.provider,
    });
  });

  return router;
}
