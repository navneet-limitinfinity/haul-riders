import { Router } from "express";
import { getShopCollectionInfo } from "../firestore/shopCollections.js";
import { parseCookies } from "../auth/cookies.js";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { ensureStoreIdForShop } from "../firestore/storeIdGenerator.js";
import { getShopsCollectionName } from "../firestore/storeDocs.js";

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
    <a class="navItem ${isActive(role === "admin" ? "/admin/create-orders" : "/shop/create-orders")}" href="${role === "admin" ? "/admin/create-orders" : "/shop/create-orders"}">
      <i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>
      Create Orders
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

function debugFooterEnabled(env) {
  const level = String(env?.logLevel ?? "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  return level === "debug" || nodeEnv !== "production";
}

const DEBUG_FOOTER_COOKIE = "haul_debug_footer";

function resolveDebugFooterFlag({ req, env }) {
  const q = String(req.query?.debugFooter ?? "").trim();
  if (q === "1") return true;
  if (q === "0") return false;

  const cookies = parseCookies(req.headers?.cookie);
  const cookieVal = String(cookies?.[DEBUG_FOOTER_COOKIE] ?? "").trim();
  if (cookieVal === "1") return true;
  if (cookieVal === "0") return false;

  return debugFooterEnabled(env);
}

function maybePersistDebugFooterFlag({ req, res }) {
  const q = String(req.query?.debugFooter ?? "").trim();
  if (q !== "1" && q !== "0") return false;

  // Persist for this browser session across the portal.
  res.cookie(DEBUG_FOOTER_COOKIE, q, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    secure: Boolean(req.secure),
    sameSite: "lax",
    path: "/",
  });
  return true;
}

function renderDebugFooterAssets({ assetVersion, enabled }) {
  if (!enabled) return "";
  return html`
    <link rel="stylesheet" href="/static/debug-footer.css?v=${assetVersion}" />
    <script src="/static/debug-footer.js?v=${assetVersion}" defer></script>
  `;
}


const normalizeShopDomain = (value) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const withSuffix = raw.includes(".myshopify.com") ? raw : `${raw}.myshopify.com`;
  return withSuffix.includes(".") ? withSuffix : "";
};

const getUsersCollectionName = (env) =>
  String(env?.auth?.firebase?.usersCollection ?? "users").trim() || "users";

const resolveShopDomainFromUser = (user) => {
  const direct =
    String(user?.storeDomain ?? user?.store ?? user?.claims?.storeDomain ?? "").trim();
  return normalizeShopDomain(direct);
};

async function persistStoreIdOnUser({ firestore, env, uid, storeId, storeDomain }) {
  if (!uid || !storeId) return;
  const collection = getUsersCollectionName(env);
  const data = { storeId };
  if (storeDomain) {
    data.storeDomain = normalizeShopDomain(storeDomain);
  }
  await firestore.collection(collection).doc(uid).set(data, { merge: true });
}

async function ensureUserStoreId({ env, user }) {
  const existingStoreId = String(user?.storeId ?? "").trim();
  if (existingStoreId) {
    return existingStoreId;
  }

  const admin = await getFirebaseAdmin({ env });
  const firestore = admin.firestore();
  const shopsCollection = getShopsCollectionName(env);
  const shopDomain = resolveShopDomainFromUser(user);
  const storeIdValue = await ensureStoreIdForShop({ firestore, shopsCollection, shopDomain });
  if (!storeIdValue) {
    return "";
  }

  await persistStoreIdOnUser({ firestore, env, uid: user?.uid, storeId: storeIdValue, storeDomain: shopDomain });
  if (user) {
    user.storeId = storeIdValue;
  }
  return storeIdValue;
}

function renderOrdersPage({ role, userLabel, storeId, firestoreCollectionId, debugFooter }) {
  const assetVersion = "54";
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
    ${renderDebugFooterAssets({ assetVersion, enabled: debugFooter })}
  </head>
  <body data-role="${role}" data-page="orders" data-store-id="${safeStoreId}" data-firestore-collection="${safeFirestoreCollectionId}" data-debug-footer="${debugFooter ? "1" : "0"}">
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

        <div class="topbarSearch" role="search" aria-label="Search orders">
          <div class="topbarSearchInner">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input
              id="dashboardSearch"
              type="search"
              placeholder="Search Order ID / AWB / Phone"
              autocomplete="off"
              spellcheck="false"
            />
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
                ? html`<button class="tabBtn" type="button" data-tab="new" role="tab">New at Shopify</button>`
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
              <button id="loadMore" class="btn btnSecondary" type="button" hidden>Load More</button>
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

function renderBulkUploadPage({ userLabel, debugFooter }) {
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
    ${renderDebugFooterAssets({ assetVersion: "29", enabled: debugFooter })}
  </head>
  <body data-role="admin" data-page="bulk-upload" data-debug-footer="${debugFooter ? "1" : "0"}">
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
                <div class="bulkCardHint">Matches rows by Consignment Number (AWB) and updates shipment status.</div>
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
                <li><code>consignmentNumber</code> (or <code>consignment_number</code>/<code>Tracking Numbers</code>/<code>trackingNumber</code>)</li>
                <li><code>shipmentStatus</code> (or <code>shipment_status</code>/<code>Shipments Status</code>)</li>
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
                <li><code>orderId</code> (unique id; e.g. <code>#1001</code> or <code>O000001</code>; auto-generated if blank)</li>
                <li><code>fullName</code>, <code>phone1</code>, <code>address1</code>, <code>city</code>, <code>state</code>, <code>pinCode</code></li>
                <li><code>totalPrice</code>, <code>financialStatus</code> (e.g. <code>paid</code> or <code>pending</code>)</li>
              </ul>
              <div class="bulkHint">
                Optional (order): <code>customerEmail</code>, <code>paymentStatus</code>, <code>address2</code>, <code>phone2</code>, <code>itemAndQuantity</code> (or <code>content_and_quantity</code>), <code>invoiceValue</code> (or <code>invoice_value</code>), <code>fulfillmentCenter</code>, <code>fulfillmentStatus</code>.
                Optional (shipment): <code>shipmentStatus</code>, <code>courierPartner</code>, <code>consignmentNumber</code>, <code>courierType</code>, <code>weightKg</code>, <code>shippingDate</code>, <code>expectedDeliveryDate</code>, <code>updatedAt</code>.
              </div>
            </details>
          </div>

          <div class="bulkCard">
            <div class="bulkCardHeader">
              <div>
                <div class="bulkCardTitle">Upload AWB pool (CSV)</div>
                <div class="bulkCardHint">Stores docket/AWB numbers and allocates them during “Assign to ship”.</div>
              </div>
            </div>

            <div class="bulkForm">
              <div class="bulkFields">
                <label class="field">
                  <span>AWB pool CSV file</span>
                  <input id="awbCsvFile" type="file" accept=".csv,text/csv" />
                </label>
              </div>
              <button id="awbUploadBtn" class="btn btnSecondary bulkBtnFull" type="button">
                <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
                Upload AWBs
              </button>
            </div>

            <div id="awbUploadStatus" class="status" aria-live="polite"></div>

            <details class="bulkDetails">
              <summary>CSV columns</summary>
              <ul class="bulkList">
                <li><code>Z - Express</code></li>
                <li><code>D - Surface/D - Air</code></li>
                <li><code>COD Surface/COD Air</code></li>
              </ul>
              <div class="bulkHint">Each cell can contain one or more AWB numbers (separated by comma/space).</div>
            </details>
          </div>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderFulfillmentCentersPage({ userLabel, storeId, debugFooter }) {
  const assetVersion = "54";
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
    ${renderDebugFooterAssets({ assetVersion, enabled: debugFooter })}
  </head>
  <body data-role="shop" data-page="fulfillment-centers" data-store-id="${safeStoreId}" data-debug-footer="${debugFooter ? "1" : "0"}">
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
        <label class="field">
          <span>Contact Person Name</span>
          <input id="contactPersonName" type="text" placeholder="Name" />
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

function renderStoreDetailsPage({ userLabel, storeId, debugFooter }) {
  const assetVersion = "54";
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
    ${renderDebugFooterAssets({ assetVersion, enabled: debugFooter })}
  </head>
  <body data-role="shop" data-page="store" data-store-id="${safeStoreId}" data-debug-footer="${debugFooter ? "1" : "0"}">
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
                <div class="profileInfoLabel">Store ID</div>
                <div id="storeIdText" class="profileInfoValue mono"></div>
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
                <div class="profileInfoLabel">Legal Entity Name</div>
                <div id="registeredEntityNameText" class="profileInfoValue"></div>
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
            <span>Legal Entity Name</span>
            <input id="drawerRegisteredEntityName" type="text" placeholder="Legal Entity Name" />
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
	        <label class="field">
	          <span>Contact Person Name</span>
	          <input id="contactPersonName" type="text" placeholder="Name" />
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

function renderCreateOrdersPage({ role, userLabel, storeId, debugFooter }) {
  const assetVersion = "1";
  const safeUserLabel = escapeHtml(userLabel);
  const safeStoreId = escapeHtml(storeId);

  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Create Orders</title>
    <link rel="stylesheet" href="/static/orders.css?v=54" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/fontawesome.min.css?v=54" />
    <link rel="stylesheet" href="/static/vendor/fontawesome/css/solid.min.css?v=54" />
    <link rel="stylesheet" href="/static/bulk-upload.css?v=3" />
    <link rel="icon" type="image/png" href="/static/icon.png?v=54" />
    <script src="/static/create-orders.js?v=${assetVersion}" defer></script>
    ${renderDebugFooterAssets({ assetVersion: "54", enabled: debugFooter })}
  </head>
  <body data-role="${role}" data-page="create-orders" data-store-id="${safeStoreId}" data-debug-footer="${debugFooter ? "1" : "0"}">
    ${renderNavDrawer({
      role,
      userLabel,
      activePath: role === "admin" ? "/admin/create-orders" : "/shop/create-orders",
    })}
    <header class="topbar">
      <div class="topbarInner">
        <div class="brand">
          <label id="navToggle" class="navToggle" for="navState" role="button" tabindex="0" aria-label="Open navigation">
            <i class="fa-solid fa-bars" aria-hidden="true"></i>
          </label>
          <img class="brandLogo" src="/static/haul_riders_logo.jpeg?v=54" alt="Haul Riders" decoding="async" />
          <div class="brandText">
            <div class="brandTitle">Create Orders</div>
            <div class="brandSub">Bulk upload (CSV) or create a single order</div>
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
            <h1>Create Orders</h1>
            <div class="panelHint">Upload a file to create orders, then optionally assign them to ship.</div>
          </div>

          ${
            role === "admin"
              ? html`<div class="controls">
                  <label class="field">
                    <span>Store (required)</span>
                    <select id="storeId" class="storeSelect" aria-label="Select store"></select>
                  </label>
                </div>`
              : html`<div class="controls"></div>`
          }
          <div class="controls">
            <a class="btn btnSecondary btnIcon" href="/static/sample_create_orders.csv" download>
              <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
              Sample CSV
            </a>
          </div>
        </div>

        <div id="status" class="status" aria-live="polite"></div>

        <div class="bulkBody" style="padding: 0;">
          <div class="bulkColumns" style="grid-template-columns: repeat(2, minmax(0, 1fr));">
            <div class="bulkCard">
              <div class="bulkCardHeader">
                <div>
                  <div class="bulkCardTitle">Bulk upload (CSV)</div>
                  <div class="bulkCardHint">Creates “New” orders in Firestore.</div>
                </div>
              </div>
              <div class="bulkForm">
                <div class="bulkFields">
                  <label class="field">
                    <span>File</span>
                    <input id="ordersFile" type="file" accept=".csv,text/csv" />
                  </label>
                </div>
                <button id="ordersUploadBtn" class="btn btnPrimary bulkBtnFull" type="button">
                  <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
                  Upload Orders
                </button>
              </div>
              <div class="progressWrap" aria-label="Upload progress">
                <div class="progressBar">
                  <div id="progressFill" class="progressFill" style="width: 0%"></div>
                </div>
                <div id="progressText" class="progressText">0%</div>
              </div>
              <details class="bulkDetails">
                <summary>Columns</summary>
                <ul class="bulkList">
                  <li><code>orderId</code> (optional; auto-generated if missing)</li>
                  <li><code>fullName</code>, <code>phone1</code>, <code>address1</code>, <code>city</code>, <code>state</code>, <code>pinCode</code></li>
                  <li><code>invoiceValue</code>, <code>paymentStatus</code></li>
                </ul>
                <div class="bulkHint">Optional: <code>customerEmail</code>, <code>address2</code>, <code>phone2</code>, <code>productDescription</code>, <code>fulfillmentCenter</code>, <code>fulfillmentStatus</code>, <code>orderDate</code>, <code>weightKg</code>, <code>courierType</code>, <code>courierPartner</code>.</div>
              </details>
            </div>

            <div class="bulkCard bulkCardPrimary">
              <div class="bulkCardHeader">
                <div>
                  <div class="bulkCardTitle">Create single order</div>
                  <div class="bulkCardHint">Creates one “New” order.</div>
                </div>
              </div>
              <div class="bulkForm">
                <button id="openSingleDrawer" class="btn btnSecondary bulkBtnFull" type="button">
                  <i class="fa-solid fa-plus" aria-hidden="true"></i>
                  Create Order
                </button>
              </div>
              <div class="bulkHint" style="padding: 0 2px;">Order ID is auto-generated if you leave it blank.</div>
            </div>
          </div>

          <div class="storeInnerDivider"></div>

          <div class="bulkCard" style="margin-top: 0;">
            <div class="bulkCardHeader" style="align-items: center;">
              <div>
                <div class="bulkCardTitle">Recently created orders</div>
                <div class="bulkCardHint">Select orders to assign them to ship.</div>
              </div>
              <div class="controls">
                <button id="assignSelectedBtn" class="btn btnPrimary btnIcon" type="button" disabled>
                  <i class="fa-solid fa-truck" aria-hidden="true"></i>
                  Assign to Ship
                </button>
              </div>
            </div>

            <div class="tableWrap">
              <table class="table" aria-label="Created orders">
                <thead>
                  <tr>
                    <th style="width: 42px;"><input id="selectAllCreated" type="checkbox" aria-label="Select all" /></th>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>City</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody id="createdRows"></tbody>
              </table>
            </div>

            <details class="bulkDetails" style="margin-top: 10px;">
              <summary>Rejected rows</summary>
              <div id="rejectedRows" class="bulkHint"></div>
            </details>
          </div>
        </div>
      </section>
    </main>

    <div id="singleDrawerOverlay" class="sideDrawerOverlay" hidden></div>
    <aside id="singleDrawer" class="sideDrawer" aria-label="Create order" aria-hidden="true">
      <div class="sideDrawerHeader">
        <div class="sideDrawerTitle">Create Order</div>
        <button id="singleDrawerClose" type="button" class="btn btnSecondary btnIcon" aria-label="Close">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="sideDrawerBody">
        <div class="drawerSectionHeader">Order</div>
        <div class="orderCreateGrid">
          <label class="field span-4">
            <span>Order ID (optional)</span>
            <input id="singleOrderId" type="text" class="mono" inputmode="numeric" placeholder="Leave Blank" />
          </label>
          <label class="field span-4">
            <span>Order Date (optional)</span>
            <input id="singleOrderDate" type="text" class="mono" placeholder="DD-MM-YYYY" />
          </label>
        </div>

        <div class="drawerSectionHeader">Customer</div>
        <div class="orderCreateGrid">
          <label class="field span-6">
            <span>Customer Name</span>
            <input id="singleFullName" type="text" />
            <small id="singleFullNameHint" class="fieldHint"></small>
          </label>
          <label class="field span-6">
            <span>Customer Email (optional)</span>
            <input id="singleCustomerEmail" type="email" placeholder="name@example.com" />
            <small id="singleEmailHint" class="fieldHint"></small>
          </label>
          <label class="field span-3">
            <span>Contact No</span>
            <input id="singlePhone1" type="text" class="mono" inputmode="numeric" placeholder="Exclude +91 or 0)" />
            <small id="singlePhone1Hint" class="fieldHint"></small>
          </label>
          <label class="field span-3">
            <span>Alternate Contact (optional)</span>
            <input id="singlePhone2" type="text" class="mono" inputmode="numeric" />
            <small id="singlePhone2Hint" class="fieldHint"></small>
          </label>
        </div>

        <div class="drawerSectionHeader">Address</div>
        <div class="orderCreateGrid">
          <label class="field span-12">
            <span>Complete address</span>
            <input id="singleAddress1" type="text" />
            <small id="singleAddress1Hint" class="fieldHint"></small>
          </label>
          <label class="field span-12">
            <span>Landmark (optional)</span>
            <input id="singleAddress2" type="text" />
          </label>
          <label class="field span-4">
            <span>PIN Code</span>
            <input id="singlePinCode" type="text" class="mono" inputmode="numeric" />
            <small id="singlePinHint" class="fieldHint"></small>
          </label>
          <label class="field span-4">
            <span>City</span>
            <input id="singleCity" type="text" />
          </label>
          <label class="field span-4">
            <span>State</span>
            <input id="singleState" type="text" />
          </label>
        </div>

          <div class="drawerSectionHeader">Payment & Fulfillment</div>
          <div class="orderCreateGrid">
            <label class="field span-4">
              <span>Payment Status</span>
              <select id="singlePaymentStatus" required>
              <option value="" disabled selected>Select</option>
              <option value="paid">Paid</option>
              <option value="cod" disabled>COD</option>
            </select>
            <small id="singlePaymentStatusHint" class="fieldHint"></small>
          </label>

          <label class="field span-4">
            <span>Invoice Value</span>
            <input id="singleInvoiceValue" type="text" class="mono" inputmode="decimal" required />
            <small id="singleInvoiceValueHint" class="fieldHint"></small>
          </label>
          <label class="field span-4">
            <span>E-Way Bill Number</span>
            <input id="singleEwayBill" type="text" />
            <small id="singleEwayBillHint" class="fieldHint">Required for invoices above ₹49,999.</small>
          </label>
            <label class="field span-4">
              <span>Courier Partner (optional)</span>
              <select id="singleCourierPartner">
              <option value="DTDC" selected>DTDC</option>
            </select>
          </label>
          <label class="field span-4">
            <span>Fulfillment Center</span>
            <select id="singleFulfillmentCenter" required>
              <option value="" disabled selected>Fulfillment Center</option>
            </select>
            <small id="singleFulfillmentCenterHint" class="fieldHint"></small>
          </label>
          <label class="field span-4">
            <span>Weight (kg)</span>
            <input id="singleWeightKg" type="text" class="mono" inputmode="decimal" placeholder="e.g. 0.1" required />
            <small id="singleWeightKgHint" class="fieldHint"></small>
          </label>
          <label class="field span-4">
            <span>Courier Type</span>
            <select id="singleCourierType" required>
              <option value="" disabled selected>Courier Type</option>
              <option value="Z- Express">Z- Express</option>
              <option value="D- Surface">D- Surface</option>
              <option value="D- Air">D- Air</option>
              <option value="COD Surface" disabled>COD Surface</option>
              <option value="COD Air" disabled>COD Air</option>
            </select>
            <small id="singleCourierTypeHint" class="fieldHint"></small>
          </label>

          <label class="field span-12">
            <span>Product description</span>
            <input id="singleProductDescription" type="text" />
          </label>
        </div>
      </div>
      <div class="sideDrawerFooter">
        <button id="singleDrawerCancel" type="button" class="btn btnSecondary">Cancel</button>
        <button id="singleDrawerCreate" type="button" class="btn btnPrimary">Create</button>
      </div>
    </aside>
  </body>
</html>`;
}

export function createPagesRouter({ env, auth } = {}) {
  const router = Router();

  const redirectToStoreDetails = async (req, res) => {
    try {
      await ensureUserStoreId({ env, user: req.user });
    } catch (error) {
      // ignore errors while preparing store ID
    }
    const target = new URL("/shop/store", `${req.protocol}://${req.get("host")}`);
    const q = String(req.query?.debugFooter ?? "").trim();
    if (q === "1" || q === "0") {
      target.searchParams.set("debugFooter", q);
    }
    res.redirect(302, target.pathname + target.search);
  };

  router.get("/orders", (_req, res) => {
    res.redirect(302, "/shop/orders");
  });

  router.get("/shop/orders", auth.requireRole("shop"), async (req, res) => {
    if (maybePersistDebugFooterFlag({ req, res })) {
      const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
      url.searchParams.delete("debugFooter");
      res.redirect(302, url.pathname + (url.search ? url.search : ""));
      return;
    }
    // Shop dashboard must not carry admin store selection query params.
    if (req.query?.store != null) {
      res.redirect(302, "/shop/orders");
      return;
    }
    const userLabel = String(req.user?.email ?? "Shop").trim() || "Shop";
    const storeId = String(req.user?.storeId ?? "").trim();
    if (!storeId) {
      await redirectToStoreDetails(req, res);
      return;
    }
    const firestoreCollectionId = "consignments";
    const debugFooter = resolveDebugFooterFlag({ req, env });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOrdersPage({ role: "shop", userLabel, storeId, firestoreCollectionId, debugFooter }));
  });

  router.get("/shop/store", auth.requireRole("shop"), (req, res) => {
    if (maybePersistDebugFooterFlag({ req, res })) {
      const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
      url.searchParams.delete("debugFooter");
      res.redirect(302, url.pathname + (url.search ? url.search : ""));
      return;
    }
    const userLabel = String(req.user?.email ?? "Shop").trim() || "Shop";
    const storeId = String(req.user?.storeId ?? "").trim();
    const debugFooter = resolveDebugFooterFlag({ req, env });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStoreDetailsPage({ userLabel, storeId, debugFooter }));
  });

  router.get("/admin/orders", auth.requireRole("admin"), (req, res) => {
    if (maybePersistDebugFooterFlag({ req, res })) {
      const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
      url.searchParams.delete("debugFooter");
      res.redirect(302, url.pathname + (url.search ? url.search : ""));
      return;
    }
    const userLabel = String(req.user?.email ?? env?.adminName ?? "Admin").trim() || "Admin";
    const debugFooter = resolveDebugFooterFlag({ req, env });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOrdersPage({ role: "admin", userLabel, storeId: "", firestoreCollectionId: "", debugFooter }));
  });

  router.get("/admin/bulk-upload", auth.requireRole("admin"), (req, res) => {
    if (maybePersistDebugFooterFlag({ req, res })) {
      const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
      url.searchParams.delete("debugFooter");
      res.redirect(302, url.pathname + (url.search ? url.search : ""));
      return;
    }
    const userLabel = String(req.user?.email ?? env?.adminName ?? "Admin").trim() || "Admin";
    const debugFooter = resolveDebugFooterFlag({ req, env });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderBulkUploadPage({ userLabel, debugFooter }));
  });

  router.get("/admin/create-orders", auth.requireRole("admin"), (req, res) => {
    if (maybePersistDebugFooterFlag({ req, res })) {
      const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
      url.searchParams.delete("debugFooter");
      res.redirect(302, url.pathname + (url.search ? url.search : ""));
      return;
    }
    const userLabel = String(req.user?.email ?? env?.adminName ?? "Admin").trim() || "Admin";
    const debugFooter = resolveDebugFooterFlag({ req, env });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderCreateOrdersPage({ role: "admin", userLabel, storeId: "", debugFooter }));
  });

  router.get("/shop/create-orders", auth.requireRole("shop"), (req, res) => {
    if (maybePersistDebugFooterFlag({ req, res })) {
      const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
      url.searchParams.delete("debugFooter");
      res.redirect(302, url.pathname + (url.search ? url.search : ""));
      return;
    }
    const userLabel = String(req.user?.email ?? "Shop").trim() || "Shop";
    const storeId = String(req.user?.storeId ?? "").trim();
    const debugFooter = resolveDebugFooterFlag({ req, env });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderCreateOrdersPage({ role: "shop", userLabel, storeId, debugFooter }));
  });

  router.get("/shop/fulfillment-centers", auth.requireRole("shop"), (req, res) => {
    if (maybePersistDebugFooterFlag({ req, res })) {
      const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
      url.searchParams.delete("debugFooter");
      res.redirect(302, url.pathname + (url.search ? url.search : ""));
      return;
    }
    const userLabel = String(req.user?.email ?? "Shop").trim() || "Shop";
    const storeId = String(req.user?.storeId ?? "").trim();
    const debugFooter = resolveDebugFooterFlag({ req, env });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderFulfillmentCentersPage({ userLabel, storeId, debugFooter }));
  });

  return router;
}
