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
- `GET /` → service info (quick sanity check)

## Terminal scripts
Fetch latest 10 orders and print to terminal:
```bash
npm run orders:latest
```

## Environment variables
- `PORT` (default `3000`) and `HOST` (default `0.0.0.0`)
- `LOG_LEVEL` one of `debug | info | warn | error` (default `info`)
- `TRUST_PROXY` set to `true` when running behind Nginx/Apache (default `false`)

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
