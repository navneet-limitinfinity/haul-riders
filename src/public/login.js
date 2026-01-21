const $ = (id) => document.getElementById(id);

function setStatus(message) {
  const el = $("status");
  if (!el) return;
  el.textContent = String(message ?? "");
}

function setDebug(value) {
  const el = $("debug");
  if (!el) return;
  el.textContent = String(value ?? "");
}

function normalizeUserMessage(message) {
  let text = String(message ?? "").trim();
  text = text.replace(/^FirebaseError:\s*/i, "");
  text = text.replace(/^Firebase:\s*/i, "");
  text = text.replace(/\bfirebase=/gi, "code=");
  return text || "Login failed.";
}

async function fetchMe() {
  const res = await fetch("/api/me", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to fetch /api/me");
  return data;
}

async function createSession(idToken) {
  const res = await fetch("/api/auth/sessionLogin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const cloned = res.clone();
  const data = await cloned.json().catch(() => null);
  const rawText = await res.text().catch(() => "");
  if (!res.ok) {
    const code = String(data?.error ?? "session_login_failed").trim();
    const firebaseCode = String(data?.firebaseCode ?? "").trim();
    const details = String(data?.details ?? "").trim();
    const text =
      rawText && rawText.length < 500 ? rawText : rawText.slice(0, 500);

    const suffix = [
      `http=${res.status}`,
      firebaseCode && `code=${firebaseCode}`,
      details,
      !data && text ? `body=${text}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(`${code} ${suffix}`.trim());
  }
  return data ?? {};
}

window.addEventListener("DOMContentLoaded", () => {
  const configError = String(window.__FIREBASE_WEB_CONFIG_ERROR__ ?? "").trim();
  if (configError) {
    setStatus("Invalid FIREBASE_WEB_CONFIG_JSON (must be valid JSON).");
    setDebug(configError);
    return;
  }

  const firebaseConfig = window.__FIREBASE_WEB_CONFIG__ ?? null;
  if (!firebaseConfig) {
    setStatus("Firebase login not configured (missing FIREBASE_WEB_CONFIG_JSON).");
    setDebug(
      [
        "Set env vars:",
        "- AUTH_PROVIDER=firebase",
        "- AUTH_REQUIRED=true",
        "- FIREBASE_WEB_CONFIG_JSON={...}",
        "- FIREBASE_ADMIN_CREDENTIALS_JSON={...}",
        "- FIREBASE_USERS_COLLECTION=users",
        "",
        "For local dev without Firebase:",
        "- AUTH_PROVIDER=dev",
        "- DEV_AUTH_ROLE=shop",
        "- DEV_AUTH_STORE_ID=<storeId>",
      ].join("\n")
    );
    return;
  }

  $("login")?.addEventListener("click", async () => {
    const email = String($("email")?.value ?? "").trim();
    const password = String($("password")?.value ?? "");
    if (!email || !password) {
      setStatus("Enter email + password.");
      return;
    }

    setStatus("Signing in…");
    try {
      const { initializeApp } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"
      );
      const { getAuth, signInWithEmailAndPassword } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
      );
      const { getAnalytics, isSupported } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js"
      );

      const app = initializeApp(firebaseConfig);
      if (await isSupported().catch(() => false)) {
        try {
          getAnalytics(app);
        } catch {
          // ignore analytics issues (CSP, unsupported env, etc.)
        }
      }
      const auth = getAuth(app);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();

      await createSession(idToken);

      const me = await fetchMe();
      setDebug(JSON.stringify(me, null, 2));

      if (String(me?.role ?? "") === "admin") {
        window.location.assign("/admin/orders");
      } else {
        window.location.assign("/shop/orders");
      }
    } catch (error) {
      setStatus(normalizeUserMessage(error?.message));
      setDebug(String(error?.stack ?? error));
    }
  });
});
