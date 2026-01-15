import { Router } from "express";

const html = String.raw;

export function createPagesRouter({ env } = {}) {
  const router = Router();

  router.get("/orders", (_req, res) => {
    const assetVersion = "7";
    const userName = String(env?.adminName ?? "Haul Riders Admin").trim();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Latest Shopify Orders</title>
    <link rel="stylesheet" href="/static/orders.css?v=${assetVersion}" />
    <link
      rel="icon"
      type="image/png"
      href="/static/logo_haul_riders.png?v=${assetVersion}"
    />
    <script src="/static/orders.js?v=${assetVersion}" defer></script>
  </head>
  <body>
    <header class="topbar">
      <div class="topbarInner">
        <div class="brand">
          <img
            class="brandLogo"
            src="/static/haul_riders_logo.jpeg?v=${assetVersion}"
            alt="Haul Riders"
            decoding="async"
          />
          <div class="brandText">
            <div class="brandTitle">Haul Riders</div>
            <div class="brandSub">Orders dashboard</div>
          </div>
        </div>

        <div class="storePill" aria-live="polite">
          <div class="storePillLabel">Store</div>
          <select id="storeSelect" class="storeSelect" aria-label="Select store"></select>
          <div id="storeName" class="storeName">Loading…</div>
        </div>

        <details class="userMenu" aria-label="User menu">
          <summary class="userMenuSummary">
            <img
              class="userAvatar"
              src="/static/haul_riders_logo.jpeg?v=${assetVersion}"
              alt="User avatar"
              decoding="async"
            />
            <span class="userMenuLabel">${userName}</span>
          </summary>
          <div class="userMenuList">
            <div class="userMenuSection">
              <span class="userMenuTitle">Logged in as</span>
              <strong>${userName}</strong>
            </div>
            <a class="userMenuItem" href="/orders">Dashboard</a>
            <a class="userMenuItem" href="mailto:support@haulriders.com">Support</a>
            <button type="button" class="userMenuItem userMenuButton" data-action="logout">
              Logout
            </button>
          </div>
        </details>
      </div>
    </header>

    <main class="container">
      <section class="panel">
        <div class="panelHeader">
          <div class="panelTitle">
            <h1>Latest Orders</h1>
            <div class="panelHint">Fast view + export for ops and clients</div>
          </div>

          <div class="controls">
            <label class="field">
              <span>Fulfillment</span>
              <select id="fulfillmentFilter">
                <option value="all" selected>All</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="unfulfilled">Unfulfilled</option>
              </select>
            </label>

            <label class="field">
              <span>Tracking</span>
              <select id="trackingFilter">
                <option value="any" selected>Any</option>
                <option value="added">Added</option>
                <option value="not_added">Not Added</option>
              </select>
            </label>

            <label class="field">
              <span>Limit</span>
              <input id="limit" type="number" min="1" max="250" value="10" />
            </label>

            <div class="btnGroup">
              <button id="refresh" class="btn btnPrimary" type="button">Refresh</button>
              <button id="exportCsv" class="btn btnSecondary" type="button">Export CSV</button>
            </div>
          </div>
        </div>

        <div class="metrics" aria-label="Order summary">
          <div class="metric">
            <div class="metricLabel">Showing</div>
            <div id="metricShowing" class="metricValue">—</div>
          </div>
          <div class="metric">
            <div class="metricLabel">Total loaded</div>
            <div id="metricLoaded" class="metricValue">—</div>
          </div>
          <div class="metric">
            <div class="metricLabel">Fulfilled</div>
            <div id="metricFulfilled" class="metricValue">—</div>
          </div>
          <div class="metric">
            <div class="metricLabel">Tracking assigned</div>
            <div id="metricTracking" class="metricValue">—</div>
          </div>
        </div>

        <div id="status" class="status" aria-live="polite"></div>

        <div class="tableWrap">
          <table class="table" aria-label="Latest orders">
            <thead>
              <tr>
                <th class="colCheck">
                  <input id="selectAll" type="checkbox" aria-label="Select all" />
                </th>
                <th>#</th>
                <th class="colSortable" data-sort-key="orderName">
                  Order Name <span class="sortIndicator" aria-hidden="true"></span>
                </th>
                <th>Order ID</th>
                <th>Full Name</th>
                <th>Address 1</th>
                <th>Address 2</th>
                <th>City</th>
                <th>State</th>
                <th>PIN Code</th>
                <th>Phone 1</th>
                <th>Phone 2</th>
                <th>Total Price</th>
                <th class="colSortable" data-sort-key="fulfillmentStatus">
                  Fulfillment Status <span class="sortIndicator" aria-hidden="true"></span>
                </th>
                <th>Tracking Numbers</th>
                <th>Shipments Status</th>
                <th>Courier Partner</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </section>
    </main>
  </body>
</html>`);
  });

  return router;
}
