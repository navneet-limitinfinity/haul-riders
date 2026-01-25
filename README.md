# haul-riders

Small Node.js (Express) service scaffold designed for:
- local development on `localhost`
- straightforward deployment to a private server behind your domain (via Nginx/Apache reverse proxy)

It includes a minimal Shopify Admin API client and a sample route to verify your credentials.

## Highlights
- Functional style (no classes) with clear camelCase names
- Centralized environment parsing in `src/config/env.js`
- Structured JSON logs via `src/logging/createLogger.js`
- Easy production options: Docker, PM2, or systemd + Nginx

## Requirements
- Node.js `>= 18`
- npm `>= 8`

## Setup
1) Install dependencies:
```bash
npm install
```

2) Create your `.env` file:
```bash
cp .env.example .env
```

3) Edit `.env` and set:
- `SHOPIFY_STORE` (example: `your-store.myshopify.com`)
- `SHOPIFY_TOKEN` (your Admin API access token)
  - Alternatively, for multi-store, set `STORES_FILE` and use a per-store token env var.

## Run locally
Development (auto-reload):
```bash
npm run dev
```

Production-like:
```bash
npm start
```

Server will listen on `http://localhost:3000` by default (configurable via `PORT`).

## Useful endpoints
- `GET /health` → health check
- `GET /api/shopify/shop` → fetches shop details from Shopify Admin REST API
- `GET /api/shopify/debug` → shows effective shop + token scopes + order count (useful for troubleshooting “missing orders”)
- `GET /oauth/install?shop=<shop>.myshopify.com` → hosted Shopify OAuth install (stores token in Firestore `shops/<shop>.myshopify.com`)
- `GET /oauth/callback` → OAuth callback handler (called by Shopify)
- `GET /login` → login page (Firebase Auth when configured)
- `POST /api/auth/sessionLogin` → exchanges Firebase ID token for an HTTP-only session cookie
- `GET /api/me` → current user (role + storeId)
- `GET /api/shipments/label.pdf?orderKey=...` → on-demand 4x6 shipping label PDF
  - Admin: `GET /api/shipments/label.pdf?orderKey=...&storeId=...`
- `GET /shop/orders` → shop (client) orders dashboard
- `GET /admin/orders` → admin orders dashboard
  - Multi-store (admin): `GET /admin/orders?store=<storeId>`

## Multi-store setup (single server, multiple shops)
1) Create a stores config file (copy `stores.example.json` to `stores.json`).
2) Add `stores.json` to `.gitignore` (already ignored by default).
3) In `.env`, set `STORES_FILE=./stores.json`.
4) Provide tokens:
   - Recommended: in `stores.json` use `tokenEnvVar` per store (ex: `SHOPIFY_TOKEN_VAIDIKI`) and set those env vars in `.env`.
   - Alternatively (less recommended): put `token` directly in `stores.json`.
5) Start the server and switch stores using the dropdown in the header or `?store=...`.

## Troubleshooting
### “Only a few orders show up”
1) Open `http://localhost:3000/api/shopify/debug`
2) Confirm:
   - `shop.myshopify_domain` is the store you expect
   - `accessScopes` includes `read_all_orders` (otherwise Shopify may only return recent orders)
3) If scopes are missing, update scopes in Shopify and generate/rotate the Admin API token, then update `.env` and restart the server.

## Terminal scripts
Fetch latest 10 orders and print to terminal:
```bash
npm run orders:latest
```

## Environment variables
- `PORT` (default `3000`) and `HOST` (default `0.0.0.0`)
- `LOG_LEVEL` one of `debug | info | warn | error` (default `info`)
- `TRUST_PROXY` set to `true` when running behind Nginx/Apache (default `false`)
- `SHOPIFY_TIMEOUT_MS` request timeout in milliseconds (default `10000`)
- `SHOPIFY_MAX_RETRIES` retries for transient Shopify errors (default `2`, range `0..5`)
- Shipping label:
  - `SHIP_FROM_*` values used in the label “FROM” block (optional; can also be set per-store in `stores.json` via `shipFrom`)
  - `SHIP_LABEL_LOGO_URL` optional image URL for the label (example: `/static/haul_riders_logo.jpeg`)
  - PDF template: `src/public/Blank Docket.pdf` is used as the background, and dynamic fields are overlaid using coordinates extracted from `src/public/Sample Docket.pdf` into `src/shipments/label/docketTemplateMap.json`.
- Shopify OAuth install (Dev Dashboard apps):
  - `SHOPIFY_OAUTH_API_KEY` (OAuth client id)
  - `SHOPIFY_OAUTH_API_SECRET` (OAuth client secret; comma-separated allowed for rotated secrets)
  - `SHOPIFY_OAUTH_SCOPES` (default `read_orders`)
  - `SHOPIFY_OAUTH_REDIRECT_URI` (optional; if empty, derived from request host as `https://<host>/oauth/callback`)
- Auth:
  - `AUTH_PROVIDER` one of `none | dev | firebase` (default `dev`)
  - `AUTH_REQUIRED` (`true|false`, default `true`)
  - Dev auth (local only):
    - `DEV_AUTH_ROLE` (`shop|admin`, default `shop`)
    - `DEV_AUTH_STORE_ID` (recommended for multi-store shop accounts)
  - Firebase auth:
    - `FIREBASE_USERS_COLLECTION` (default `users`)
    - `FIREBASE_SHOPS_COLLECTION` (default `shops`)
    - `FIREBASE_WEB_CONFIG_JSON` (Firebase web config JSON, used by `/login`)
    - Server verification credentials (choose one):
      - `FIREBASE_ADMIN_CREDENTIALS_FILE` (path to service account JSON)
      - `FIREBASE_ADMIN_CREDENTIALS_JSON` (service account JSON)
      - or `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

## Run with Docker (recommended for production)
1) Create `.env` (or set env vars via your orchestrator):
```bash
cp .env.example .env
```

2) Build and run:
```bash
docker compose up -d --build
```

Notes:
- `docker-compose.yml` binds `./shipments_state.json` into the container so state persists across restarts.
- If you use Firebase Admin via file, set `FIREBASE_ADMIN_CREDENTIALS_FILE` to a path inside the container (example: `/run/secrets/firebase-admin.json`) and mount it as a volume/secret.
- If you use multi-store, mount your `stores.json` and set `STORES_FILE=/app/stores.json`.

## Deploy to server without source code (Docker image)
This repo publishes a Docker image to GHCR (`ghcr.io/<owner>/<repo>`) on every push to `main` (see `.github/workflows/docker-image.yml`).

### 1) Install Docker on Ubuntu
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

### 2) Create server directory (no source code)
On your server, you only need a small folder like:
```
/opt/haul-riders/
  .env
  shipments_state.json
  secrets/firebase-admin.json
  docker-compose.yml
```

### 3) Create the folder + files
```bash
sudo mkdir -p /opt/haul-riders/secrets
sudo nano /opt/haul-riders/.env
sudo nano /opt/haul-riders/secrets/firebase-admin.json
sudo touch /opt/haul-riders/shipments_state.json
```

### 4) Create `/opt/haul-riders/docker-compose.yml`
```bash
sudo tee /opt/haul-riders/docker-compose.yml >/dev/null <<'YML'
services:
  haul-riders:
    image: ghcr.io/<owner>/<repo>:latest
    ports:
      - "3000:3000"
    env_file:
      - /opt/haul-riders/.env
    volumes:
      - /opt/haul-riders/shipments_state.json:/app/shipments_state.json
      - /opt/haul-riders/secrets/firebase-admin.json:/run/secrets/firebase-admin.json:ro
    restart: unless-stopped
YML
```

### 5) Configure `/opt/haul-riders/.env`
Minimum required for Firebase login:
- `AUTH_PROVIDER=firebase`
- `FIREBASE_WEB_CONFIG_JSON={...}` (Firebase Console → Project settings → Web app config)
- `FIREBASE_ADMIN_CREDENTIALS_FILE=/run/secrets/firebase-admin.json`

Also set your Shopify values (`SHOPIFY_STORE`, `SHOPIFY_TOKEN`) and any multi-store values if used.

### 6) Fix secret file permissions (required)
The container runs as a non-root user. Ensure it can read the service account file:
```bash
sudo chown 1000:1000 /opt/haul-riders/secrets/firebase-admin.json
sudo chmod 600 /opt/haul-riders/secrets/firebase-admin.json
```

If your server user is not UID 1000, use the UID that matches your Docker host user:
```bash
id -u
```

### 7) Start + verify
```bash
cd /opt/haul-riders
docker compose -f /opt/haul-riders/docker-compose.yml pull
docker compose -f /opt/haul-riders/docker-compose.yml up -d
docker compose -f /opt/haul-riders/docker-compose.yml logs -f --tail=200
curl -s http://localhost:3000/health
```

### If GHCR image is private
Log in once on the server so it can pull from GHCR:
```bash
docker login ghcr.io -u <github-username> -p <PAT-with-packages:read>
```

## Deployment notes (private server + domain)
### Option A: PM2 (simple)
1) Copy project to your server and install deps:
```bash
npm ci --omit=dev
```

2) Set environment variables (recommended via your process manager), then run with a process manager:
- `pm2` example:
```bash
npm i -g pm2
pm2 start src/server.js --name haul-riders
pm2 save
```

You can also use `deploy/pm2/ecosystem.config.cjs`:
```bash
pm2 start deploy/pm2/ecosystem.config.cjs
pm2 save
```

### Option B: systemd (most robust)
1) Copy project to `/opt/haul-riders`:
```bash
sudo mkdir -p /opt/haul-riders
sudo rsync -a --delete ./ /opt/haul-riders/
sudo chown -R $USER:$USER /opt/haul-riders
```

2) Install production deps:
```bash
cd /opt/haul-riders
npm ci --omit=dev
```

3) Create `/opt/haul-riders/.env` (do not commit it).

4) Install the service file (edit paths if needed):
```bash
sudo cp deploy/systemd/haul-riders.service /etc/systemd/system/haul-riders.service
sudo systemctl daemon-reload
sudo systemctl enable --now haul-riders
sudo systemctl status haul-riders
```

Logs:
```bash
sudo journalctl -u haul-riders -f
```

### Reverse proxy (Nginx)
Put Nginx in front so you can attach a domain + TLS:
```nginx
server {
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Full example is in `deploy/nginx/haul-riders.conf`.

## Project layout
- `src/server.js` entry point (loads env, starts server)
- `src/app.js` Express app builder (middleware + routes)
- `src/routes/*` HTTP routes
- `src/shopify/*` Shopify client helpers
