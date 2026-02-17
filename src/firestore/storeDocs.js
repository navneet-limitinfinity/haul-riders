const DEFAULT_SHOPS_COLLECTION = "shops";

const normalizeStoreIdValue = (value) => String(value ?? "").trim().toLowerCase();

export function getShopsCollectionName(env) {
  const candidate = String(env?.auth?.firebase?.shopsCollection ?? DEFAULT_SHOPS_COLLECTION).trim();
  return candidate || DEFAULT_SHOPS_COLLECTION;
}

const normalizeString = (value) => String(value ?? "").trim();

export async function loadStoreDoc({ env, firestore, storeId }) {
  if (!firestore || !env) return null;
  const normalized = normalizeStoreIdValue(storeId);
  if (!normalized) return null;

  const shopsCollection = getShopsCollectionName(env);
  const directSnap = await firestore.collection(shopsCollection).doc(normalized).get();
  if (directSnap.exists) return directSnap;

  const byStoreId = await firestore
    .collection(shopsCollection)
    .where("storeId", "==", normalized)
    .limit(1)
    .get();
  if (!byStoreId.empty) return byStoreId.docs[0];

  const byDomain = await firestore
    .collection(shopsCollection)
    .where("storeDomain", "==", normalized)
    .limit(1)
    .get();
  if (!byDomain.empty) return byDomain.docs[0];

  return null;
}
