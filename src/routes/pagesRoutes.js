import { Router } from "express";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";

const html = String.raw;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function renderOrdersPage({ role, userLabel, storeId, firestoreCollectionId }) {
  const assetVersion = "28";
  const safeUserLabel = escapeHtml(userLabel);
  const safeStoreId = escapeHtml(storeId);
  const safeFirestoreCollectionId = escapeHtml(firestoreCollectionId);

  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orders</title>
    <link rel="stylesheet" href="/static/orders.css?v=${assetVersion}" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/fontawesome.min.css?v=${assetVersion}" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/solid.min.css?v=${assetVersion}" />
    <link rel="icon" type="image/png" href="/static/icon.png?v=${assetVersion}" />
    <script src="/static/orders.js?v=${assetVersion}" defer></script>
  </head>
  <body data-role="${role}" data-store-id="${safeStoreId}" data-firestore-collection="${safeFirestoreCollectionId}">
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

        <div class="topbarActions">
          ${
            role === "admin"
              ? html`<div class="storePill" aria-live="polite">
                  <div class="storePillLabel">Store</div>
                  <select id="storeSelect" class="storeSelect" aria-label="Select store"></select>
                  <div id="storeName" class="storeName">Loading…</div>
                </div>`
              : ""
          }

	          <details class="userMenu" aria-label="User menu">
	            <summary class="userMenuSummary" aria-label="Open user menu">
	              <span class="userAvatar userAvatarIcon" aria-hidden="true">
	                <i class="fa-solid fa-user" aria-hidden="true"></i>
	              </span>
	            </summary>
	            <div class="userMenuList">
	              <div class="userMenuSection">
	                <strong>${safeUserLabel}</strong>
	              </div>
              <a class="userMenuItem" href="${role === "admin" ? "/admin/orders" : "/shop/orders"}">Dashboard</a>
              <a class="userMenuItem" href="/health">System health</a>
              <a class="userMenuItem" href="mailto:support@haulriders.com">Support</a>
              <button type="button" class="userMenuItem userMenuButton" data-action="logout">
                Logout
              </button>
            </div>
          </details>
        </div>
      </div>
    </header>

    <main class="container">
      <section class="panel">
        <div class="panelHeader">
          <div class="panelTitle">
            <h1>Latest Orders</h1>
            <div class="panelHint">Fast view + export</div>
          </div>

          <div class="controls">
            <div class="tabs" role="tablist" aria-label="Order status tabs">
              ${role === "shop"
                ? html`<button class="tabBtn" type="button" data-tab="new" role="tab">New</button>`
                : ""}
              <button class="tabBtn" type="button" data-tab="assigned" role="tab">Assigned</button>
              <button class="tabBtn" type="button" data-tab="in_transit" role="tab">In Transit</button>
              <button class="tabBtn" type="button" data-tab="delivered" role="tab">Delivered</button>
              <button class="tabBtn" type="button" data-tab="rto" role="tab">RTO</button>
              <button class="tabBtn" type="button" data-tab="all" role="tab">All</button>
            </div>

            <label class="field fieldFulfillment">
              <span>Fulfillment</span>
              <select id="fulfillmentFilter">
                <option value="all" selected>All</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="unfulfilled">Unfulfilled</option>
              </select>
            </label>

            <label class="field fieldTracking">
              <span>Tracking</span>
              <select id="trackingFilter">
                <option value="any" selected>Any</option>
                <option value="added">Added</option>
                <option value="not_added">Not Added</option>
              </select>
            </label>

            <div class="btnGroup">
              <label id="dateRangeWrap" class="field">
                <select id="dateRange">
                  <option value="today">Today</option>
                  <option value="last7" selected>Last 7 days</option>
                  <option value="thisMonth">This Month</option>
                  <option value="last60">Last 60 days</option>
                </select>
              </label>
              <button id="refresh" class="btn btnPrimary" type="button">Sync Orders</button>
              <button id="bulkShip" class="btn btnPrimary" type="button">Bulk Ship</button>
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
                <th>Weight</th>
                <th>Courier Type</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

export function createPagesRouter({ env, auth } = {}) {
  const router = Router();

  router.get("/orders", (_req, res) => {
    res.redirect(302, "/shop/orders");
  });

  router.get("/shop/orders", auth.requireRole("shop"), (req, res) => {
    const userLabel = String(req.user?.email ?? "Shop").trim() || "Shop";
    const storeId = String(req.user?.storeId ?? "").trim();
    const firestoreCollectionId = getShopCollectionInfo({ env, storeId }).collectionId;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOrdersPage({ role: "shop", userLabel, storeId, firestoreCollectionId }));
  });

  router.get("/admin/orders", auth.requireRole("admin"), (req, res) => {
    const userLabel = String(req.user?.email ?? env?.adminName ?? "Admin").trim() || "Admin";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOrdersPage({ role: "admin", userLabel, storeId: "", firestoreCollectionId: "" }));
  });

  return router;
}
