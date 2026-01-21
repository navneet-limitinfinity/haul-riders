import fs from "node:fs/promises";

export async function getFirebaseAdmin({ env }) {
  let mod;
  try {
    mod = await import("firebase-admin");
  } catch (error) {
    const message = String(error?.message ?? error ?? "").trim();
    const hint =
      message.includes("requires Node") || message.includes("Unsupported engine")
        ? " (check your Node.js version; firebase-admin requires Node 18+)"
        : "";
    throw new Error(`Failed to import 'firebase-admin': ${message || "unknown error"}${hint}`);
  }
  const admin = mod.default ?? mod;

  if (admin.apps?.length) return admin;

  let credential = null;
  if (env.auth.firebase.adminCredentialsFile) {
    const raw = await fs.readFile(env.auth.firebase.adminCredentialsFile, "utf8");
    const parsed = JSON.parse(raw);
    credential = admin.credential.cert(parsed);
  } else if (env.auth.firebase.adminCredentialsJson) {
    const rawValue = String(env.auth.firebase.adminCredentialsJson).trim();
    if (rawValue.startsWith("{") || rawValue.startsWith("[")) {
      const parsed = JSON.parse(rawValue);
      credential = admin.credential.cert(parsed);
    } else {
      const raw = await fs.readFile(rawValue, "utf8");
      const parsed = JSON.parse(raw);
      credential = admin.credential.cert(parsed);
    }
  } else if (
    env.auth.firebase.projectId &&
    env.auth.firebase.clientEmail &&
    env.auth.firebase.privateKey
  ) {
    credential = admin.credential.cert({
      projectId: env.auth.firebase.projectId,
      clientEmail: env.auth.firebase.clientEmail,
      privateKey: env.auth.firebase.privateKey,
    });
  }

  if (!credential) {
    throw new Error(
      "Firebase admin credentials missing; set FIREBASE_ADMIN_CREDENTIALS_FILE or FIREBASE_ADMIN_CREDENTIALS_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY"
    );
  }

  admin.initializeApp({ credential });
  return admin;
}
