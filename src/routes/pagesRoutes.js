import { Router } from "express";

const html = String.raw;

export function createPagesRouter() {
  const router = Router();

  router.get("/orders", (_req, res) => {
    const assetVersion = "4";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Latest Shopify Orders</title>
    <link rel="stylesheet" href="/static/orders.css?v=${assetVersion}" />
    <script src="/static/orders.js?v=${assetVersion}" defer></script>
  </head>
  <body>
    <main class="container">
      <header class="header">
        <div class="titleBlock">
          <h1>Latest Shopify Orders</h1>
          <div class="storeLine">
            <span class="storeLabel">Store</span>
            <span id="storeName" class="storeName">Loading…</span>
          </div>
        </div>

        <div class="rightBlock">
          <div class="companyName">Haul Riders Courier</div>
          <div class="controls">
            <label class="field">
              <span>Fulfillment</span>
              <select id="fulfillmentFilter">
                <option value="all" selected>All</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="unfulfilled">Unfulfilled</option>
                <option value="partial">Partial</option>
                <option value="null">Unknown</option>
              </select>
            </label>

            <label class="field">
              <span>Tracking</span>
              <select id="trackingFilter">
                <option value="any" selected>Any</option>
                <option value="assigned">Assigned</option>
                <option value="unassigned">Not assigned</option>
              </select>
            </label>

            <label class="field">
              <span>Limit</span>
              <input id="limit" type="number" min="1" max="250" value="10" />
            </label>
            <button id="refresh" class="btn btnPrimary" type="button">Refresh</button>
            <button id="exportCsv" class="btn btnSecondary" type="button">Export CSV</button>
          </div>
        </div>
      </header>

      <section class="card">
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
                <th>Phone Number</th>
                <th>Total Price</th>
                <th class="colSortable" data-sort-key="fulfillmentStatus">
                  Fulfillment Status <span class="sortIndicator" aria-hidden="true"></span>
                </th>
                <th>Tracking Numbers</th>
                <th>Tracking Company</th>
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
