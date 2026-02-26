#!/usr/bin/env node
import { loadEnv } from "../src/config/env.js";
import { getFirebaseAdmin } from "../src/auth/firebaseAdmin.js";

async function main() {
  const hrGid = process.argv.find((arg) => !arg.startsWith("--") && arg.match(/^\d+$/)) ?? "";
  const showData = process.argv.includes("--show-data");

  if (!hrGid) {
    console.error("Usage: node scripts/getConsignmentKeys.js <hrGid> [--show-data]");
    process.exit(1);
  }

  const env = loadEnv(process.env);
  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const docRef = firestore.collection("consignments").doc(String(hrGid));
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    console.error(`Document hrGid=${hrGid} not found in collection "consignments".`);
    process.exit(1);
  }

  const data = snapshot.data() ?? {};
  console.log(`Document ${hrGid} keys:`);
  console.log(Object.keys(data).sort().join(", "));
  if (showData) {
    console.log("\n=== full document ===");
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch((error) => {
  console.error("Failed to fetch consignment:", error);
  process.exit(1);
});
