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
        <h1>Latest Shopify Orders</h1>
        <div class="controls">
          <label class="field">
            <span>Limit</span>
            <input id="limit" type="number" min="1" max="250" value="10" />
          </label>
          <button id="refresh" type="button">Refresh</button>
          <button id="exportCsv" type="button">Export CSV</button>
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
                <th>Order Name</th>
                <th>Order ID</th>
                <th>Shipping Address</th>
                <th>Total Price</th>
                <th>Fulfillment Status</th>
                <th>Tracking Number</th>
                <th>Tracking Numbers</th>
                <th>Tracking Company</th>
                <th>Phone</th>
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
