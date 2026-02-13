import { Router } from "express";

const html = String.raw;

export function createAuthRouter({ env }) {
  const router = Router();
  const logLevel = String(env?.logLevel ?? "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  const debugFooter = logLevel === "debug" || nodeEnv !== "production";

  router.get("/auth/firebase-config.js", (_req, res) => {
    const firebaseConfigJson = String(env?.auth?.firebase?.webConfigJson ?? "").trim();
    let firebaseConfig = null;
    let firebaseConfigError = "";
    if (firebaseConfigJson) {
      try {
        firebaseConfig = JSON.parse(firebaseConfigJson);
      } catch (error) {
        firebaseConfigError = String(error?.message ?? error);
      }
    }

    const configLiteral =
      firebaseConfig == null
        ? "null"
        : JSON.stringify(firebaseConfig).replaceAll("<", "\\u003c");
    const configErrorLiteral = firebaseConfigError
      ? JSON.stringify(firebaseConfigError).replaceAll("<", "\\u003c")
      : "null";

    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(
      `window.__FIREBASE_WEB_CONFIG__ = ${configLiteral};\nwindow.__FIREBASE_WEB_CONFIG_ERROR__ = ${configErrorLiteral};\n`
    );
  });

  router.get("/auth/firebase-config.json", (_req, res) => {
    const firebaseConfigJson = String(env?.auth?.firebase?.webConfigJson ?? "").trim();
    if (!firebaseConfigJson) {
      res.setHeader("Cache-Control", "no-store");
      res.status(404).json({ error: "firebase_web_config_missing" });
      return;
    }

    try {
      const config = JSON.parse(firebaseConfigJson);
      res.setHeader("Cache-Control", "no-store");
      res.json({ config });
    } catch (error) {
      res.setHeader("Cache-Control", "no-store");
      res.status(400).json({ error: "firebase_web_config_invalid", details: String(error?.message ?? error) });
    }
  });

  router.get("/login", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Haul Riders — Sign in</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 28px 16px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
        background: #0b1220;
        color: #e6edf7;
      }
      .card {
        width: min(380px, 100%);
        min-height: 520px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 16px;
        padding: 26px 22px;
        background: rgba(255,255,255,.04);
        box-shadow: 0 18px 50px rgba(0,0,0,.35);
      }
      .brand {
        display: grid;
        gap: 10px;
        justify-items: center;
        text-align: center;
        margin-bottom: 14px;
      }
      .brandLogo {
        width: 84px;
        height: 84px;
        border-radius: 18px;
        box-shadow: 0 12px 24px rgba(0,0,0,.25);
      }
      .title { font-size: 22px; font-weight: 900; letter-spacing: .2px; margin: 0; }
      .subtitle { margin: 0; font-size: 13px; opacity: .85; line-height: 1.4; }
      .muted { opacity: .8; font-size: 12px; }
      .row { display: grid; gap: 10px; margin-top: 12px; padding: 0 16px; }
      label { display: grid; gap: 6px; }
      input {
        width: 100%;
        height: 42px;
        padding: 8px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.16);
        background: rgba(0,0,0,.16);
        color: inherit;
        outline: none;
      }
      input:focus { border-color: rgba(106,166,255,.75); box-shadow: 0 0 0 3px rgba(106,166,255,.18); }
      .actions { display: flex; justify-content: center; margin-top: 4px; }
      button {
        height: 36px;
        padding: 0 14px;
        border-radius: 12px;
        border: 1px solid rgba(106,166,255,.55);
        background: rgba(106,166,255,.14);
        cursor: pointer;
        font-weight: 800;
        color: inherit;
      }
      button:hover { border-color: rgba(106,166,255,.85); background: rgba(106,166,255,.2); }
      button:disabled { opacity: .6; cursor: not-allowed; }
      #status { text-align: center; min-height: 16px; }
    </style>
    ${
      debugFooter
        ? html`
            <link rel="stylesheet" href="/static/debug-footer.css?v=1" />
            <script src="/static/debug-footer.js?v=1" defer></script>
          `
        : ""
    }
  </head>
  <body data-debug-footer="${debugFooter ? "1" : "0"}">
    <div class="card">
      <div class="brand">
        <img class="brandLogo" src="/static/icon.png" alt="Haul Riders" decoding="async" />
        <h1 class="title">Haul Riders</h1>
        <p class="subtitle">Sign in to ship your Shopify store orders faster.</p>
      </div>

      <div class="row">
        <label>
          <div class="muted">Email</div>
          <input id="email" type="email" autocomplete="email" />
        </label>
        <label>
          <div class="muted">Password</div>
          <input id="password" type="password" autocomplete="current-password" />
        </label>
        <div class="actions">
          <button id="login" type="button">Sign in</button>
        </div>
        <div id="status" class="muted"></div>
      </div>
    </div>

    <script src="/auth/firebase-config.js"></script>
    <script type="module" src="/static/login.js?v=6"></script>
  </body>
</html>`);
  });

  return router;
}
