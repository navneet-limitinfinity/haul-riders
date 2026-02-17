import { loadEnv } from "../src/config/env.js";
import { getFirebaseAdmin } from "../src/auth/firebaseAdmin.js";

async function main() {
  const env = loadEnv(process.env);
  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = env.auth.firebase.shopsCollection;

  console.log(`Scanning collection: ${shopsCollection}`);
  const snapshot = await firestore.collection(shopsCollection).get();
  let moved = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    const brandRef = doc.ref.collection("branding").doc("logo");
    const brandSnap = await brandRef.get();
    if (!brandSnap.exists) continue;

    const storeId = String(data?.storeId ?? "").trim();
    const targetDocId = storeId || doc.id;
    if (!targetDocId || targetDocId === doc.id) continue;

    const targetRef = firestore
      .collection(shopsCollection)
      .doc(targetDocId)
      .collection("branding")
      .doc("logo");
    const targetSnap = await targetRef.get();
    if (targetSnap.exists) continue;

    await targetRef.set(brandSnap.data() ?? {}, { merge: true });
    await brandRef.delete();
    moved += 1;
    console.log(`Moved logo from ${doc.id} to ${targetDocId}`);
  }

  console.log(`Migration complete. ${moved} logo(s) moved.`);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
