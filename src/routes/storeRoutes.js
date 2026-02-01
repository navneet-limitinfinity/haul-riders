import { Router } from "express";
import multer from "multer";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ROLE_SHOP } from "../auth/roles.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
});

const nowIso = () => new Date().toISOString();

const normalizeShopDomain = (storeId) => {
  const raw = String(storeId ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes(".")) return raw;
  return `${raw}.myshopify.com`;
};

const normalizePhone10 = (value) => {
  const digits = String(value ?? "").replaceAll(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
};

const normalizeDetailsPayload = (body) => {
  const storeName = String(body?.storeName ?? "").trim();
  const registeredAddress = String(body?.registeredAddress ?? "").trim();
  const gstNumber = String(body?.gstNumber ?? "").trim();
  const websiteAddress = String(body?.websiteAddress ?? "").trim();
  const contactPersonName = String(body?.contactPersonName ?? "").trim();
  const contactPersonEmail = String(body?.contactPersonEmail ?? "").trim();
  const contactPersonPhone = normalizePhone10(body?.contactPersonPhone ?? "");

  return {
    storeName,
    registeredAddress,
    gstNumber,
    websiteAddress,
    contactPerson: {
      name: contactPersonName,
      email: contactPersonEmail,
      phone: contactPersonPhone,
    },
  };
};

const coerceBytesToBuffer = (value) => {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value?.toUint8Array === "function") return Buffer.from(value.toUint8Array());
  if (Array.isArray(value)) return Buffer.from(Uint8Array.from(value));
  return null;
};

export function createStoreRouter({ env, auth }) {
  const router = Router();

  router.get("/store/details", auth.requireRole(ROLE_SHOP), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
      const shopDomain = normalizeShopDomain(storeId);
      if (!shopDomain) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";
      const snap = await firestore.collection(shopsCollection).doc(shopDomain).get();
      const data = snap.exists ? snap.data() ?? {} : {};

      const details = data?.storeDetails && typeof data.storeDetails === "object" ? data.storeDetails : {};

      // Shopify UI links (read-only; configured in Firestore).
      const shopifyUi = data?.shopifyUi && typeof data.shopifyUi === "object" ? data.shopifyUi : {};
      const connectUrl = String(shopifyUi?.connectUrl ?? "").trim();
      const authenticateUrl = String(shopifyUi?.authenticateUrl ?? "").trim();

      // "Connected" state inferred from existing Shopify access token doc.
      let connected = false;
      try {
        const shopifySnap = await firestore
          .collection(shopsCollection)
          .doc(shopDomain)
          .collection("shopify")
          .doc("config")
          .get();
        const cfg = shopifySnap.exists ? shopifySnap.data() ?? {} : {};
        connected = Boolean(String(cfg?.accessToken ?? "").trim());
      } catch {
        connected = false;
      }

      res.setHeader("Cache-Control", "no-store");
      res.json({
        shopDomain,
        storeDetails: {
          storeName: String(details?.storeName ?? "").trim(),
          registeredAddress: String(details?.registeredAddress ?? "").trim(),
          gstNumber: String(details?.gstNumber ?? "").trim(),
          websiteAddress: String(details?.websiteAddress ?? "").trim(),
          contactPersonName: String(details?.contactPerson?.name ?? "").trim(),
          contactPersonEmail: String(details?.contactPerson?.email ?? "").trim(),
          contactPersonPhone: String(details?.contactPerson?.phone ?? "").trim(),
        },
        shopify: {
          connected,
          storeDomain: shopDomain,
          connectUrl,
          authenticateUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/store/details", auth.requireRole(ROLE_SHOP), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
      const shopDomain = normalizeShopDomain(storeId);
      if (!shopDomain) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const payload = normalizeDetailsPayload(req.body ?? {});
      const updatedAt = nowIso();

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

      await firestore
        .collection(shopsCollection)
        .doc(shopDomain)
        .set({ storeDetails: { ...payload, updatedAt } }, { merge: true });

      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, shopDomain, updatedAt });
    } catch (error) {
      next(error);
    }
  });

  router.get("/store/branding/logo", auth.requireRole(ROLE_SHOP), async (req, res, next) => {
    try {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
      const shopDomain = normalizeShopDomain(storeId);
      if (!shopDomain) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const admin = await getFirebaseAdmin({ env });
      const firestore = admin.firestore();
      const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

      const docRef = firestore.collection(shopsCollection).doc(shopDomain).collection("branding").doc("logo");
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: "logo_not_found" });
        return;
      }

      const data = snap.data() ?? {};
      const contentType = String(data?.contentType ?? "").trim() || "application/octet-stream";
      const buf = coerceBytesToBuffer(data?.data ?? null);
      if (!buf) {
        res.status(404).json({ error: "logo_not_found" });
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", contentType);
      res.status(200).send(buf);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/store/branding/logo",
    auth.requireRole(ROLE_SHOP),
    upload.single("logo"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const storeId = String(req.user?.storeId ?? "").trim().toLowerCase();
        const shopDomain = normalizeShopDomain(storeId);
        if (!shopDomain) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const file = req.file;
        if (!file?.buffer) {
          res.status(400).json({ error: "logo_file_required" });
          return;
        }

        const contentType = String(file.mimetype ?? "").trim().toLowerCase();
        const allowed = new Set(["image/png", "image/jpeg"]);
        if (!allowed.has(contentType)) {
          res.status(400).json({ error: "invalid_logo_type", allowed: ["image/png", "image/jpeg"] });
          return;
        }

        const sizeBytes = Number(file.size ?? file.buffer.length ?? 0) || 0;
        if (sizeBytes <= 0 || sizeBytes > 1 * 1024 * 1024) {
          res.status(400).json({ error: "logo_too_large", maxBytes: 1 * 1024 * 1024 });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

        const docRef = firestore.collection(shopsCollection).doc(shopDomain).collection("branding").doc("logo");
        const updatedAt = nowIso();
        await docRef.set({ contentType, sizeBytes, updatedAt, data: file.buffer }, { merge: true });

        res.setHeader("Cache-Control", "no-store");
        res.status(201).json({ ok: true, shopDomain, sizeBytes, contentType, updatedAt });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
