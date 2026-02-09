import { Router } from "express";
import multer from "multer";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { parseCsvRows } from "../orders/import/parseCsvRows.js";
import { uploadAwbPoolCsv } from "../awb/awbPoolService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export function createAwbPoolRouter({ env, auth }) {
  const router = Router();

  router.post(
    "/admin/awb-pool/upload",
    auth.requireRole("admin"),
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (env?.auth?.provider !== "firebase") {
          res.status(400).json({ error: "auth_provider_not_firebase" });
          return;
        }

        const file = req.file;
        if (!file?.buffer) {
          res.status(400).json({ error: "file_required" });
          return;
        }

        // CSV only (XLSX explicitly not supported).
        const name = String(file?.originalname ?? "").toLowerCase();
        if (!name.endsWith(".csv")) {
          res.status(400).json({ error: "unsupported_file_type" });
          return;
        }

        let rows = [];
        try {
          rows = parseCsvRows(file.buffer);
        } catch (error) {
          res.status(400).json({ error: "invalid_csv", message: String(error?.message ?? "") });
          return;
        }

        const admin = await getFirebaseAdmin({ env });
        const firestore = admin.firestore();

        const result = await uploadAwbPoolCsv({
          firestore,
          rows,
          uploadedBy: {
            uid: String(req.user?.uid ?? ""),
            email: String(req.user?.email ?? ""),
            role: String(req.user?.role ?? ""),
          },
        });

        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, ...result });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
