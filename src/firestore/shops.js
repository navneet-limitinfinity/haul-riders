import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";

const normalizeValue = (value) => String(value ?? "").trim().toLowerCase();

export async function getShopDoc({ env, storeId }) {
  const normalized = normalizeValue(storeId);
  if (!normalized) return null;
  if (env?.auth?.provider !== "firebase") return null;

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

  let docRef = firestore.collection(shopsCollection).doc(normalized);
  let snap = await docRef.get();

  if (!snap.exists) {
    const queryByStoreId = await firestore
      .collection(shopsCollection)
      .where("storeId", "==", normalized)
      .limit(1)
      .get();
    if (!queryByStoreId.empty) {
      docRef = queryByStoreId.docs[0].ref;
      snap = queryByStoreId.docs[0];
    }
  }

  if (!snap.exists) {
    const domainQuery = await firestore
      .collection(shopsCollection)
      .where("storeDomain", "==", normalized)
      .limit(1)
      .get();
    if (!domainQuery.empty) {
      docRef = domainQuery.docs[0].ref;
      snap = domainQuery.docs[0];
    }
  }

  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return { id: snap.id, data, docRef };
}
