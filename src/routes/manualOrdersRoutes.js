import { Router } from "express";
import multer from "multer";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ROLE_ADMIN, ROLE_SHOP } from "../auth/roles.js";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { parseCsvRows } from "../orders/import/parseCsvRows.js";
import { assignManualOrders, createManualOrders } from "../orders/manualOrdersService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const JOB_TTL_MS = 30 * 60_000;
const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    const createdAt = Number(job?.createdAtMs ?? 0) || 0;
    if (createdAt && createdAt < cutoff) jobs.delete(id);
  }
}

function createJob({ total, type }) {
  cleanupJobs();
  const id = cryptoRandomId();
  const job = {
    jobId: id,
    type: String(type ?? "orders_import"),
    status: "processing",
    total: Number(total ?? 0) || 0,
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    message: "",
    createdAtMs: Date.now(),
    startedAt: nowIso(),
    finishedAt: "",
    errors: [],
    orders: [],
  };
  jobs.set(id, job);
  return job;
}

function cryptoRandomId() {
  // Small inlined random ID to avoid adding new deps; stable enough for in-memory jobs.
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}_${Math.random()
    .toString(16)
    .slice(2)}`.slice(0, 48);
}

function resolveStoreIdForRequest(req) {
  const role = String(req.user?.role ?? "").trim();
  if (role === ROLE_ADMIN) return String(req.body?.storeId ?? "").trim().toLowerCase();
  return String(req.user?.storeId ?? "").trim().toLowerCase();
}

function detectFileKind(file) {
  const name = String(file?.originalname ?? "").trim().toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  return "";
}

function parseRowsFromFile(file) {
  const kind = detectFileKind(file);
  if (!file?.buffer) throw new Error("file_required");
  if (kind === "csv") return parseCsvRows(file.buffer);
  throw new Error("unsupported_file_type");
}

export function createManualOrdersRouter({ env, auth }) {
  const router = Router();
  const shopsCollection = String(env?.auth?.firebase?.shopsCollection ?? "shops").trim() || "shops";

  router.post(
    "/orders/import",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    upload.single("file"),
    async (req, res) => {
      if (env?.auth?.provider !== "firebase") {
        res.status(400).json({ error: "auth_provider_not_firebase" });
        return;
      }

      const storeId = resolveStoreIdForRequest(req);
      if (!storeId) {
        res.status(400).json({ error: "store_id_required" });
        return;
      }

      const file = req.file;
      if (!file?.buffer) {
        res.status(400).json({ error: "file_required" });
        return;
      }

      let rows = [];
      try {
        rows = parseRowsFromFile(file);
      } catch (error) {
        res.status(400).json({ error: "invalid_file", message: String(error?.message ?? "") });
        return;
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "file_empty" });
        return;
      }
      if (rows.length > 500) {
        res.status(400).json({ error: "file_too_large", limit: 500 });
        return;
      }

      const job = createJob({ total: rows.length, type: "orders_import" });
      res.status(202).json({ jobId: job.jobId, total: job.total });

      setImmediate(async () => {
        const current = jobs.get(job.jobId);
        if (!current) return;
        try {
          const admin = await getFirebaseAdmin({ env });
          const firestore = admin.firestore();
          const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
            storeId,
          });

          const result = await createManualOrders({
            firestore,
            collectionId,
            storeId: normalizedStoreId,
            displayName,
            user: req.user,
            shopsCollection,
            rows,
          });

          current.created = result.created;
          current.updated = result.updated;
          current.failed = result.failed;
          current.errors = result.errors.slice(0, 200);
          current.orders = result.orders.slice(0, 500);
          current.processed = result.total;
          current.status = "done";
          current.finishedAt = nowIso();
        } catch (error) {
          current.status = "failed";
          current.message = String(error?.message ?? "orders_import_failed");
          current.finishedAt = nowIso();
        }
      });
    }
  );

  router.get(
    "/orders/import/jobs/:jobId",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    async (req, res) => {
      const jobId = String(req.params?.jobId ?? "").trim();
      const job = jobs.get(jobId);
      if (!job) {
        res.status(404).json({ error: "job_not_found" });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json(job);
    }
  );

  router.post(
    "/orders/create",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const storeId = resolveStoreIdForRequest(req);
        if (!storeId) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const row = req.body && typeof req.body === "object" ? req.body : {};
        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
          storeId,
        });

        const result = await createManualOrders({
          firestore,
          collectionId,
          storeId: normalizedStoreId,
          displayName,
          user: req.user,
          shopsCollection,
          rows: [row],
        });

        if (result.failed) {
          res.status(422).json({ error: "validation_failed", errors: result.errors, orders: result.orders });
          return;
        }

        res.setHeader("Cache-Control", "no-store");
        res.status(201).json({ ok: true, ...result });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/orders/assign",
    auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const storeId = resolveStoreIdForRequest(req);
        if (!storeId) {
          res.status(400).json({ error: "store_id_required" });
          return;
        }

        const orderKeysRaw = Array.isArray(req.body?.orderKeys) ? req.body.orderKeys : [];
        const orderKeys = orderKeysRaw.map((v) => String(v ?? "").trim()).filter(Boolean);
        if (!orderKeys.length) {
          res.status(400).json({ error: "order_keys_required" });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();
        const { collectionId, displayName, storeId: normalizedStoreId } = getShopCollectionInfo({
          storeId,
        });

        const result = await assignManualOrders({
          firestore,
          collectionId,
          storeId: normalizedStoreId,
          displayName,
          user: req.user,
          orderKeys,
        });

        res.setHeader("Cache-Control", "no-store");
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/orders/manual/order-name/preview", auth.requireAnyRole([ROLE_ADMIN, ROLE_SHOP]), (req, res) => {
    // Reserved for future use (kept to avoid breaking when referenced).
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  });

  return router;
}
