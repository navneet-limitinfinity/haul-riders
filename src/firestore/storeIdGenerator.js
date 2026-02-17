const STORE_ID_COUNTERS_COLLECTION = "storeIdCounters";
const STORE_ID_PREFIX = "956";

const padTwo = (value) => String(value ?? "").padStart(2, "0");

const normalizeString = (value) => String(value ?? "").trim();

/**
 * Ensures the Firestore doc for the given shop domain (if provided) has a storeId.
 * If the doc already has an ID, that value is returned; otherwise we allocate a new
 * ID using the monthly counter algorithm and persist it under shops/<storeId>.
 */
export async function ensureStoreIdForShop({
  firestore,
  shopsCollection,
  shopDomain,
  referenceDate = new Date(),
}) {
  if (!firestore || !shopsCollection) return "";
  const normalizedDomain = normalizeString(shopDomain).toLowerCase();
  const domainRef = normalizedDomain
    ? firestore.collection(shopsCollection).doc(normalizedDomain)
    : null;
  const countersCol = firestore.collection(STORE_ID_COUNTERS_COLLECTION);
  const year = referenceDate.getFullYear();
  const yearSuffix = String(year).slice(-2);
  const monthNumber = referenceDate.getMonth() + 1;
  const monthKey = `${year}-${padTwo(monthNumber)}`;

  return firestore.runTransaction(async (tx) => {
    let domainSnap = null;
    let domainData = null;
    if (domainRef) {
      domainSnap = await tx.get(domainRef);
      domainData = domainSnap.exists ? domainSnap.data() ?? {} : null;
      const existingId = normalizeString(domainData?.storeId ?? "");
      if (existingId) {
        return existingId;
      }
    }

    const counterRef = countersCol.doc(monthKey);
    const counterSnap = await tx.get(counterRef);
    const nextSerial = Number(counterSnap?.data()?.nextSerial ?? 1);
    const serialStr = padTwo(nextSerial);
    const newStoreId = `${STORE_ID_PREFIX}${yearSuffix}${padTwo(monthNumber)}${serialStr}`;

    const targetRef = firestore.collection(shopsCollection).doc(newStoreId);
    const baseData = domainData ? { ...domainData } : {};
    const mergedData = {
      ...baseData,
      storeId: newStoreId,
      storeDomain: normalizedDomain,
    };

    tx.set(counterRef, { nextSerial: nextSerial + 1 }, { merge: true });
    tx.set(targetRef, mergedData, { merge: true });
    if (domainRef && domainSnap?.exists) {
      tx.delete(domainRef);
    }

    return newStoreId;
  });
}
