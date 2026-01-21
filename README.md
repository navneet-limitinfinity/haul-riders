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
- `GET /login` → login page (Firebase Auth when configured)
- `POST /api/auth/sessionLogin` → exchanges Firebase ID token for an HTTP-only session cookie
- `GET /api/me` → current user (role + storeId)
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

## Run with Docker (optional)
Build and run:
```bash
docker compose up --build
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
