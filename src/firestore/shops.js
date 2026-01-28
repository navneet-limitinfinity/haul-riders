import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";

const normalizeDomain = (domain) => String(domain ?? "").trim().toLowerCase();

export async function getShopDoc({ env, shopDomain }) {
  const domain = normalizeDomain(shopDomain);
  if (!domain) return null;
  if (env?.auth?.provider !== "firebase") return null;

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = String(env.auth.firebase.shopsCollection ?? "shops").trim() || "shops";

  const snap = await firestore.collection(shopsCollection).doc(domain).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return { id: snap.id, data };
}

