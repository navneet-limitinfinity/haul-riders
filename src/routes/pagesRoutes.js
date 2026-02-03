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

function renderNavDrawer({ role, userLabel, activePath }) {
  const safeUserLabel = escapeHtml(userLabel);
  const isActive = (path) => (String(activePath ?? "") === path ? "isActive" : "");

  const common = html`
    <a class="navItem ${isActive(role === "admin" ? "/admin/orders" : "/shop/orders")}" href="${role === "admin" ? "/admin/orders" : "/shop/orders"}">
      <i class="fa-solid fa-list" aria-hidden="true"></i>
      Orders
    </a>
    ${role === "shop"
      ? html`<a class="navItem ${isActive("/shop/store")}" href="/shop/store">
          <i class="fa-solid fa-store" aria-hidden="true"></i>
          Store / Shop Details
        </a>`
      : ""}
    ${role === "admin"
      ? html`<a class="navItem ${isActive("/admin/bulk-upload")}" href="/admin/bulk-upload">
          <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
          Bulk Tools
        </a>`
      : ""}
    <a class="navItem" href="mailto:support@haulriders.com">
      <i class="fa-solid fa-life-ring" aria-hidden="true"></i>
      Support
    </a>
  `;

  return html`
    <input id="navState" class="navState" type="checkbox" aria-hidden="true" tabindex="-1" />
    <label for="navState" id="navOverlay" class="navOverlay" aria-hidden="true"></label>
    <aside id="navDrawer" class="navDrawer" aria-label="Navigation">
      <div class="navHeader">
        <div class="navTitle">Haul Riders</div>
        <div class="navSub">${safeUserLabel}</div>
      </div>
      <nav class="navList">
        ${common}
      </nav>
      <div class="navFooter">
        <button type="button" class="navItem navButton" data-action="logout">
          <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>
          Logout
        </button>
      </div>
    </aside>
  `;
}

function renderOrdersPage({ role, userLabel, storeId, firestoreCollectionId }) {
  const assetVersion = "49";
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
  <body data-role="${role}" data-page="orders" data-store-id="${safeStoreId}" data-firestore-collection="${safeFirestoreCollectionId}">
    ${renderNavDrawer({ role, userLabel, activePath: role === "admin" ? "/admin/orders" : "/shop/orders" })}
    <header class="topbar">
      <div class="topbarInner">
        <div class="brand">
          <label id="navToggle" class="navToggle" for="navState" role="button" tabindex="0" aria-label="Open navigation">
            <i class="fa-solid fa-bars" aria-hidden="true"></i>
          </label>
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
            role === "shop"
              ? html`<img
                  class="brandingLogoTopbar"
                  src="/api/store/branding/logo"
                  alt="Brand logo"
                  decoding="async"
                  onerror="this.style.display='none'"
                />`
              : ""
          }
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
              ${role === "admin" ? html`<a class="userMenuItem" href="/admin/bulk-upload">Bulk CSV upload</a>` : ""}
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
              ${
                role === "admin"
                  ? html`<button
                      id="bulkStatusUpload"
                      class="btn btnSecondary btnIcon"
                      type="button"
                      title="Bulk status update (CSV)"
                    >
                      <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
                    </button>`
                  : ""
              }
              <button id="bulkDownloadLabels" class="btn btnSecondary btnIcon" type="button" disabled title="Download shipping labels (PDF)">
                <i class="fa-solid fa-download" aria-hidden="true"></i>
              </button>
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

        <div id="pageProgress" class="pageProgress" aria-hidden="true">
          <div class="pageProgressBar"></div>
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

function renderBulkUploadPage({ userLabel }) {
  const assetVersion = "3";
  const safeUserLabel = escapeHtml(userLabel);

  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bulk tools</title>
    <link rel="stylesheet" href="/static/orders.css?v=29" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/fontawesome.min.css?v=29" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/solid.min.css?v=29" />
    <link rel="stylesheet" href="/static/bulk-upload.css?v=${assetVersion}" />
    <link rel="icon" type="image/png" href="/static/icon.png?v=29" />
    <script src="/static/bulk-upload.js?v=${assetVersion}" defer></script>
  </head>
  <body data-role="admin" data-page="bulk-upload">
    ${renderNavDrawer({ role: "admin", userLabel, activePath: "/admin/bulk-upload" })}
	    <header class="topbar">
	      <div class="topbarInner">
	        <div class="brand">
	          <label id="navToggle" class="navToggle" for="navState" role="button" tabindex="0" aria-label="Open navigation">
	            <i class="fa-solid fa-bars" aria-hidden="true"></i>
	          </label>
	          <img
	            class="brandLogo"
	            src="/static/haul_riders_logo.jpeg?v=29"
	            alt="Haul Riders"
	            decoding="async"
          />
          <div class="brandText">
            <div class="brandTitle">Haul Riders</div>
            <div class="brandSub">Bulk tools</div>
          </div>
        </div>

        <div class="topbarActions">
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
              <a class="userMenuItem" href="/admin/orders">Dashboard</a>
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
        <div class="panelHeader bulkHeader">
          <div class="panelTitle">
            <h1>Bulk tools</h1>
            <div class="panelHint">Upload CSVs to create orders or update shipment status.</div>
          </div>

          <div class="controls bulkActions">
            <a class="btn btnSecondary btnIcon" href="/static/sample_status_update.csv" download>
              <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
              Status update sample
            </a>
            <a class="btn btnSecondary btnIcon" href="/static/sample_bulk_orders.csv" download>
              <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
              Order upload sample
            </a>
          </div>
        </div>

        <div class="bulkBody">
          <div class="bulkToolbar">
            <label class="field bulkStoreField">
              <span>Store (required)</span>
              <select id="storeId" class="storeSelect" aria-label="Select store"></select>
            </label>
          </div>

          <div class="bulkColumns">
          <div class="bulkCard bulkCardPrimary" id="status-upload">
            <div class="bulkCardHeader">
              <div>
                <div class="bulkCardTitle">Update shipment status (CSV)</div>
                <div class="bulkCardHint">Matches rows by Tracking Number and updates shipment status.</div>
              </div>
            </div>

            <div class="bulkForm">
              <div class="bulkFields">
                <label class="field">
                  <span>Status CSV file</span>
                  <input id="statusCsvFile" type="file" accept=".csv,text/csv" />
                </label>
              </div>
              <button id="statusUploadBtn" class="btn btnPrimary bulkBtnFull" type="button">
                <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
                Update Status
              </button>
            </div>

            <div id="statusUploadStatus" class="status" aria-live="polite"></div>

            <div class="progressWrap" aria-label="Status update progress">
              <div class="progressBar">
                <div id="statusProgressFill" class="progressFill" style="width: 0%"></div>
              </div>
              <div id="statusProgressText" class="progressText">0%</div>
            </div>

            <details class="bulkDetails">
              <summary>CSV columns</summary>
              <ul class="bulkList">
                <li><code>Tracking Numbers</code> (or <code>trackingNumber</code>)</li>
                <li><code>Shipments Status</code> (or <code>shipmentStatus</code>)</li>
              </ul>
              <div class="bulkHint">
                Supported values: <code>In Transit</code>, <code>Undelivered</code>, <code>At Destination</code>,
                <code>Out for Delivery</code>, <code>Set RTO</code>, <code>Delivered</code>,
                <code>RTO Accepted</code>, <code>RTO In Transit</code>, <code>RTO Reached At Destination</code>, <code>RTO Delivered</code>.
              </div>
            </details>
          </div>

          <div class="bulkCard">
            <div class="bulkCardHeader">
              <div>
                <div class="bulkCardTitle">Upload assigned orders (CSV)</div>
                <div class="bulkCardHint">Creates/updates orders in Firestore so they appear in the “Assigned” tab.</div>
              </div>
            </div>

            <div class="bulkForm">
              <div class="bulkFields">
                <label class="field">
                  <span>Order CSV file</span>
                  <input id="csvFile" type="file" accept=".csv,text/csv" />
                </label>
              </div>
              <button id="uploadBtn" class="btn btnSecondary bulkBtnFull" type="button">
                <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
                Upload Orders
              </button>
            </div>

            <div id="uploadStatus" class="status" aria-live="polite"></div>

            <div class="progressWrap" aria-label="Upload progress">
              <div class="progressBar">
                <div id="progressFill" class="progressFill" style="width: 0%"></div>
              </div>
              <div id="progressText" class="progressText">0%</div>
            </div>

            <details class="bulkDetails">
              <summary>CSV columns</summary>
              <ul class="bulkList">
                <li><code>orderKey</code> (unique id; any string)</li>
                <li><code>orderName</code> (include <code>#</code>, e.g. <code>#1001</code>)</li>
                <li><code>fullName</code>, <code>phone1</code>, <code>address1</code>, <code>city</code>, <code>state</code>, <code>pinCode</code></li>
                <li><code>totalPrice</code>, <code>financialStatus</code> (e.g. <code>paid</code> or <code>pending</code>)</li>
              </ul>
              <div class="bulkHint">
                Optional (tracking/shipment): <code>consignment_number</code>/<code>awbNumber</code>, <code>courier_partner</code>/<code>trackingCompany</code>, <code>courier_type</code>/<code>courierType</code>, <code>weight</code>/<code>weightKg</code>, <code>shipping_date</code>, <code>expected_delivery_date</code>.
                Optional (order): <code>customerEmail</code>, <code>address2</code>, <code>phone2</code>, <code>content_and_quantity</code> (or <code>productDescription</code>), <code>invoice_value</code>.
              </div>
            </details>
          </div>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderFulfillmentCentersPage({ userLabel, storeId }) {
  const assetVersion = "52";
  const safeUserLabel = escapeHtml(userLabel);
  const safeStoreId = escapeHtml(storeId);

  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fulfillment Centers</title>
    <link rel="stylesheet" href="/static/orders.css?v=${assetVersion}" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/fontawesome.min.css?v=${assetVersion}" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/solid.min.css?v=${assetVersion}" />
    <link rel="icon" type="image/png" href="/static/icon.png?v=${assetVersion}" />
    <script src="/static/fulfillment-centers.js?v=${assetVersion}" defer></script>
  </head>
  <body data-role="shop" data-page="fulfillment-centers" data-store-id="${safeStoreId}">
    ${renderNavDrawer({ role: "shop", userLabel, activePath: "/shop/fulfillment-centers" })}
	    <header class="topbar">
	      <div class="topbarInner">
	        <div class="brand">
	          <label id="navToggle" class="navToggle" for="navState" role="button" tabindex="0" aria-label="Open navigation">
	            <i class="fa-solid fa-bars" aria-hidden="true"></i>
	          </label>
	          <img
	            class="brandLogo"
	            src="/static/haul_riders_logo.jpeg?v=${assetVersion}"
	            alt="Haul Riders"
	            decoding="async"
          />
          <div class="brandText">
            <div class="brandTitle">Fulfillment Centers</div>
            <div class="brandSub">Manage pickup/origin addresses</div>
          </div>
        </div>

        <div class="topbarActions">
          <img
            class="brandingLogoTopbar"
            src="/api/store/branding/logo"
            alt="Brand logo"
            decoding="async"
            onerror="this.style.display='none'"
          />
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
              <a class="userMenuItem" href="/shop/orders">Dashboard</a>
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
            <h1>Fulfillment Centers</h1>
            <div class="panelHint">Select one default center for shipping labels.</div>
          </div>

          <div class="controls">
            <div class="btnGroup">
              <button id="addCenterBtn" class="btn btnPrimary btnIcon" type="button">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                Add Center
              </button>
            </div>
          </div>
        </div>

        <div id="status" class="status" aria-live="polite"></div>

        <div class="tableWrap">
          <table class="table" aria-label="Fulfillment centers">
	            <thead>
	              <tr>
	                <th>Origin Name</th>
	                <th>Address</th>
	                <th>PIN</th>
	                <th>Phone</th>
	                <th>Default</th>
	                <th>Action</th>
	              </tr>
	            </thead>
            <tbody id="centersRows"></tbody>
          </table>
        </div>
      </section>
    </main>

	    <div id="centerDrawerOverlay" class="sideDrawerOverlay" hidden></div>
	    <aside id="centerDrawer" class="sideDrawer" aria-label="Fulfillment center details" aria-hidden="true">
	      <div class="sideDrawerHeader">
	        <div class="sideDrawerTitle" id="centerDrawerTitle">Add center</div>
	        <button id="centerDrawerClose" type="button" class="btn btnSecondary btnIcon" aria-label="Close">
	          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
	        </button>
	      </div>
	      <div class="sideDrawerBody">
	        <input type="hidden" id="centerId" value="" />
	        <label class="field">
	          <span>Origin Name</span>
	          <input id="originName" type="text" placeholder="e.g. ORG L02" required />
	        </label>
	        <div class="modalGrid">
	          <label class="field">
	            <span>Address 1</span>
	            <input id="address1" type="text" />
	          </label>
	          <label class="field">
	            <span>Address 2</span>
	            <input id="address2" type="text" />
	          </label>
	          <label class="field">
	            <span>City</span>
	            <input id="city" type="text" />
	          </label>
	          <label class="field">
	            <span>State</span>
	            <input id="state" type="text" />
	          </label>
	          <label class="field">
	            <span>PIN Code</span>
	            <input id="pinCode" type="text" inputmode="numeric" />
	          </label>
	          <label class="field">
	            <span>Phone</span>
	            <input id="phone" type="text" inputmode="numeric" />
	          </label>
	        </div>
	        <label class="fieldCheckbox" style="margin-top: 6px;">
	          <input id="makeDefault" type="checkbox" />
	          <span>Make default</span>
	        </label>
	      </div>
	      <div class="sideDrawerFooter">
	        <button id="centerDrawerCancel" type="button" class="btn btnSecondary">Cancel</button>
	        <button id="saveCenterBtn" class="btn btnPrimary" type="button">Save</button>
	      </div>
	    </aside>
  </body>
</html>`;
}

function renderStoreDetailsPage({ userLabel, storeId }) {
  const assetVersion = "52";
  const safeUserLabel = escapeHtml(userLabel);
  const safeStoreId = escapeHtml(storeId);

  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Store Details</title>
    <link rel="stylesheet" href="/static/orders.css?v=${assetVersion}" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/fontawesome.min.css?v=${assetVersion}" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/solid.min.css?v=${assetVersion}" />
    <link rel="icon" type="image/png" href="/static/icon.png?v=${assetVersion}" />
    <script src="/static/store-details.js?v=${assetVersion}" defer></script>
  </head>
  <body data-role="shop" data-page="store" data-store-id="${safeStoreId}">
    ${renderNavDrawer({ role: "shop", userLabel, activePath: "/shop/store" })}
    <header class="topbar">
      <div class="topbarInner">
        <div class="brand">
          <label id="navToggle" class="navToggle" for="navState" role="button" tabindex="0" aria-label="Open navigation">
            <i class="fa-solid fa-bars" aria-hidden="true"></i>
          </label>
          <img class="brandLogo" src="/static/haul_riders_logo.jpeg?v=${assetVersion}" alt="Haul Riders" decoding="async" />
          <div class="brandText">
            <div class="brandTitle">Store / Shop Details</div>
            <div class="brandSub">Manage store info, branding, and fulfillment centers</div>
          </div>
        </div>

        <div class="topbarActions">
          <img
            class="brandingLogoTopbar"
            src="/api/store/branding/logo"
            alt="Brand logo"
            decoding="async"
            onerror="this.style.display='none'"
          />
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
              <a class="userMenuItem" href="/shop/orders">Dashboard</a>
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
		            <h1>Store Details</h1>
		            <div class="panelHint">These details are editable and specific to your store.</div>
		          </div>
		        </div>

		        <div id="status" class="status" aria-live="polite"></div>

		        <div class="storeDetailsWrap">
		          <section class="profileCard" aria-label="Store details card">
				            <div class="profileCardHeader">
				              <div class="profileCardHeaderLeft">
				                <div class="profileIconCircle" aria-hidden="true">
				                  <i class="fa-solid fa-user" aria-hidden="true"></i>
				                </div>
			                <div class="profileCardTitle">Account Details</div>
			              </div>
			              <button id="editStoreDetailsLink" class="btn btnPrimary btnIcon" type="button" aria-label="Edit details">
			                <i class="fa-solid fa-pen" aria-hidden="true"></i>
			                Edit Details
			              </button>
			            </div>
			            <div class="profileCardDivider" aria-hidden="true"></div>
			            <div class="profileInfoGrid">
			              <div class="profileInfoItem">
			                <div class="profileInfoLabel">Store Name</div>
			                <div id="storeNameText" class="profileInfoValue"></div>
			              </div>
			              <div class="profileInfoItem">
			                <div class="profileInfoLabel">Contact No.</div>
			                <div id="contactPersonPhoneText" class="profileInfoValue mono"></div>
			              </div>
			              <div class="profileInfoItem">
			                <div class="profileInfoLabel">Email</div>
			                <div id="contactPersonEmailText" class="profileInfoValue"></div>
			              </div>

			              <div class="profileInfoItem">
			                <div class="profileInfoLabel">GST Number</div>
			                <div id="gstNumberText" class="profileInfoValue mono"></div>
			              </div>
			              <div class="profileInfoItem">
			                <div class="profileInfoLabel">State Code - State</div>
			                <div class="profileInfoValue">
			                  <span id="stateCodeText" class="mono"></span>
			                  <span id="stateNameText" class="profileInfoValueSubtle"></span>
			                </div>
			              </div>
			              <div class="profileInfoItem">
			                <div class="profileInfoLabel">Website Address</div>
			                <div id="websiteAddressText" class="profileInfoValue"></div>
			              </div>
			              <div class="profileInfoItem">
			                <div class="profileInfoLabel">Contact Person Name</div>
			                <div id="contactPersonNameText" class="profileInfoValue"></div>
			              </div>

			              <div class="profileInfoItem profileInfoItemSpanAll">
			                <div class="profileInfoLabel">Registered Address</div>
			                <div id="registeredAddressText" class="profileInfoValue profileInfoValueMultiline"></div>
				              </div>
				            </div>
				          </section>

				          <section class="profileCard" aria-label="Fulfillment centers card">
			            <div class="profileCardHeader">
			              <div class="profileCardHeaderLeft">
			                <div class="profileIconCircle" aria-hidden="true">
			                  <i class="fa-solid fa-warehouse" aria-hidden="true"></i>
			                </div>
			                <div class="profileCardTitle">Fulfillment Centers</div>
			              </div>
			              <div class="storeInnerActions">
			                <button id="addCenterBtn" class="btn btnPrimary btnIcon" type="button">
			                  <i class="fa-solid fa-plus" aria-hidden="true"></i>
			                  Add Center
			                </button>
			              </div>
			            </div>
			            <div class="profileCardDivider" aria-hidden="true"></div>
			            <div class="storeInnerHint" style="padding: 0 2px 10px;">
			              Ship-from address on labels is taken from the fulfillment center selected per order (or default center when missing).
			            </div>
			            <div class="tableWrap">
			              <table class="table" aria-label="Fulfillment centers">
			                <thead>
			                  <tr>
			                    <th>Origin Name</th>
			                    <th>Address</th>
			                    <th>PIN</th>
			                    <th>Phone</th>
			                    <th>Default</th>
			                    <th>Action</th>
			                  </tr>
			                </thead>
			                <tbody id="centersRows"></tbody>
			              </table>
			            </div>
			          </section>

			          <section class="profileCard" aria-label="Branding card">
			            <div class="profileCardHeader">
			              <div class="profileCardHeaderLeft">
			                <div class="profileIconCircle" aria-hidden="true">
			                  <i class="fa-solid fa-image" aria-hidden="true"></i>
			                </div>
			                <div class="profileCardTitle">Branding</div>
			              </div>
			              <div class="storeInnerActions">
			                <input id="brandingLogoFile" type="file" accept="image/png,image/jpeg" />
			                <button id="uploadBrandingLogo" class="btn btnPrimary btnIcon" type="button">
			                  <i class="fa-solid fa-upload" aria-hidden="true"></i>
			                  Upload Logo
			                </button>
			              </div>
			            </div>
			            <div class="profileCardDivider" aria-hidden="true"></div>
			            <div class="storeInnerHint" style="padding: 0 2px 10px;">
			              Upload a logo (PNG/JPG, max 1MB). Used on dashboard (top-right) and shipping labels.
			            </div>
			            <div class="tableWrap">
			              <div style="padding: 12px;">
			                <img id="brandingLogoPreview" alt="Brand logo preview" style="max-width: 220px; max-height: 220px; border-radius: 12px; border: 1px solid var(--border);" />
			              </div>
			            </div>
				          </section>
				        </div>
			      </section>
	    </main>

	    <div id="accountDrawerOverlay" class="sideDrawerOverlay" hidden></div>
	    <aside id="accountDrawer" class="sideDrawer" aria-label="Edit account details" aria-hidden="true">
	      <div class="sideDrawerHeader">
	        <div class="sideDrawerTitle">Edit Details</div>
	        <button id="accountDrawerClose" type="button" class="btn btnSecondary btnIcon" aria-label="Close">
	          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
	        </button>
	      </div>
	      <div class="sideDrawerBody">
	        <div class="modalGrid">
	          <label class="field">
	            <span>Store Name</span>
	            <input id="drawerStoreName" type="text" placeholder="Store Name" />
	          </label>
	          <label class="field">
	            <span>GST Number</span>
	            <input id="drawerGstNumber" type="text" placeholder="GST Number" />
	          </label>
	          <label class="field">
	            <span>State Code - State</span>
	            <select id="drawerStateCode">
	              <option value="">Select State</option>
	            </select>
	          </label>
	          <label class="field">
	            <span>Website Address</span>
	            <input id="drawerWebsiteAddress" type="text" placeholder="https://example.com" />
	          </label>
	          <label class="field" style="grid-column: 1 / -1;">
	            <span>Registered Address</span>
	            <textarea id="drawerRegisteredAddress" rows="3" placeholder="Registered Address"></textarea>
	          </label>
	          <label class="field">
	            <span>Contact Person Name</span>
	            <input id="drawerContactPersonName" type="text" placeholder="Name" />
	          </label>
	          <label class="field">
	            <span>Contact Person Email</span>
	            <input id="drawerContactPersonEmail" type="email" placeholder="Email" />
	          </label>
	          <label class="field">
	            <span>Contact Person Phone</span>
	            <input id="drawerContactPersonPhone" type="text" inputmode="numeric" placeholder="10-digit phone" />
	          </label>
	        </div>
	      </div>
	      <div class="sideDrawerFooter">
	        <button id="accountDrawerCancel" type="button" class="btn btnSecondary">Cancel</button>
	        <button id="accountDrawerUpdate" type="button" class="btn btnPrimary">Update</button>
	      </div>
	    </aside>

	    <div id="centerDrawerOverlay" class="sideDrawerOverlay" hidden></div>
	    <aside id="centerDrawer" class="sideDrawer" aria-label="Fulfillment center details" aria-hidden="true">
	      <div class="sideDrawerHeader">
	        <div class="sideDrawerTitle" id="centerDrawerTitle">Add center</div>
	        <button id="centerDrawerClose" type="button" class="btn btnSecondary btnIcon" aria-label="Close">
	          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
	        </button>
	      </div>
	      <div class="sideDrawerBody">
	        <input type="hidden" id="centerId" value="" />
	        <label class="field">
	          <span>Origin Name</span>
	          <input id="originName" type="text" placeholder="e.g. ORG L02" required />
	        </label>
	        <div class="modalGrid">
	          <label class="field">
	            <span>Address 1</span>
	            <input id="address1" type="text" />
	          </label>
	          <label class="field">
	            <span>Address 2</span>
	            <input id="address2" type="text" />
	          </label>
	          <label class="field">
	            <span>City</span>
	            <input id="city" type="text" />
	          </label>
	          <label class="field">
	            <span>State</span>
	            <input id="state" type="text" />
	          </label>
	          <label class="field">
	            <span>PIN Code</span>
	            <input id="pinCode" type="text" inputmode="numeric" />
	          </label>
	          <label class="field">
	            <span>Phone</span>
	            <input id="phone" type="text" inputmode="numeric" />
	          </label>
	        </div>
	        <label class="fieldCheckbox" style="margin-top: 6px;">
	          <input id="makeDefault" type="checkbox" />
	          <span>Set as default</span>
	        </label>
	      </div>
	      <div class="sideDrawerFooter">
	        <button id="centerDrawerCancel" type="button" class="btn btnSecondary">Cancel</button>
	        <button id="saveCenterBtn" class="btn btnPrimary" type="button">Save</button>
	      </div>
	    </aside>
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
    const firestoreCollectionId = getShopCollectionInfo({ storeId }).collectionId;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOrdersPage({ role: "shop", userLabel, storeId, firestoreCollectionId }));
  });

  router.get("/shop/store", auth.requireRole("shop"), (req, res) => {
    const userLabel = String(req.user?.email ?? "Shop").trim() || "Shop";
    const storeId = String(req.user?.storeId ?? "").trim();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStoreDetailsPage({ userLabel, storeId }));
  });

  router.get("/admin/orders", auth.requireRole("admin"), (req, res) => {
    const userLabel = String(req.user?.email ?? env?.adminName ?? "Admin").trim() || "Admin";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOrdersPage({ role: "admin", userLabel, storeId: "", firestoreCollectionId: "" }));
  });

  router.get("/admin/bulk-upload", auth.requireRole("admin"), (req, res) => {
    const userLabel = String(req.user?.email ?? env?.adminName ?? "Admin").trim() || "Admin";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderBulkUploadPage({ userLabel }));
  });

  router.get("/shop/fulfillment-centers", auth.requireRole("shop"), (req, res) => {
    const userLabel = String(req.user?.email ?? "Shop").trim() || "Shop";
    const storeId = String(req.user?.storeId ?? "").trim();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderFulfillmentCentersPage({ userLabel, storeId }));
  });

  return router;
}
