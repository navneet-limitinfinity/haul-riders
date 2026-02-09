function nowIso() {
  return new Date().toISOString();
}

function normalizeAwb(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Allow alphanumeric; strip spaces and common separators.
  const cleaned = raw.replaceAll(/[^a-zA-Z0-9]/g, "");
  return cleaned.trim();
}

function splitAwbCell(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;|]+/g)
    .map((v) => normalizeAwb(v))
    .filter(Boolean);
}

function normalizeHeaderKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
}

function pickRowValue(row, aliases) {
  const list = Array.isArray(aliases) ? aliases : [];
  for (const key of list) {
    const v = String(row?.[key] ?? "").trim();
    if (v) return v;
  }
  const data = row && typeof row === "object" ? row : {};
  const normalized = new Map();
  for (const [k, vRaw] of Object.entries(data)) {
    const v = String(vRaw ?? "").trim();
    if (!v) continue;
    const nk = normalizeHeaderKey(k);
    if (!nk) continue;
    if (!normalized.has(nk)) normalized.set(nk, v);
  }
  for (const key of list) {
    const nk = normalizeHeaderKey(key);
    if (!nk) continue;
    const v = normalized.get(nk);
    if (v) return v;
  }
  return "";
}

export const AWB_POOL_CATEGORIES = {
  Z_EXPRESS: "z_express",
  D_PREPAID: "d_prepaid",
  D_COD: "d_cod",
};

export function courierTypeToAwbCategory(courierType) {
  const v = String(courierType ?? "").trim();
  if (v === "Z- Express") return AWB_POOL_CATEGORIES.Z_EXPRESS;
  if (v === "D- Surface" || v === "D- Air") return AWB_POOL_CATEGORIES.D_PREPAID;
  if (v === "COD Surface" || v === "COD Air") return AWB_POOL_CATEGORIES.D_COD;
  // Default bucket when courier type is missing/unknown.
  return AWB_POOL_CATEGORIES.D_PREPAID;
}

export function parseAwbPoolRows(rows) {
  const input = Array.isArray(rows) ? rows : [];
  const out = [];

  const zAliases = ["Z - Express", "Z- Express", "Z Express", "zExpress", "z_express"];
  const dAliases = ["D - Surface/D - Air", "D- Surface/D- Air", "D Surface/D Air", "dPrepaid", "d_prepaid"];
  const codAliases = ["COD Surface/COD Air", "COD Surface / COD Air", "cod", "dCod", "d_cod"];

  for (const row of input) {
    const zCell = pickRowValue(row, zAliases);
    const dCell = pickRowValue(row, dAliases);
    const codCell = pickRowValue(row, codAliases);

    for (const awb of splitAwbCell(zCell)) out.push({ awbNumber: awb, category: AWB_POOL_CATEGORIES.Z_EXPRESS });
    for (const awb of splitAwbCell(dCell)) out.push({ awbNumber: awb, category: AWB_POOL_CATEGORIES.D_PREPAID });
    for (const awb of splitAwbCell(codCell)) out.push({ awbNumber: awb, category: AWB_POOL_CATEGORIES.D_COD });
  }

  // Deduplicate by awbNumber (last category wins if duplicated).
  const map = new Map();
  for (const e of out) {
    const awb = normalizeAwb(e.awbNumber);
    if (!awb) continue;
    map.set(awb, { awbNumber: awb, category: e.category });
  }
  return Array.from(map.values());
}

export async function uploadAwbPoolCsv({
  firestore,
  rows,
  uploadedBy,
}) {
  const entries = parseAwbPoolRows(rows);
  if (!entries.length) return { total: 0, created: 0, updated: 0, skipped: 0 };
  if (entries.length > 10_000) throw new Error("awb_pool_too_large");

  const col = firestore.collection("awbPool");
  const ts = nowIso();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Read existing docs in chunks to avoid overwriting assigned markers.
  const chunkSize = 200;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    const refs = chunk.map((e) => col.doc(e.awbNumber));
    const snaps = await firestore.getAll(...refs);

    const batch = firestore.batch();
    for (let j = 0; j < chunk.length; j += 1) {
      const e = chunk[j];
      const ref = refs[j];
      const snap = snaps[j];
      if (snap?.exists) {
        batch.set(
          ref,
          {
            awbNumber: e.awbNumber,
            category: e.category,
            updatedAt: ts,
            lastUploadedAt: ts,
            lastUploadedBy: uploadedBy || null,
          },
          { merge: true }
        );
        updated += 1;
      } else {
        batch.set(
          ref,
          {
            awbNumber: e.awbNumber,
            category: e.category,
            assigned: false,
            assignedAt: "",
            assignedDocId: "",
            releasedAt: "",
            createdAt: ts,
            updatedAt: ts,
            lastUploadedAt: ts,
            lastUploadedBy: uploadedBy || null,
          },
          { merge: true }
        );
        created += 1;
      }
    }
    await batch.commit();
  }

  return { total: entries.length, created, updated, skipped };
}

export async function allocateAwbFromPool({
  firestore,
  courierType,
  docId,
  assignedStoreId = "",
  orderId = "",
}) {
  const category = courierTypeToAwbCategory(courierType);
  const col = firestore.collection("awbPool");
  const ts = nowIso();

  const result = await firestore.runTransaction(async (tx) => {
    const q = col.where("category", "==", category).where("assigned", "==", false).limit(1);
    const snap = await tx.get(q);
    const doc = snap.docs?.[0] ?? null;
    if (!doc) {
      const err = new Error("awb_unavailable");
      err.code = "awb_unavailable";
      throw err;
    }
    const awbNumber = String(doc.id ?? doc.data()?.awbNumber ?? "").trim();
    tx.set(
      doc.ref,
      {
        assigned: true,
        assignedAt: ts,
        assignedDocId: String(docId ?? "").trim(),
        assignedStoreId: String(assignedStoreId ?? "").trim().toLowerCase(),
        orderId: String(orderId ?? "").trim(),
        updatedAt: ts,
      },
      { merge: true }
    );
    return { awbNumber, category };
  });

  return result;
}

export async function releaseAwbToPool({
  firestore,
  awbNumber,
  docId = "",
}) {
  const awb = normalizeAwb(awbNumber);
  if (!awb) throw new Error("awb_required");
  const col = firestore.collection("awbPool");
  const ref = col.doc(awb);
  const ts = nowIso();
  await ref.set(
    {
      assigned: false,
      releasedAt: ts,
      assignedAt: "",
      assignedDocId: "",
      assignedStoreId: "",
      orderId: "",
      updatedAt: ts,
      releasedByDocId: String(docId ?? "").trim() || "",
    },
    { merge: true }
  );
  return { ok: true, awbNumber: awb };
}
