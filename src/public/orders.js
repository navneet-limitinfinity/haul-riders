const $ = (id) => document.getElementById(id);

const DEFAULT_HEADER_HTML = `<tr>
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
</tr>`;

const NEW_TAB_HEADER_HTML = `<tr>
  <th class="colCheck">
    <input id="selectAll" type="checkbox" aria-label="Select all" />
  </th>
  <th class="colSortable" data-sort-key="createdAt">
    Order Details <span class="sortIndicator" aria-hidden="true"></span>
  </th>
  <th>Customer Details</th>
  <th>Pincode</th>
  <th>Phone No.</th>
  <th>Invoice Details</th>
  <th>Fulfillment Center</th>
  <th>Weight</th>
  <th>Courier Type</th>
  <th>Action</th>
</tr>`;

const ASSIGNED_TAB_HEADER_HTML = `<tr>
  <th class="colCheck">
    <input id="selectAll" type="checkbox" aria-label="Select all" />
  </th>
  <th>Order ID</th>
  <th>Order Date</th>
  <th>Full Name</th>
  <th>Address</th>
  <th>Pincode</th>
  <th>Phone No.</th>
  <th>Invoice Value</th>
  <th>Payment Status</th>
  <th>Product Description</th>
  <th>Fulfillment Status</th>
  <th>Shipment Status</th>
  <th>Tracking No.</th>
  <th>Action</th>
</tr>`;

const IN_TRANSIT_TAB_HEADER_HTML = `<tr>
  <th class="colCheck">
    <input id="selectAll" type="checkbox" aria-label="Select all" />
  </th>
  <th>Order Details</th>
  <th>Customer Details</th>
  <th>Phone No</th>
  <th>Invoice Details</th>
  <th>Shipping Date</th>
  <th>Tracking No</th>
  <th>Shipment Details</th>
  <th>Shipment Status</th>
  <th>Updated On</th>
  <th>EDD</th>
</tr>`;

const DELIVERED_TAB_HEADER_HTML = `<tr>
  <th class="colCheck">
    <input id="selectAll" type="checkbox" aria-label="Select all" />
  </th>
  <th>Order Details</th>
  <th>Customer Details</th>
  <th>Phone No</th>
  <th>Invoice Details</th>
  <th>Shipping Date</th>
  <th>Tracking No</th>
  <th>Shipment Details</th>
  <th>Shipment Status</th>
  <th>Updated On</th>
</tr>`;

const RTO_TAB_HEADER_HTML = `<tr>
  <th class="colCheck">
    <input id="selectAll" type="checkbox" aria-label="Select all" />
  </th>
  <th>Order Details</th>
  <th>Customer Details</th>
  <th>Phone No</th>
  <th>Invoice Details</th>
  <th>Shipping Date</th>
  <th>Tracking No</th>
  <th>Shipment Details</th>
  <th>Shipment Status</th>
  <th>Updated On</th>
</tr>`;

let allOrders = [];
let currentOrders = [];
const selectedOrderIds = new Set();
let fulfillmentCentersState = {
  loaded: false,
  defaultName: "",
  centers: [],
};
function pruneSelectionToVisible(orders) {
  const allowed = new Set();
  for (const row of orders ?? []) {
    const key = getOrderKey(row);
    if (key) allowed.add(key);
  }
  for (const key of Array.from(selectedOrderIds)) {
    if (!allowed.has(key)) selectedOrderIds.delete(key);
  }
}
let loadingCount = 0;

const getOrderKey = (row) => String(row?.orderKey ?? row?.orderId ?? "");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeShipmentStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "new") return "new";
  if (s === "assigned") return "assigned";
  if (s === "in_transit" || s === "in transit") return "in_transit";
  if (s === "delivered") return "delivered";
  if (s === "rto") return "rto";
  if (s === "rto_initiated" || s === "rto initiated") return "rto_initiated";
  if (s === "rto_delivered" || s === "rto delivered") return "rto_delivered";

  if (s === "fulfilled") return "delivered";
  if (s === "unfulfilled") return "new";
  if (s.includes("rto") && s.includes("initi")) return "rto_initiated";
  if (s.includes("rto") && s.includes("deliver")) return "rto_delivered";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("rto")) return "rto";
  if (s.includes("assign")) return "assigned";

  return "new";
};

const getEffectiveShipmentStatus = (row) =>
  normalizeShipmentStatus(row?.shipmentStatus || row?.fulfillmentStatus);

function getPrimaryTrackingCode(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const first = raw.split(",")[0] ?? "";
  return first.trim();
}

function buildBwipJsCode128Url(code) {
  const text = String(code ?? "").trim();
  if (!text) return "";
  const url = new URL("https://bwipjs-api.metafloor.com/");
  url.searchParams.set("bcid", "code128");
  url.searchParams.set("text", text);
  url.searchParams.set("scale", "2");
  url.searchParams.set("height", "10");
  url.searchParams.set("includetext", "true");
  url.searchParams.set("backgroundcolor", "FFFFFF");
  return url.toString();
}

const formatOrderDate = (iso) => {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

const getPaymentFlag = (financialStatus) => {
  const s = String(financialStatus ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "paid" || s === "partially_paid") return "Prepaid";
  if (s === "pending" || s === "authorized" || s === "partially_paid") return "COD";
  return s.toUpperCase();
};

const formatTrackingNumbers = (trackingNumbers) => {
  if (!Array.isArray(trackingNumbers)) return "";
  return trackingNumbers.filter(Boolean).join(", ");
};

function sanitizeFilename(value) {
  return String(value ?? "")
    .trim()
    .replaceAll(/[^a-z0-9._-]+/gi, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
}

const normalizeFulfillmentStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  return s || "null";
};

const getTrackingAssigned = (row) => {
  const t = String(
    row?.trackingNumbersText ?? formatTrackingNumbers(row?.trackingNumbers)
  ).trim();
  return Boolean(t);
};

const parseOrderNumber = (orderName) => {
  const s = String(orderName ?? "");
  const m = s.match(/(\d+)/);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
};

const SHOPIFY_MAX_LIMIT = 250;

const DATE_RANGE_DEFAULT = "last7";
const DATE_RANGE_STORAGE_KEY = "haulDateRange";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoStartOfDayDaysAgo(days) {
  const n = Number.parseInt(String(days ?? "0"), 10);
  const safeDays = Number.isNaN(n) ? 0 : Math.max(0, n);
  const today = startOfDay(new Date());
  const d = new Date(today.getTime() - safeDays * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function isoStartOfThisMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function normalizeDateRange(value) {
  const v = String(value ?? "").trim();
  const allowed = new Set(["today", "last7", "thisMonth", "last60"]);
  return allowed.has(v) ? v : DATE_RANGE_DEFAULT;
}

function getDateRange() {
  const select = $("dateRange");
  const fromUi = select ? normalizeDateRange(select.value) : "";
  if (fromUi) return fromUi;
  try {
    return normalizeDateRange(localStorage.getItem(DATE_RANGE_STORAGE_KEY));
  } catch {
    return DATE_RANGE_DEFAULT;
  }
}

function setDateRange(range) {
  const value = normalizeDateRange(range);
  const select = $("dateRange");
  if (select) select.value = value;
  try {
    localStorage.setItem(DATE_RANGE_STORAGE_KEY, value);
  } catch {
    // ignore storage failures
  }
}

function getSinceIsoForRange(range) {
  const r = normalizeDateRange(range);
  if (r === "today") return isoStartOfDayDaysAgo(0);
  if (r === "last7") return isoStartOfDayDaysAgo(7);
  if (r === "thisMonth") return isoStartOfThisMonth();
  if (r === "last60") return isoStartOfDayDaysAgo(60);
  return isoStartOfDayDaysAgo(7);
}

let sortState = { key: "orderName", dir: "desc" };
let activeTab = "all";
let activeRole = "shop";
let firestoreAssignedState = {
  started: false,
  ready: false,
  unsubscribe: null,
  orders: [],
};
const sessionAssignedOrderKeys = new Set();
const shipFormState = new Map();
const assignedEditState = new Map();
const assignedProductsRequested = new Set();
let assignedProductsInFlight = null;
const assignedServiceableByPin = new Map();
let assignedServiceableInFlight = null;
const assignedEditMode = new Set();
const assignedEditMeta = new Map();

function getAssignedEdits(row) {
  const orderKey = getOrderKey(row);
  const key = String(orderKey ?? "").trim();
  if (!key) {
    const shipping = row?.shipping ?? {};
    return {
      fullName: String(shipping.fullName ?? ""),
      address1: String(shipping.address1 ?? ""),
      address2: String(shipping.address2 ?? ""),
      city: String(shipping.city ?? ""),
      state: String(shipping.state ?? ""),
      pinCode: String(shipping.pinCode ?? ""),
      phone1: String(shipping.phone1 ?? ""),
      phone2: String(shipping.phone2 ?? ""),
    };
  }

  const existing = assignedEditState.get(key);
  if (existing) return existing;
  const shipping = row?.shipping ?? {};
  const initial = {
    fullName: String(shipping.fullName ?? ""),
    address1: String(shipping.address1 ?? ""),
    address2: String(shipping.address2 ?? ""),
    city: String(shipping.city ?? ""),
    state: String(shipping.state ?? ""),
    pinCode: String(shipping.pinCode ?? ""),
    phone1: String(shipping.phone1 ?? ""),
    phone2: String(shipping.phone2 ?? ""),
  };
  assignedEditState.set(key, initial);
  return initial;
}

function buildDtdcTrackingUrl(trackingNumber) {
  const tn = String(trackingNumber ?? "").trim();
  if (!tn) return "";
  return `https://txk.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCITrackingDetails&cType=Consignment&cnNo=${encodeURIComponent(
    tn
  )}`;
}

async function hydrateAssignedProductDescriptions(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;
  if (assignedProductsInFlight) return;

  const missingIds = [];
  for (const row of orders) {
    const existing =
      String(row?.productDescription ?? "").trim() ||
      String(row?.productDiscription ?? "").trim() ||
      String(row?.product_description ?? "").trim();
    if (existing) continue;
    const id = String(row?.orderId ?? "").trim();
    if (!/^\d+$/.test(id)) continue;
    if (assignedProductsRequested.has(id)) continue;
    missingIds.push(id);
    assignedProductsRequested.add(id);
  }

  if (missingIds.length === 0) return;

  assignedProductsInFlight = (async () => {
    try {
      const data = await fetchShopifyOrderProducts({ orderIds: missingIds });
      const products = data?.products && typeof data.products === "object" ? data.products : {};
      let changed = false;
      for (const row of orders) {
        const existing =
          String(row?.productDescription ?? "").trim() ||
          String(row?.productDiscription ?? "").trim() ||
          String(row?.product_description ?? "").trim();
        if (existing) continue;
        const id = String(row?.orderId ?? "").trim();
        const desc = String(products?.[id] ?? "").trim();
        if (!desc) continue;
        row.productDescription = desc;
        changed = true;
      }
      if (changed && activeRole === "shop" && activeTab === "assigned") {
        applyFiltersAndSort();
      }
    } finally {
      assignedProductsInFlight = null;
    }
  })();
}

async function fetchServiceablePincodes({ pincodes }) {
  const response = await fetch("/api/pincodes/serviceable", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ pincodes: Array.isArray(pincodes) ? pincodes : [] }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

function normalizePincode(pin) {
  return String(pin ?? "").replaceAll(/\D/g, "").slice(0, 6);
}

async function hydrateAssignedServiceablePins(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;
  if (assignedServiceableInFlight) return;

  const pins = [];
  for (const row of orders) {
    const edits = getAssignedEdits(row);
    const pin = normalizePincode(edits.pinCode);
    if (!pin) continue;
    if (assignedServiceableByPin.has(pin)) continue;
    pins.push(pin);
  }

  if (pins.length === 0) return;

  assignedServiceableInFlight = (async () => {
    try {
      const data = await fetchServiceablePincodes({ pincodes: pins });
      const map = data?.serviceable && typeof data.serviceable === "object" ? data.serviceable : {};
      for (const pin of pins) {
        assignedServiceableByPin.set(pin, Boolean(map?.[pin]));
      }
      if (activeRole === "shop" && activeTab === "assigned") {
        applyFiltersAndSort();
      }
    } finally {
      assignedServiceableInFlight = null;
    }
  })();
}

function getShipForm(orderKey) {
  const key = String(orderKey ?? "").trim();
  if (!key) return { weightKg: "", courierType: "", fulfillmentCenter: "" };
  const existing = shipFormState.get(key);
  if (existing) return existing;
  const initial = { weightKg: "", courierType: "", fulfillmentCenter: "" };
  shipFormState.set(key, initial);
  return initial;
}

function parseWeightKg(value) {
  const s = String(value ?? "").trim();
  if (!s) return { ok: true, value: null };

  // Accept: "0.1", ".1", "1", "1.0" (at most 1 decimal place).
  // Reject: "0.10", "1.23", "1.", ".", "abc".
  if (!/^(?:\d+|\d*\.\d)$/.test(s)) return { ok: false, value: null };

  const n = Number.parseFloat(s);
  if (Number.isNaN(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: n };
}

function attachSortHandlers() {
  document
    .querySelectorAll("th.colSortable[data-sort-key]")
    .forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sortKey;
        if (!key) return;

        if (sortState.key === key) {
          sortState = {
            key,
            dir: sortState.dir === "asc" ? "desc" : "asc",
          };
        } else {
          sortState = {
            key,
            dir: key === "orderName" ? "desc" : "asc",
          };
        }

        applyFiltersAndSort();
      });
    });
}

function bindSelectAllCheckbox() {
  const selectAll = $("selectAll");
  if (!selectAll || selectAll.dataset.bound === "1") return;
  selectAll.dataset.bound = "1";
  selectAll.addEventListener("change", (e) => {
    const checked = Boolean(e.target?.checked);
    selectedOrderIds.clear();
    if (checked) {
      for (const row of currentOrders) {
        const key = getOrderKey(row);
        if (key) selectedOrderIds.add(key);
      }
    }
    renderRows(currentOrders);
    syncBulkDownloadButton();
  });
}

function renderTableHeaderForActiveTab() {
  const thead = document.querySelector(".table thead");
  if (!thead) return;
  const isShopNew = activeRole === "shop" && activeTab === "new";
  const isShopAssigned = activeRole === "shop" && activeTab === "assigned";
  const isInTransit = activeTab === "in_transit";
  const isDelivered = activeTab === "delivered";
  const isRto = activeTab === "rto";
  const html = isShopNew
    ? NEW_TAB_HEADER_HTML
    : isShopAssigned
      ? ASSIGNED_TAB_HEADER_HTML
      : isInTransit
        ? IN_TRANSIT_TAB_HEADER_HTML
        : isDelivered
          ? DELIVERED_TAB_HEADER_HTML
          : isRto
            ? RTO_TAB_HEADER_HTML
            : DEFAULT_HEADER_HTML;
  thead.innerHTML = html;
  bindSelectAllCheckbox();
  attachSortHandlers();
  updateSortIndicators();
}

function syncNewTabLayout() {
  if (!document.body) return;
  document.body.dataset.tab = activeTab;
  const isShopNew = activeRole === "shop" && activeTab === "new";
  if (isShopNew) {
    sortState = { key: "createdAt", dir: "desc" };
  } else if (["in_transit", "delivered", "rto"].includes(activeTab)) {
    // These tabs must default to shipping_date DESC (server already returns sorted).
    // Keep a non-sorted key so applyFiltersAndSort preserves server order.
    sortState = { key: "shipping_date", dir: "desc" };
  } else if (sortState.key === "createdAt") {
    sortState = { key: "orderName", dir: "desc" };
  } else if (sortState.key === "shipping_date") {
    sortState = { key: "orderName", dir: "desc" };
  }
  renderTableHeaderForActiveTab();
}

function normalizeRole(role) {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "admin") return "admin";
  if (r === "shop") return "shop";
  if (r === "client") return "shop";
  return "shop";
}

function getIdToken() {
  try {
    return String(localStorage.getItem("haulIdToken") ?? "").trim();
  } catch {
    return "";
  }
}

function clearAuthClientState() {
  try {
    localStorage.removeItem("haulIdToken");
  } catch {
    // ignore storage failures
  }
}

function getAuthHeaders() {
  const token = getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function downloadShipmentLabelPdf({ orderKey, storeId, filenameHint }) {
  const url = new URL("/api/shipments/label.pdf", window.location.origin);
  url.searchParams.set("orderKey", String(orderKey ?? "").trim());
  if (storeId) url.searchParams.set("storeId", String(storeId));

  setStatus("Generating label…", { kind: "busy" });
  const res = await fetch(url.toString(), { headers: { ...getAuthHeaders() } });
  if (!res.ok) {
    let msg = `Failed to download label (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  setStatus("Preparing download…", { kind: "busy" });
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  const safe = sanitizeFilename(filenameHint) || "shipping_label";
  a.download = `${safe}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
  setStatus("Download ready.", { kind: "ok" });
}

function syncBulkDownloadButton() {
  const btn = $("bulkDownloadLabels");
  if (!btn) return;
  const disabled =
    selectedOrderIds.size === 0 || (activeRole === "shop" && activeTab === "new");
  btn.disabled = disabled;
}

async function downloadBulkShipmentLabelsPdf({ orderKeys, storeId }) {
  const url = new URL("/api/shipments/labels/bulk.pdf", window.location.origin);
  setStatus(`Generating ${orderKeys.length} label(s)…`, { kind: "busy" });

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ orderKeys, ...(storeId ? { storeId } : {}) }),
  });

  if (!response.ok) {
    let msg = `Failed to download labels (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) msg = String(body.error);
      if (Array.isArray(body?.missing) && body.missing.length) {
        msg = `Missing shipments for ${body.missing.length} order(s).`;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  setStatus("Preparing download…", { kind: "busy" });
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `shipping_labels_${orderKeys.length}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
  setStatus("Download ready.", { kind: "ok" });
}

function getDefaultTabForRole(role) {
  if (role === "shop") return "new";
  return "assigned";
}

function setActiveTab(nextTab) {
  activeTab = String(nextTab ?? "").trim().toLowerCase() || "all";
  const buttons = document.querySelectorAll(".tabBtn[data-tab]");
  for (const btn of buttons) {
    const tab = btn.dataset.tab;
    btn.classList.toggle("isActive", tab === activeTab);
    btn.setAttribute("aria-selected", tab === activeTab ? "true" : "false");
  }

  syncNewTabLayout();
  syncBulkDownloadButton();

  const rangeWrap = $("dateRangeWrap");
  if (rangeWrap) {
    rangeWrap.style.display = activeRole === "shop" ? "" : "none";
  }
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function signOut() {
  setStatus("Signing out…", { kind: "info" });
  clearAuthClientState();

  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  } catch {
    // ignore
  }

  // Best-effort: sign out Firebase Auth so Firestore listeners stop.
  try {
    const response = await fetch("/auth/firebase-config.json", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    const firebaseConfig = response.ok ? data?.config ?? null : null;
    if (firebaseConfig) {
      const [{ initializeApp }, { getAuth, signOut: firebaseSignOut }] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
      ]);
      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      await firebaseSignOut(auth).catch(() => {});
    }
  } catch {
    // ignore
  }

  window.location.assign("/login");
}

async function fetchShop() {
  const url = new URL("/api/shopify/shop", window.location.origin);
  const storeId = getStoreIdForRequests();
  if (storeId) url.searchParams.set("store", storeId);
  const response = await fetch(url, { cache: "no-store", headers: getAuthHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function fetchLatestOrders({ limit, since }) {
  const url = new URL("/api/shopify/orders/latest", window.location.origin);
  const storeId = getStoreIdForRequests();
  if (storeId) url.searchParams.set("store", storeId);
  if (limit) url.searchParams.set("limit", String(limit));
  if (since) url.searchParams.set("since", String(since));
  const response = await fetch(url, { cache: "no-store", headers: getAuthHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function fetchShopifyOrderProducts({ orderIds }) {
  const response = await fetch("/api/shopify/orders/products", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ orderIds: Array.isArray(orderIds) ? orderIds : [] }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function fetchFirestoreOrders({ status, limit }) {
  const url = new URL("/api/firestore/orders", window.location.origin);
  if (status) url.searchParams.set("status", String(status));
  if (limit) url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { cache: "no-store", headers: getAuthHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function fetchFirestoreAdminOrders({ storeId, status, limit }) {
  const url = new URL("/api/firestore/admin/orders", window.location.origin);
  if (storeId) url.searchParams.set("shopDomain", String(storeId));
  if (status) url.searchParams.set("status", String(status));
  if (limit) url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { cache: "no-store", headers: getAuthHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function fetchFulfillmentCenters() {
  const response = await fetch("/api/firestore/fulfillment-centers", {
    cache: "no-store",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function ensureFulfillmentCentersLoaded() {
  if (fulfillmentCentersState.loaded) return;
  fulfillmentCentersState.loaded = true;
  try {
    const data = await fetchFulfillmentCenters();
    const centers = Array.isArray(data?.centers) ? data.centers : [];
    fulfillmentCentersState.centers = centers;
    const defaultCenter = centers.find((c) => Boolean(c?.default)) ?? centers[0] ?? null;
    fulfillmentCentersState.defaultName = String(defaultCenter?.originName ?? "").trim();
  } catch {
    fulfillmentCentersState.defaultName = "";
    fulfillmentCentersState.centers = [];
  }
}

async function fetchConsignments({ tab, storeId, limit }) {
  const safeTab = String(tab ?? "").trim().toLowerCase();
  const url = new URL(`/api/consignments/${encodeURIComponent(safeTab)}`, window.location.origin);
  if (storeId) url.searchParams.set("storeId", String(storeId));
  if (limit) url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { cache: "no-store", headers: getAuthHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function ensureFirestoreAssignedRealtime() {
  if (firestoreAssignedState.started) return;
  firestoreAssignedState.started = true;

  const collectionId = String(document.body?.dataset?.firestoreCollection ?? "").trim();
  if (!collectionId) {
    setStatus("Missing shop collection id.", { kind: "error" });
    firestoreAssignedState.ready = true;
    return;
  }

  setStatus("Syncing assigned orders…", { kind: "info" });

  try {
    let firebaseConfig = window.__FIREBASE_WEB_CONFIG__ ?? null;
    if (!firebaseConfig) {
      const response = await fetch("/auth/firebase-config.json", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error ?? "firebase_config_unavailable"));
      }
      firebaseConfig = data?.config ?? null;
      if (!firebaseConfig) throw new Error("firebase_config_unavailable");
    }

    const [
      { initializeApp },
      { getAuth, onAuthStateChanged },
      {
        getFirestore,
        enableIndexedDbPersistence,
        collection,
        query,
        orderBy,
        limit,
        onSnapshot,
      },
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
    ]);

    const app = initializeApp(firebaseConfig);
    // Ensure Firebase Auth state is loaded so Firestore uses the logged-in user.
    const auth = getAuth(app);
    await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, () => {
        unsub();
        resolve();
      });
    });

    const db = getFirestore(app);
    try {
      await enableIndexedDbPersistence(db);
    } catch {
      // Ignore: multiple tabs or unsupported browsers.
    }

    const q = query(
      collection(db, collectionId),
      orderBy("requestedAt", "desc"),
      limit(200)
    );

    firestoreAssignedState.unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = [];
        for (const doc of snap.docs) {
          const data = doc.data() ?? {};
          if (String(data.shipmentStatus ?? "") !== "assigned") continue;
          const order = data.order && typeof data.order === "object" ? data.order : null;
          const orderKey = String(data.orderKey ?? "").trim();
          if (orderKey) sessionAssignedOrderKeys.add(orderKey);
          const trackingNumber =
            String(data.trackingNumber ?? "").trim() ||
            String(data?.shipment?.trackingNumber ?? "").trim();
          rows.push({
            ...(order ?? {}),
            orderKey,
            shipmentStatus: "assigned",
            trackingNumber,
            firestore: {
              requestedAt: String(data.requestedAt ?? ""),
            },
          });
        }
        firestoreAssignedState.orders = rows;
        firestoreAssignedState.ready = true;

        hydrateAssignedProductDescriptions(rows).catch(() => {});
        hydrateAssignedServiceablePins(rows).catch(() => {});

        if (activeRole === "shop" && activeTab === "assigned") {
          allOrders = rows;
          applyFiltersAndSort();
          setStatus(`Loaded ${rows.length} assigned order(s).`, { kind: "ok" });
        }
      },
      async () => {
        // Fallback to server endpoint (no realtime) if client rules/config block.
        try {
          const data = await fetchFirestoreOrders({ status: "assigned", limit: 200 });
          const orders = Array.isArray(data?.orders) ? data.orders : [];
          for (const row of orders) {
            const key = String(row?.orderKey ?? "").trim();
            if (key) sessionAssignedOrderKeys.add(key);
          }
          firestoreAssignedState.orders = orders;
          firestoreAssignedState.ready = true;
          hydrateAssignedProductDescriptions(orders).catch(() => {});
          hydrateAssignedServiceablePins(orders).catch(() => {});
          if (activeRole === "shop" && activeTab === "assigned") {
            allOrders = orders;
            applyFiltersAndSort();
            setStatus(`Loaded ${orders.length} assigned order(s).`, { kind: "ok" });
          }
        } catch (error) {
          firestoreAssignedState.ready = true;
          setStatus(error?.message ?? "Failed to load assigned orders.", { kind: "error" });
        }
      }
    );
  } catch (error) {
    firestoreAssignedState.ready = true;
    setStatus(error?.message ?? "Failed to enable realtime assigned orders.", { kind: "error" });
  }
}

async function fetchStores() {
  const url = new URL("/api/shops", window.location.origin);
  const response = await fetch(url, { cache: "no-store", headers: getAuthHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

function getActiveStoreId() {
  const url = new URL(window.location.href);
  return String(url.searchParams.get("store") ?? "").trim();
}

function setActiveStoreId(storeId) {
  const url = new URL(window.location.href);
  const next = String(storeId ?? "").trim();
  if (next) url.searchParams.set("store", next);
  else url.searchParams.delete("store");
  window.location.assign(url.toString());
}

function getStoreIdForRequests() {
  if (activeRole === "admin") return getActiveStoreId();
  return String(document.body?.dataset?.storeId ?? "").trim();
}

function setStatus(message, { kind = "info" } = {}) {
  const el = $("status");
  if (!el) return;
  el.dataset.kind = kind;
  el.textContent = message;
}

function setLoading(isLoading) {
  if (isLoading) loadingCount += 1;
  else loadingCount = Math.max(0, loadingCount - 1);
  const el = $("pageProgress");
  if (!el) return;
  el.classList.toggle("isActive", loadingCount > 0);
}

function setMetric(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value ?? "—");
}

function syncSelectAllCheckbox() {
  const selectAll = $("selectAll");
  if (!selectAll) return;

  if (!Array.isArray(currentOrders) || currentOrders.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  let selectedCount = 0;
  for (const row of currentOrders) {
    const key = getOrderKey(row);
    if (key && selectedOrderIds.has(key)) selectedCount += 1;
  }

  selectAll.checked = selectedCount === currentOrders.length;
  selectAll.indeterminate =
    selectedCount > 0 && selectedCount < currentOrders.length;

  syncBulkDownloadButton();
}

function updateMetrics(view) {
  const v = Array.isArray(view) ? view : [];

  setMetric("metricShowing", v.length);
  setMetric("metricLoaded", allOrders.length);

  const fulfilledCount = v.filter(
    (row) => normalizeFulfillmentStatus(row?.fulfillmentStatus) === "fulfilled"
  ).length;
  setMetric("metricFulfilled", fulfilledCount);

  const trackingAssignedCount = v.filter((row) => getTrackingAssigned(row)).length;
  setMetric("metricTracking", trackingAssignedCount);
}

function applyFiltersAndSort() {
  const fulfillmentFilter = $("fulfillmentFilter")?.value ?? "all";
  const trackingFilter = $("trackingFilter")?.value ?? "any";

  let view = allOrders;

  if (activeTab && activeTab !== "all") {
    if (activeTab === "in_transit") {
      const excluded = new Set([
        "assigned",
        "delivered",
        "rto",
        "rto_initiated",
        "rto_delivered",
      ]);
      view = view.filter((row) => !excluded.has(getEffectiveShipmentStatus(row)));
    } else if (activeTab === "rto") {
      const allowed = new Set(["rto", "rto_initiated", "rto_delivered"]);
      view = view.filter((row) => allowed.has(getEffectiveShipmentStatus(row)));
    } else {
      view = view.filter((row) => getEffectiveShipmentStatus(row) === activeTab);
    }
  }

  if (fulfillmentFilter !== "all") {
    view = view.filter((row) => {
      const status = normalizeFulfillmentStatus(row?.fulfillmentStatus);
      if (fulfillmentFilter === "fulfilled") return status === "fulfilled";
      if (fulfillmentFilter === "unfulfilled") return status !== "fulfilled";
      return true;
    });
  }

  if (trackingFilter !== "any") {
    const wantAssigned = trackingFilter === "added";
    view = view.filter((row) => getTrackingAssigned(row) === wantAssigned);
  }

  const isShopNew = activeRole === "shop" && activeTab === "new";
  if (isShopNew) {
    const useDir = sortState.key === "createdAt" ? sortState.dir : "desc";
    const direction = useDir === "asc" ? 1 : -1;
    const sorted = [...view].sort((a, b) => {
      const ad = new Date(a?.createdAt ?? 0).getTime();
      const bd = new Date(b?.createdAt ?? 0).getTime();
      return (bd - ad) * direction;
    });

    renderRows(sorted);
    updateSortIndicators();
    updateMetrics(sorted);
    setStatus(
      `Showing ${sorted.length} of ${allOrders.length} order(s).`,
      { kind: "ok" }
    );
    return;
  }

  const { key, dir } = sortState;
  if (key === "shipping_date") {
    // These tabs must keep server order (shipping_date DESC).
    renderRows(view);
    updateSortIndicators();
    updateMetrics(view);
    setStatus(`Showing ${view.length} of ${allOrders.length} order(s).`, { kind: "ok" });
    return;
  }

  const direction = dir === "asc" ? 1 : -1;

  const sorted = [...view].sort((a, b) => {
    if (key === "orderName") {
      const an = parseOrderNumber(a?.orderName);
      const bn = parseOrderNumber(b?.orderName);
      if (an != null && bn != null) return (an - bn) * direction;
      const as = String(a?.orderName ?? "");
      const bs = String(b?.orderName ?? "");
      return as.localeCompare(bs) * direction;
    }

    if (key === "fulfillmentStatus") {
      const as = normalizeFulfillmentStatus(a?.fulfillmentStatus);
      const bs = normalizeFulfillmentStatus(b?.fulfillmentStatus);
      return as.localeCompare(bs) * direction;
    }

    return 0;
  });

  renderRows(sorted);
  updateSortIndicators();
  updateMetrics(sorted);

  setStatus(
    `Showing ${sorted.length} of ${allOrders.length} order(s).`,
    { kind: "ok" }
  );
}

function updateSortIndicators() {
  const ths = document.querySelectorAll("th.colSortable[data-sort-key]");
  for (const th of ths) {
    const key = th.dataset.sortKey;
    const indicator = th.querySelector(".sortIndicator");
    if (!indicator) continue;

    if (key === sortState.key) {
      indicator.textContent = sortState.dir === "asc" ? "↑" : "↓";
      th.dataset.sortDir = sortState.dir;
    } else {
      indicator.textContent = "";
      delete th.dataset.sortDir;
    }
  }
}

const createBadge = ({ label, kind = "muted" }) => ({
  badge: true,
  label,
  kind,
});

const createMenu = ({ label, url, trackingText }) => ({
  menu: true,
  label,
  url,
  trackingText,
});

const createTrackingValue = ({ text }) => ({
  trackingValue: true,
  text,
});

const createAdminUpdateMenu = ({ orderKey, shipmentStatus, trackingText }) => ({
  adminMenu: true,
  orderKey,
  shipmentStatus,
  trackingText,
});

const createActionButton = ({ label, action, orderKey }) => ({
  actionButton: true,
  label,
  action,
  orderKey,
});

const createWeightInput = ({ orderKey, value }) => ({
  weightInput: true,
  orderKey,
  value,
});

const createCourierTypeSelect = ({ orderKey, value }) => ({
  courierTypeSelect: true,
  orderKey,
  value,
});

const createFulfillmentCenterSelect = ({ orderKey, value, options, disabled }) => ({
  fulfillmentCenterSelect: true,
  orderKey,
  value,
  options: Array.isArray(options) ? options : [],
  disabled: Boolean(disabled),
});

function renderRows(orders) {
  if (activeRole === "shop" && activeTab === "new") {
    renderRowsNewTab(orders);
    return;
  }
  if (activeRole === "shop" && activeTab === "assigned") {
    renderRowsAssignedTab(orders);
    return;
  }
  if (activeTab === "in_transit") {
    renderRowsInTransitTab(orders);
    return;
  }
  if (activeTab === "delivered") {
    renderRowsDeliveredTab(orders);
    return;
  }
  if (activeTab === "rto") {
    renderRowsRtoTab(orders);
    return;
  }

  const tbody = $("rows");
  if (!tbody) return;

  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

  const fragment = document.createDocumentFragment();
  for (const row of currentOrders) {
    const tr = document.createElement("tr");

    const orderKey = getOrderKey(row);
    tr.dataset.orderKey = orderKey;

    const shipping = row?.shipping ?? {};

    const fulfillmentNorm = normalizeFulfillmentStatus(row?.fulfillmentStatus);
    const isFulfilled = fulfillmentNorm === "fulfilled";
    const fulfillmentLabel = isFulfilled ? "Fulfilled" : "Unfulfilled";
    const fulfillmentBadgeKind = isFulfilled ? "ok" : "muted";

    const trackingText =
      row.trackingNumbersText ?? formatTrackingNumbers(row.trackingNumbers);
    const trackingUrl = String(row.trackingUrl ?? "").trim();
    const trackingBadge =
      trackingText && String(trackingText).trim()
        ? null
        : createBadge({ label: "Not Added", kind: "muted" });

    const effectiveShipmentStatus = getEffectiveShipmentStatus(row);
    const rawShipmentStatus = String(row?.shipmentStatus ?? "").trim();
    const beautifyStatus = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "";
      return raw
        .replaceAll("_", " ")
        .split(" ")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
        .join(" ")
        .trim();
    };

    const inTransitLabel =
      activeTab === "in_transit" && rawShipmentStatus
        ? beautifyStatus(rawShipmentStatus)
        : "";

    const shipmentLabel =
      activeRole === "shop" && activeTab === "new" && !isFulfilled
        ? "Unfulfilled"
        : inTransitLabel
          ? inTransitLabel
          : effectiveShipmentStatus === "new"
            ? "New"
            : effectiveShipmentStatus === "assigned"
              ? "Assigned"
              : effectiveShipmentStatus === "in_transit"
                ? "In Transit"
                : effectiveShipmentStatus === "delivered"
                  ? "Delivered"
                  : effectiveShipmentStatus === "rto" ||
                      effectiveShipmentStatus === "rto_initiated" ||
                      effectiveShipmentStatus === "rto_delivered"
                    ? "RTO"
                    : "New";
    const shipmentKind =
      activeRole === "shop" && activeTab === "new" && !isFulfilled
        ? "muted"
        : inTransitLabel &&
            (inTransitLabel.toLowerCase().includes("destination") ||
              inTransitLabel.toLowerCase().includes("transit"))
          ? "ok"
        : effectiveShipmentStatus === "delivered"
          ? "ok"
          : effectiveShipmentStatus === "in_transit" ||
              effectiveShipmentStatus === "assigned"
            ? "warn"
            : effectiveShipmentStatus === "rto" ||
                effectiveShipmentStatus === "rto_initiated" ||
                effectiveShipmentStatus === "rto_delivered"
              ? "error"
              : "muted";

    const phone1 = String(shipping.phone1 ?? "").trim();
    const phone2 = String(shipping.phone2 ?? "").trim();
    const phone1Badge = phone1 ? null : createBadge({ label: "Missing", kind: "error" });
    const phone2Badge = null;

    const courierPartner = String(row.trackingCompany ?? "").trim();
    const courierCell =
      courierPartner && trackingUrl
        ? createMenu({ label: courierPartner, url: trackingUrl, trackingText })
        : courierPartner ||
          (trackingUrl
            ? createMenu({ label: "Track", url: trackingUrl, trackingText })
            : "");

    const actionCell =
      activeRole === "shop"
        ? activeTab === "new"
          ? createActionButton({ label: "Ship Now", action: "ship-now", orderKey })
          : activeTab === "in_transit"
            ? createActionButton({ label: "Download Slip", action: "download-slip", orderKey })
            : effectiveShipmentStatus === "new"
            ? sessionAssignedOrderKeys.has(orderKey)
              ? createBadge({ label: "Assigned", kind: "warn" })
              : createActionButton({ label: "Ship Now", action: "ship-now", orderKey })
            : createActionButton({ label: "Download Slip", action: "download-slip", orderKey })
        : createAdminUpdateMenu({
            orderKey,
            shipmentStatus: effectiveShipmentStatus,
            trackingText,
          });

    const isShopNewTab = activeRole === "shop" && activeTab === "new";
    const createdAt = formatOrderDate(row?.createdAt);
    const customerEmail = String(row?.customerEmail ?? "").trim();
    const phoneNumber = String(shipping.phone1 ?? shipping.phone2 ?? "").trim();
    const addressLine = [shipping.address1, shipping.address2].filter(Boolean).join(", ");
    const statePin = [shipping.state, shipping.pinCode].filter(Boolean).join("-");
    const fullAddress = [addressLine, statePin].filter(Boolean).join(" ");

    const orderDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.orderName ?? "")}</div>
      <div class="cellMuted">${escapeHtml(createdAt)}</div>
    </div>`;

    const customerDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(shipping.fullName ?? "")}</div>
      <div class="cellMuted">${escapeHtml(phoneNumber)}</div>
      <div class="cellMuted">${escapeHtml(customerEmail)}</div>
      <div class="truncate" title="${escapeHtml(fullAddress)}">${escapeHtml(fullAddress)}</div>
    </div>`;

    const paymentFlag = getPaymentFlag(row?.financialStatus);
    const paymentHtml = `<div class="cellStack">
      <div class="cellPrimary mono">${escapeHtml(row.totalPrice ?? "")}</div>
      <div class="cellMuted">${escapeHtml(paymentFlag)}</div>
    </div>`;

    const shipForm = getShipForm(orderKey);
    const weightCell = isShopNewTab
      ? createWeightInput({ orderKey, value: shipForm.weightKg })
      : "";
    const courierTypeCell = isShopNewTab
      ? createCourierTypeSelect({ orderKey, value: shipForm.courierType })
      : "";

    const cells = [
      { check: true, checked: orderKey && selectedOrderIds.has(orderKey) },
      row.index ?? "",
      isShopNewTab ? { html: orderDetailsHtml } : { text: row.orderName ?? "", className: "mono" },
      { text: row.orderId ?? "", className: "mono" },
      isShopNewTab ? { html: customerDetailsHtml } : (shipping.fullName ?? ""),
      shipping.address1 ?? "",
      shipping.address2 ?? "",
      shipping.city ?? "",
      shipping.state ?? "",
      { text: shipping.pinCode ?? "", className: "mono" },
      phone1Badge ?? { text: phone1, className: "mono" },
      phone2Badge ?? { text: phone2, className: "mono" },
      isShopNewTab ? { html: paymentHtml } : { text: row.totalPrice ?? "", className: "mono" },
      createBadge({ label: fulfillmentLabel, kind: fulfillmentBadgeKind }),
      trackingBadge ?? createTrackingValue({ text: trackingText }),
      createBadge({ label: shipmentLabel, kind: shipmentKind }),
      courierCell,
      weightCell,
      courierTypeCell,
      actionCell,
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      if (value && typeof value === "object" && value.check) {
        td.className = "colCheck";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value.checked);
        input.ariaLabel = "Select row";
        td.appendChild(input);
      } else if (value && typeof value === "object" && value.badge) {
        const span = document.createElement("span");
        span.className =
          value.kind === "ok"
            ? "badge badgeOk"
            : value.kind === "warn"
              ? "badge badgeWarn"
              : value.kind === "error"
                ? "badge badgeError"
              : "badge badgeMuted";
        span.textContent = String(value.label ?? "");
        td.appendChild(span);
      } else if (value && typeof value === "object" && value.menu) {
        const details = document.createElement("details");
        details.className = "menuDetails";

        const summary = document.createElement("summary");
        summary.className = "menuSummary";
        summary.textContent = String(value.label ?? "");
        details.appendChild(summary);

        const menu = document.createElement("div");
        menu.className = "menuPopover";

        const trackLink = document.createElement("a");
        trackLink.className = "menuItem menuLink";
        trackLink.href = String(value.url ?? "");
        trackLink.target = "_blank";
        trackLink.rel = "noopener noreferrer";
        trackLink.dataset.action = "track-now";
        trackLink.dataset.trackingText = String(value.trackingText ?? "");
        trackLink.textContent = "Track Now";
        menu.appendChild(trackLink);

        details.appendChild(menu);
        td.appendChild(details);
      } else if (value && typeof value === "object" && value.trackingValue) {
        const text = String(value.text ?? "").trim();
        const code = getPrimaryTrackingCode(text);
        const span = document.createElement("span");
        span.className = "trackingHover mono";
        span.textContent = text;
        if (code) span.dataset.trackingCode = code;
        td.appendChild(span);
      } else if (value && typeof value === "object" && value.weightInput) {
        td.className = "colWeight";
        const wrap = document.createElement("div");
        wrap.className = "weightWrap";

        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.placeholder = "0.0";
        input.className = "weightInput";
        input.dataset.role = "weight";
        input.dataset.orderKey = String(value.orderKey ?? "");
        input.value = String(value.value ?? "");
        wrap.appendChild(input);

        const suffix = document.createElement("span");
        suffix.className = "weightSuffix";
        suffix.textContent = "Kg";
        wrap.appendChild(suffix);

        td.appendChild(wrap);
      } else if (value && typeof value === "object" && value.courierTypeSelect) {
        td.className = "colCourierType";
        const select = document.createElement("select");
        select.className = "courierTypeSelect";
        select.dataset.role = "courierType";
        select.dataset.orderKey = String(value.orderKey ?? "");
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select Courier type";
        placeholder.disabled = true;
        select.appendChild(placeholder);

        const options = ["Z- Express", "D- Surface", "D- Air"];
        for (const optValue of options) {
          const opt = document.createElement("option");
          opt.value = optValue;
          opt.textContent = optValue;
          select.appendChild(opt);
        }
        select.value = String(value.value ?? "") || "";
        td.appendChild(select);
      } else if (value && typeof value === "object" && value.fulfillmentCenterSelect) {
        const select = document.createElement("select");
        select.className = "fulfillmentCenterSelect";
        select.dataset.role = "fulfillmentCenter";
        select.dataset.orderKey = String(value.orderKey ?? "");
        select.disabled = Boolean(value.disabled);

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Fulfillment Center";
        placeholder.disabled = true;
        select.appendChild(placeholder);

        const opts = Array.isArray(value.options) ? value.options : [];
        for (const o of opts) {
          const label = String(o?.label ?? "").trim();
          if (!label) continue;
          const opt = document.createElement("option");
          opt.value = label;
          opt.textContent = label;
          select.appendChild(opt);
        }

        const selected = String(value.value ?? "").trim();
        select.value = selected || "";
        if (!select.value) select.value = "";
        td.appendChild(select);
      } else if (value && typeof value === "object" && value.actionButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        const action = String(value.action ?? "");
        btn.className = action === "download-slip" ? "btn btnPrimary btnIcon" : "btn btnPrimary";
        btn.dataset.action = action;
        btn.dataset.orderKey = String(value.orderKey ?? "");
        if (action === "download-slip") {
          btn.title = "Download Shipping label";
          btn.ariaLabel = "Download Shipping label";
          const icon = document.createElement("i");
          icon.className = "fa-solid fa-download";
          icon.setAttribute("aria-hidden", "true");
          btn.appendChild(icon);
        } else {
          btn.textContent = String(value.label ?? "");
        }
        td.appendChild(btn);
      } else if (value && typeof value === "object" && value.adminMenu) {
        const details = document.createElement("details");
        details.className = "menuDetails";

        const summary = document.createElement("summary");
        summary.className = "menuSummary";
        summary.textContent = "Update";
        details.appendChild(summary);

        const menu = document.createElement("div");
        menu.className = "menuPopover";

        const statusLabel = document.createElement("div");
        statusLabel.className = "menuItem";
        statusLabel.textContent = "Shipment status";
        statusLabel.style.cursor = "default";
        menu.appendChild(statusLabel);

        const select = document.createElement("select");
        select.className = "menuItem";
        select.dataset.role = "shipment-status";
        const options = [
          { value: "new", label: "New" },
          { value: "assigned", label: "Assigned" },
          { value: "in_transit", label: "In Transit" },
          { value: "delivered", label: "Delivered" },
          { value: "rto_initiated", label: "RTO Initiated" },
          { value: "rto_delivered", label: "RTO Delivered" },
        ];
        for (const o of options) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label;
          select.appendChild(opt);
        }
        select.value = String(value.shipmentStatus ?? "new");
        menu.appendChild(select);

        const trackingLabel = document.createElement("div");
        trackingLabel.className = "menuItem";
        trackingLabel.textContent = "Tracking code (optional)";
        trackingLabel.style.cursor = "default";
        menu.appendChild(trackingLabel);

        const trackingInput = document.createElement("input");
        trackingInput.className = "menuItem";
        trackingInput.placeholder = "e.g. 7D112220026";
        trackingInput.dataset.role = "tracking-number";
        trackingInput.value = String(value.trackingText ?? "");
        menu.appendChild(trackingInput);

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "menuItem";
        saveBtn.dataset.action = "admin-save";
        saveBtn.dataset.orderKey = String(value.orderKey ?? "");
        saveBtn.textContent = "Save";
        menu.appendChild(saveBtn);

        const downloadBtn = document.createElement("button");
        downloadBtn.type = "button";
        downloadBtn.className = "menuItem btnIcon";
        downloadBtn.dataset.action = "download-slip";
        downloadBtn.dataset.orderKey = String(value.orderKey ?? "");
        downloadBtn.title = "Download Shipping label";
        downloadBtn.ariaLabel = "Download Shipping label";
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-download";
        icon.setAttribute("aria-hidden", "true");
        downloadBtn.appendChild(icon);
        menu.appendChild(downloadBtn);

        details.appendChild(menu);
        td.appendChild(details);
      } else if (value && typeof value === "object" && "text" in value) {
        td.textContent = String(value.text ?? "");
        if (value.className) td.className = value.className;
      } else if (value && typeof value === "object" && "html" in value) {
        td.innerHTML = value.html;
      } else {
        td.textContent = String(value ?? "");
      }
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);

  syncSelectAllCheckbox();
}

function renderRowsAssignedTab(orders) {
  const tbody = $("rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

  const formatDate = (iso) => {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  };

  const createBadge = ({ label, kind = "muted" }) => ({
    badge: true,
    label,
    kind,
  });

  const getPaymentLabel = (value) => {
    const s = String(value ?? "").trim().toLowerCase();
    if (!s) return { label: "", kind: "unknown" };
    if (s === "paid" || s === "partially_paid") return { label: "Prepaid", kind: "paid" };
    return { label: "COD", kind: "cod" };
  };

  const getTrackingNumber = (row) => {
    const direct = String(row?.trackingNumber ?? "").trim();
    if (direct) return direct;
    const fromText = getPrimaryTrackingCode(
      row?.trackingNumbersText ?? formatTrackingNumbers(row?.trackingNumbers)
    );
    if (fromText) return fromText;
    const arr = Array.isArray(row?.trackingNumbers) ? row.trackingNumbers : [];
    return String(arr[0] ?? "").trim();
  };

  const fragment = document.createDocumentFragment();

  for (const row of currentOrders) {
    const tr = document.createElement("tr");
    const orderKey = getOrderKey(row);
    tr.dataset.orderKey = orderKey;

    const edits = getAssignedEdits(row);
    const createdAt = formatDate(row?.createdAt);
    const pin = normalizePincode(edits.pinCode);
    const serviceable = Boolean(pin) && Boolean(assignedServiceableByPin.get(pin));
    const isEditing = assignedEditMode.has(orderKey) && !serviceable;
    const meta = assignedEditMeta.get(orderKey) ?? null;
    const isDirty = Boolean(meta?.dirty);

    const fullNameCell = isEditing
      ? {
          html: `<input class="inlineInput" data-role="assigned-fullName" data-order-key="${escapeHtml(
            orderKey
          )}" value="${escapeHtml(edits.fullName)}" />`,
        }
      : { text: edits.fullName, className: "" };

    const addressCell = isEditing
      ? {
          html: `<div class="cellStack">
            <div class="cellMuted">${escapeHtml(edits.fullName)}</div>
            <input class="inlineInput" data-role="assigned-address1" data-order-key="${escapeHtml(
              orderKey
            )}" value="${escapeHtml(edits.address1)}" />
            <input class="inlineInput" data-role="assigned-address2" data-order-key="${escapeHtml(
              orderKey
            )}" value="${escapeHtml(edits.address2)}" />
            <input class="inlineInput" data-role="assigned-city" data-order-key="${escapeHtml(
              orderKey
            )}" value="${escapeHtml(edits.city)}" />
            <input class="inlineInput" data-role="assigned-state" data-order-key="${escapeHtml(
              orderKey
            )}" value="${escapeHtml(edits.state)}" />
          </div>`,
        }
      : {
          html: `<div class="cellStack">
            <div class="cellMuted">${escapeHtml(edits.fullName)}</div>
            <div>${escapeHtml(edits.address1)}</div>
            <div>${escapeHtml(edits.address2)}</div>
            <div>${escapeHtml(edits.city)}</div>
            <div>${escapeHtml(edits.state)}</div>
          </div>`,
        };

    const pincodeCell = isEditing
      ? {
          html: `<input class="inlineInput mono" data-role="assigned-pinCode" data-order-key="${escapeHtml(
            orderKey
          )}" value="${escapeHtml(edits.pinCode)}" />`,
        }
      : { text: edits.pinCode, className: "mono" };

    const phoneCell = isEditing
      ? {
          html: `<div class="cellStack">
            <input class="inlineInput mono" data-role="assigned-phone1" data-order-key="${escapeHtml(
              orderKey
            )}" value="${escapeHtml(edits.phone1)}" />
            <input class="inlineInput mono" data-role="assigned-phone2" data-order-key="${escapeHtml(
              orderKey
            )}" value="${escapeHtml(edits.phone2)}" />
          </div>`,
        }
      : {
          html: `<div class="cellStack">
            <div class="mono">${escapeHtml(edits.phone1)}</div>
            <div class="mono">${escapeHtml(edits.phone2)}</div>
          </div>`,
        };

    const invoiceValue = row?.invoiceValue ?? row?.totalPrice ?? "";
    const paymentRaw = row?.paymentStatus ?? row?.financialStatus ?? "";
    const payment = getPaymentLabel(paymentRaw);

    const paymentCell = {
      html: `<span class="paymentStatus ${
        payment.kind === "paid" ? "paymentStatusPaid" : "paymentStatusCod"
      }">${escapeHtml(payment.label)}</span>`,
    };

    const fulfillmentStatusLabel = serviceable ? "Fulfilled" : "Unfulfilled";
    const fulfillmentStatusKind = serviceable ? "ok" : "error";

    const shipmentStatusRaw = String(row?.shipmentStatus ?? "").trim();
    const shipmentStatusLabel = shipmentStatusRaw || "Assigned";

    const trackingNumber = serviceable ? getTrackingNumber(row) : "";
    const courierPartner = String(row?.trackingCompany ?? "").trim();
    const trackingUrl =
      String(row?.trackingUrl ?? "").trim() || buildDtdcTrackingUrl(trackingNumber);

    const trackingCell = {
      html: serviceable
        ? `<div class="cellStack">
            <a class="cellMuted trackingLink" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(courierPartner || "DTDC")}</a>
            <div class="mono">${escapeHtml(trackingNumber || "—")}</div>
          </div>`
        : "",
    };

    const actionParts = [];
    if (serviceable) {
      actionParts.push(
        `<button type="button" class="btn btnPrimary btnCompact btnIcon" data-action="download-slip" data-order-key="${escapeHtml(
          orderKey
        )}" title="Download Shipping label" aria-label="Download Shipping label">
          <i class="fa-solid fa-download" aria-hidden="true"></i>
        </button>`
      );
    } else if (isEditing) {
      actionParts.push(
        `<button type="button" class="btn btnPrimary btnCompact" data-action="save-assigned" data-order-key="${escapeHtml(
          orderKey
        )}" ${isDirty ? "" : "disabled"}>Save</button>`
      );
    } else {
      actionParts.push(
        `<button type="button" class="btn btnSecondary btnCompact" data-action="edit-order" data-order-key="${escapeHtml(
          orderKey
        )}">Edit Order</button>`
      );
    }

    const cells = [
      { check: true, checked: orderKey && selectedOrderIds.has(orderKey) },
      {
        html: `<div class="cellStack">
          <div class="cellPrimary mono">${escapeHtml(row?.orderName ?? "")}</div>
          <div class="cellMuted mono">${escapeHtml(row?.orderId ?? "")}</div>
        </div>`,
      },
      { text: createdAt, className: "mono" },
      fullNameCell,
      addressCell,
      pincodeCell,
      phoneCell,
      { text: String(invoiceValue ?? ""), className: "mono" },
      paymentCell,
      { text: String(row?.productDescription ?? row?.productDiscription ?? row?.product_description ?? "") },
      createBadge({ label: fulfillmentStatusLabel, kind: fulfillmentStatusKind }),
      createBadge({
        label: shipmentStatusLabel.replaceAll("_", " "),
        kind: shipmentStatusLabel.toLowerCase().includes("deliver")
          ? "ok"
          : shipmentStatusLabel.toLowerCase().includes("rto")
            ? "error"
            : "warn",
      }),
      trackingCell,
      { html: `<div class="cellActions">${actionParts.join("")}</div>` },
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      if (value && typeof value === "object" && value.check) {
        td.className = "colCheck";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value.checked);
        input.ariaLabel = "Select row";
        td.appendChild(input);
      } else if (value && typeof value === "object" && value.badge) {
        const span = document.createElement("span");
        span.className =
          value.kind === "ok"
            ? "badge badgeOk"
            : value.kind === "warn"
              ? "badge badgeWarn"
              : value.kind === "error"
                ? "badge badgeError"
                : "badge badgeMuted";
        span.textContent = String(value.label ?? "");
        td.appendChild(span);
      } else if (value && typeof value === "object" && "text" in value) {
        td.textContent = String(value.text ?? "");
        if (value.className) td.className = value.className;
      } else if (value && typeof value === "object" && "html" in value) {
        td.innerHTML = value.html;
      } else {
        td.textContent = String(value ?? "");
      }
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
  syncSelectAllCheckbox();
}

function renderRowsInTransitTab(orders) {
  const tbody = $("rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

  const formatDate = (iso) => formatOrderDate(iso);
  const formatDateTime = (iso) => {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const allowed = ["In Transit", "Undelivered", "At Destination", "Out for Delivery", "Set RTO"];
  const isAdmin = activeRole === "admin";

  const fragment = document.createDocumentFragment();
  for (const row of currentOrders) {
    const tr = document.createElement("tr");

    const orderKey = getOrderKey(row);
    tr.dataset.orderKey = orderKey;

    const orderName = String(row.order_name ?? row.orderName ?? row.order_id ?? "").trim();
    const orderDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(orderName)}</div>
      <div class="cellMuted">${escapeHtml(formatDate(row.order_date))}</div>
    </div>`;

    const customerDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.name ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.address_line_1 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.address_line_2 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.pincode ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.city ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.state ?? "")}</div>
    </div>`;

    const phoneHtml = `<div class="cellStack">
      <div class="cellMuted mono">${escapeHtml(row.phone_1 ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.phone_2 ?? "")}</div>
    </div>`;

    const invoiceHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.content_and_quantity ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.invoice_value ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.payment_status ?? "")}</div>
    </div>`;

    const shippingDateHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(formatDate(row.shipping_date))}</div>
    </div>`;

    const awb = String(row.consignment_number ?? "").trim();
    const courierPartner = String(row.courier_partner ?? "").trim() || (awb ? "DTDC" : "");
    const trackingUrl = awb ? buildDtdcTrackingUrl(awb) : "";
    const courierHtml =
      courierPartner && trackingUrl
        ? `<a class="cellMuted trackingLink" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(courierPartner)}</a>`
        : escapeHtml(courierPartner || "—");
    const trackingHtml = `<div class="cellStack">
      <div class="cellPrimary">${courierHtml}</div>
      <div class="cellMuted mono">${escapeHtml(awb || "—")}</div>
    </div>`;

    const shipmentDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary mono">${escapeHtml(row.weight ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.courier_type ?? "")}</div>
    </div>`;

    const statusValue = String(row.shipment_status ?? "").trim();
    const statusOptionsHtml = allowed
      .map((v) => {
        const selected = v === statusValue ? " selected" : "";
        return `<option value="${escapeHtml(v)}"${selected}>${escapeHtml(v)}</option>`;
      })
      .join("");
    const statusHtml = isAdmin
      ? `<select class="statusSelect" data-role="consignment-status" data-order-key="${escapeHtml(orderKey)}" data-prev-value="${escapeHtml(statusValue)}">
          ${statusOptionsHtml}
        </select>`
      : `<span class="badge badgeMuted">${escapeHtml(statusValue || "—")}</span>`;

    const updatedOnHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(formatDateTime(row.updated_at))}</div>
    </div>`;

    const eddHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(formatDate(row.expected_delivery_date))}</div>
    </div>`;

    const cells = [
      { check: true, checked: orderKey && selectedOrderIds.has(orderKey) },
      { html: orderDetailsHtml },
      { html: customerDetailsHtml },
      { html: phoneHtml },
      { html: invoiceHtml },
      { html: shippingDateHtml },
      { html: trackingHtml },
      { html: shipmentDetailsHtml },
      { html: statusHtml },
      { html: updatedOnHtml },
      { html: eddHtml },
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      if (value && typeof value === "object" && value.check) {
        td.className = "colCheck";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value.checked);
        input.ariaLabel = "Select row";
        td.appendChild(input);
      } else if (value && typeof value === "object" && "html" in value) {
        td.innerHTML = value.html;
      } else {
        td.textContent = String(value ?? "");
      }
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
  syncSelectAllCheckbox();
}

function renderRowsDeliveredTab(orders) {
  const tbody = $("rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

  const formatDate = (iso) => formatOrderDate(iso);
  const formatDateTime = (iso) => {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const fragment = document.createDocumentFragment();
  for (const row of currentOrders) {
    const tr = document.createElement("tr");

    const orderKey = getOrderKey(row);
    tr.dataset.orderKey = orderKey;

    const orderName = String(row.order_name ?? row.orderName ?? row.order_id ?? "").trim();
    const orderDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(orderName)}</div>
      <div class="cellMuted">${escapeHtml(formatDate(row.order_date))}</div>
    </div>`;

    const customerDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.name ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.address_line_1 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.address_line_2 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.pincode ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.city ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.state ?? "")}</div>
    </div>`;

    const phoneHtml = `<div class="cellStack">
      <div class="cellMuted mono">${escapeHtml(row.phone_1 ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.phone_2 ?? "")}</div>
    </div>`;

    const invoiceHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.content_and_quantity ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.total_price_including_gst ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.payment_mode ?? "")}</div>
    </div>`;

    const shippingDateHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(formatDate(row.shipping_date))}</div>
    </div>`;

    const awb = String(row.consignment_number ?? "").trim();
    const courierPartner = String(row.courier_partner ?? "").trim() || (awb ? "DTDC" : "");
    const trackingUrl = awb ? buildDtdcTrackingUrl(awb) : "";
    const courierHtml =
      courierPartner && trackingUrl
        ? `<a class="cellMuted trackingLink" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(courierPartner)}</a>`
        : escapeHtml(courierPartner || "—");
    const trackingHtml = `<div class="cellStack">
      <div class="cellPrimary">${courierHtml}</div>
      <div class="cellMuted mono">${escapeHtml(awb || "—")}</div>
    </div>`;

    const shipmentDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary mono">${escapeHtml(row.weight ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.courier_type ?? "")}</div>
    </div>`;

    const updatedOnHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(formatDateTime(row.updated_at))}</div>
    </div>`;

    const cells = [
      { check: true, checked: orderKey && selectedOrderIds.has(orderKey) },
      { html: orderDetailsHtml },
      { html: customerDetailsHtml },
      { html: phoneHtml },
      { html: invoiceHtml },
      { html: shippingDateHtml },
      { html: trackingHtml },
      { html: shipmentDetailsHtml },
      { html: `<span class="badge badgeOk">Delivered</span>` },
      { html: updatedOnHtml },
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      if (value && typeof value === "object" && value.check) {
        td.className = "colCheck";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value.checked);
        input.ariaLabel = "Select row";
        td.appendChild(input);
      } else if (value && typeof value === "object" && "html" in value) {
        td.innerHTML = value.html;
      } else {
        td.textContent = String(value ?? "");
      }
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
  syncSelectAllCheckbox();
}

function renderRowsRtoTab(orders) {
  const tbody = $("rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

  const formatDate = (iso) => formatOrderDate(iso);
  const formatDateTime = (iso) => {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const allowed = ["RTO Accepted", "RTO In Transit", "RTO Reached At Destination", "RTO Delivered"];
  const isAdmin = activeRole === "admin";

  const fragment = document.createDocumentFragment();
  for (const row of currentOrders) {
    const tr = document.createElement("tr");

    const orderKey = getOrderKey(row);
    tr.dataset.orderKey = orderKey;

    const orderName = String(row.order_name ?? row.orderName ?? row.order_id ?? "").trim();
    const orderDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(orderName)}</div>
      <div class="cellMuted">${escapeHtml(formatDate(row.order_date))}</div>
    </div>`;

    const customerDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.name ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.address_line_1 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.address_line_2 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.pincode ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.city ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.state ?? "")}</div>
    </div>`;

    const phoneHtml = `<div class="cellStack">
      <div class="cellMuted mono">${escapeHtml(row.phone_1 ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.phone_2 ?? "")}</div>
    </div>`;

    const invoiceHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.content_and_quantity ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.total_price_including_gst ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.payment_mode ?? "")}</div>
    </div>`;

    const shippingDateHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(formatDate(row.shipping_date))}</div>
    </div>`;

    const awb = String(row.consignment_number ?? "").trim();
    const courierPartner = String(row.courier_partner ?? "").trim() || (awb ? "DTDC" : "");
    const trackingUrl = awb ? buildDtdcTrackingUrl(awb) : "";
    const courierHtml =
      courierPartner && trackingUrl
        ? `<a class="cellMuted trackingLink" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(courierPartner)}</a>`
        : escapeHtml(courierPartner || "—");
    const trackingHtml = `<div class="cellStack">
      <div class="cellPrimary">${courierHtml}</div>
      <div class="cellMuted mono">${escapeHtml(awb || "—")}</div>
    </div>`;

    const shipmentDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary mono">${escapeHtml(row.weight ?? "")}</div>
      <div class="cellMuted">${escapeHtml(row.courier_type ?? "")}</div>
    </div>`;

    const statusValue = String(row.shipment_status ?? "").trim();
    const statusOptionsHtml = allowed
      .map((v) => {
        const selected = v === statusValue ? " selected" : "";
        return `<option value="${escapeHtml(v)}"${selected}>${escapeHtml(v)}</option>`;
      })
      .join("");
    const statusHtml = isAdmin
      ? `<select class="statusSelect" data-role="consignment-status" data-order-key="${escapeHtml(orderKey)}" data-prev-value="${escapeHtml(statusValue)}">
          ${statusOptionsHtml}
        </select>`
      : `<span class="badge badgeMuted">${escapeHtml(statusValue || "—")}</span>`;

    const updatedOnHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(formatDateTime(row.updated_at))}</div>
    </div>`;

    const cells = [
      { check: true, checked: orderKey && selectedOrderIds.has(orderKey) },
      { html: orderDetailsHtml },
      { html: customerDetailsHtml },
      { html: phoneHtml },
      { html: invoiceHtml },
      { html: shippingDateHtml },
      { html: trackingHtml },
      { html: shipmentDetailsHtml },
      { html: statusHtml },
      { html: updatedOnHtml },
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      if (value && typeof value === "object" && value.check) {
        td.className = "colCheck";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value.checked);
        input.ariaLabel = "Select row";
        td.appendChild(input);
      } else if (value && typeof value === "object" && "html" in value) {
        td.innerHTML = value.html;
      } else {
        td.textContent = String(value ?? "");
      }
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
  syncSelectAllCheckbox();
}

function renderRowsNewTab(orders) {
  const tbody = $("rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

  const fragment = document.createDocumentFragment();

  const formatDate = (iso) => {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  };

  const getPaymentLabel = (value) => {
    const s = String(value ?? "").trim().toLowerCase();
    if (!s) return { label: "", kind: "unknown" };
    if (s === "paid" || s === "partially_paid") return { label: "Paid", kind: "paid" };
    return { label: "COD", kind: "cod" };
  };

  const createActionButton = ({ label, action, orderKey }) => ({
    actionButton: true,
    label,
    action,
    orderKey,
  });

  for (const row of currentOrders) {
    const tr = document.createElement("tr");
    const orderKey = getOrderKey(row);
    tr.dataset.orderKey = orderKey;

    const shipping = row?.shipping ?? {};
    const createdAt = formatDate(row?.createdAt);
    const orderDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.orderName ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.orderId ?? "")}</div>
      <div class="cellMuted">${escapeHtml(createdAt)}</div>
    </div>`;

    const customerDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(shipping.fullName ?? "")}</div>
      <div class="cellMuted">${escapeHtml(shipping.address1 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(shipping.address2 ?? "")}</div>
      <div class="cellMuted">${escapeHtml(shipping.city ?? "")}</div>
      <div class="cellMuted">${escapeHtml(shipping.state ?? "")}</div>
    </div>`;

    const phoneHtml = `<div class="cellStack">
      <div class="cellMuted mono">${escapeHtml(shipping.phone1 ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(shipping.phone2 ?? "")}</div>
    </div>`;

    const paymentStatus = row.paymentStatus ?? row.financialStatus ?? "";
    const payment = getPaymentLabel(paymentStatus);
    const invoiceDetailsHtml = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(row.productDescription ?? "")}</div>
      <div class="cellMuted mono">${escapeHtml(row.invoiceValue ?? row.totalPrice ?? "")}</div>
      <div class="cellMuted paymentStatus ${
        payment.kind === "paid" ? "paymentStatusPaid" : "paymentStatusCod"
      }">${escapeHtml(payment.label)}</div>
    </div>`;

    const shipForm = getShipForm(orderKey);
    const weightCell = createWeightInput({ orderKey, value: shipForm.weightKg });

    const courierTypeCell = createCourierTypeSelect({ orderKey, value: shipForm.courierType });

    const centers = Array.isArray(fulfillmentCentersState.centers)
      ? fulfillmentCentersState.centers
      : [];
    const centerOptions = centers.map((c) => ({ label: String(c?.originName ?? "").trim() }));
    const centerValue =
      String(shipForm.fulfillmentCenter ?? "").trim() ||
      String(row.fulfillmentCenter ?? "").trim() ||
      String(fulfillmentCentersState.defaultName ?? "").trim();
    const fulfillmentCenterCell = createFulfillmentCenterSelect({
      orderKey,
      value: centerValue,
      options: centerOptions,
      disabled: centerOptions.length === 0,
    });

    const actionCell = createActionButton({ label: "Ship Now", action: "ship-now", orderKey });

    const cells = [
      { check: true, checked: orderKey && selectedOrderIds.has(orderKey) },
      { html: orderDetailsHtml },
      { html: customerDetailsHtml },
      { text: shipping.pinCode ?? "", className: "mono" },
      { html: phoneHtml },
      { html: invoiceDetailsHtml },
      fulfillmentCenterCell,
      weightCell,
      courierTypeCell,
      actionCell,
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      if (value && typeof value === "object" && value.check) {
        td.className = "colCheck";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value.checked);
        input.ariaLabel = "Select row";
        td.appendChild(input);
      } else if (value && typeof value === "object" && value.weightInput) {
        td.className = "colWeight";
        const wrap = document.createElement("div");
        wrap.className = "weightWrap";

        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.placeholder = "0.0";
        input.className = "weightInput";
        input.dataset.role = "weight";
        input.dataset.orderKey = String(value.orderKey ?? "");
        input.value = String(value.value ?? "");
        wrap.appendChild(input);

        const suffix = document.createElement("span");
        suffix.className = "weightSuffix";
        suffix.textContent = "Kg";
        wrap.appendChild(suffix);

        td.appendChild(wrap);
      } else if (value && typeof value === "object" && value.courierTypeSelect) {
        td.className = "colCourierType";
        const select = document.createElement("select");
        select.className = "courierTypeSelect";
        select.dataset.role = "courierType";
        select.dataset.orderKey = String(value.orderKey ?? "");
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select Courier type";
        placeholder.disabled = true;
        select.appendChild(placeholder);

        const options = ["Z- Express", "D- Surface", "D- Air", "COD Surface", "COD Air"];
        for (const optValue of options) {
          const opt = document.createElement("option");
          opt.value = optValue;
          opt.textContent = optValue;
          select.appendChild(opt);
        }
        select.value = String(value.value ?? "") || "";
        td.appendChild(select);
      } else if (value && typeof value === "object" && value.fulfillmentCenterSelect) {
        const select = document.createElement("select");
        select.className = "fulfillmentCenterSelect";
        select.dataset.role = "fulfillmentCenter";
        select.dataset.orderKey = String(value.orderKey ?? "");
        select.disabled = Boolean(value.disabled);

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select Fulfillment Center";
        placeholder.disabled = true;
        select.appendChild(placeholder);

        const opts = Array.isArray(value.options) ? value.options : [];
        for (const o of opts) {
          const label = String(o?.label ?? "").trim();
          if (!label) continue;
          const opt = document.createElement("option");
          opt.value = label;
          opt.textContent = label;
          select.appendChild(opt);
        }

        const selected = String(value.value ?? "").trim();
        select.value = selected || "";
        if (!select.value) select.value = "";
        td.appendChild(select);
      } else if (value && typeof value === "object" && value.actionButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        const action = String(value.action ?? "");
        btn.className = "btn btnPrimary btnCompact";
        btn.dataset.action = action;
        btn.dataset.orderKey = String(value.orderKey ?? "");
        btn.textContent = String(value.label ?? "");
        td.appendChild(btn);
      } else if (value && typeof value === "object" && "text" in value) {
        td.textContent = String(value.text ?? "");
        if (value.className) td.className = value.className;
      } else if (value && typeof value === "object" && "html" in value) {
        td.innerHTML = value.html;
      } else {
        td.textContent = String(value ?? "");
      }
      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
  syncSelectAllCheckbox();
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function buildCsvForOrders(orders) {
  const headers = [
    "#",
    "Order Name",
    "Order ID",
    "Full Name",
    "Address 1",
    "Address 2",
    "City",
    "State",
    "PIN Code",
    "Phone 1",
    "Phone 2",
    "Total Price",
    "Fulfillment Status",
    "Tracking Numbers",
    "Shipments Status",
    "Courier Partner",
    "Tracking URL",
  ];

  const lines = [];
  lines.push(headers.map(csvEscape).join(","));

  for (const row of orders) {
    const shipping = row?.shipping ?? {};
    const line = [
      row.index ?? "",
      row.orderName ?? "",
      row.orderId ?? "",
      shipping.fullName ?? "",
      shipping.address1 ?? "",
      shipping.address2 ?? "",
      shipping.city ?? "",
      shipping.state ?? "",
      shipping.pinCode ?? "",
      shipping.phone1 ?? "",
      shipping.phone2 ?? "",
      row.totalPrice ?? "",
      row.fulfillmentStatus ?? "",
      row.trackingNumbersText ?? formatTrackingNumbers(row.trackingNumbers),
      getEffectiveShipmentStatus(row),
      row.trackingCompany ?? "",
      row.trackingUrl ?? "",
    ];
    lines.push(line.map(csvEscape).join(","));
  }

  return lines.join("\n");
}

function downloadTextFile({ filename, text, mimeType }) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportSelectedToCsv() {
  const selected = currentOrders.filter((row) =>
    selectedOrderIds.has(getOrderKey(row))
  );

  if (selected.length === 0) {
    setStatus("Select at least one order to export.", { kind: "error" });
    return;
  }

  const csv = buildCsvForOrders(selected);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  downloadTextFile({
    filename: `orders_${timestamp}.csv`,
    text: csv,
    mimeType: "text/csv;charset=utf-8",
  });
  setStatus(`Exported ${selected.length} order(s) to CSV.`, { kind: "ok" });
}

async function refresh({ forceNetwork = false } = {}) {
  const limit = SHOPIFY_MAX_LIMIT;
  const since = getSinceIsoForRange(getDateRange());

  // Clear any stale rows immediately so tabs don't show previous data if this load fails.
  allOrders = [];
  pruneSelectionToVisible(allOrders);
  applyFiltersAndSort();

  setStatus(forceNetwork ? "Syncing…" : "Loading…");
  setLoading(true);

  try {
    if (activeRole === "admin") {
      const storeId = getActiveStoreId();
      if (!storeId) {
        allOrders = [];
        applyFiltersAndSort();
        setStatus("Select a store.", { kind: "info" });
        return;
      }

      const useConsignments = ["in_transit", "delivered", "rto"].includes(activeTab);
      const data = useConsignments
        ? await fetchConsignments({ tab: activeTab, storeId, limit: 250 })
        : await fetchFirestoreAdminOrders({
            storeId,
            status: activeTab && activeTab !== "all" ? activeTab : "all",
            limit: 250,
          });
      const orders = Array.isArray(data?.orders) ? data.orders : [];
      allOrders = orders;

      pruneSelectionToVisible(orders);

      applyFiltersAndSort();
      return;
    }

    if (activeRole === "shop") {
      if (activeTab === "assigned") {
        await ensureFirestoreAssignedRealtime();
        const orders = Array.isArray(firestoreAssignedState.orders)
          ? firestoreAssignedState.orders
          : [];
        allOrders = orders;
        pruneSelectionToVisible(orders);
        applyFiltersAndSort();
        hydrateAssignedProductDescriptions(orders).catch(() => {});
        hydrateAssignedServiceablePins(orders).catch(() => {});
        if (firestoreAssignedState.ready) {
          setStatus(`Loaded ${allOrders.length} assigned order(s).`, { kind: "ok" });
        }
        return;
      }

      if (["in_transit", "delivered", "rto", "all"].includes(activeTab)) {
        if (activeTab === "all") {
          const data = await fetchFirestoreOrders({ status: "all", limit: 250 });
          const orders = Array.isArray(data?.orders) ? data.orders : [];
          allOrders = orders;
          pruneSelectionToVisible(orders);
          applyFiltersAndSort();
          setStatus(`Loaded ${orders.length} order(s).`, { kind: "ok" });
          return;
        }

        const storeId = String(document.body?.dataset?.storeId ?? "").trim();
        const data = await fetchConsignments({ tab: activeTab, storeId, limit: 250 });
        const orders = Array.isArray(data?.orders) ? data.orders : [];
        allOrders = orders;
        pruneSelectionToVisible(orders);
        applyFiltersAndSort();
        setStatus(`Loaded ${orders.length} order(s).`, { kind: "ok" });
        return;
      }
    }

    const data = await fetchLatestOrders({ limit, since });
    let orders = Array.isArray(data?.orders) ? data.orders : [];

    // Shop "New" tab: show only orders that are not fulfilled.
    if (activeRole === "shop" && activeTab === "new") {
      orders = orders.filter(
        (row) => normalizeFulfillmentStatus(row?.fulfillmentStatus) !== "fulfilled"
      );
    }

    allOrders = orders;

    pruneSelectionToVisible(orders);

    applyFiltersAndSort();
  } catch (error) {
    allOrders = [];
    pruneSelectionToVisible(allOrders);
    applyFiltersAndSort();
    setStatus(error?.message ?? "Failed to load orders.", { kind: "error" });
  } finally {
    setLoading(false);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  activeRole = normalizeRole(document.body?.dataset?.role);
  if (document.body) document.body.dataset.role = activeRole;

  setDateRange(getDateRange());

  const url = new URL(window.location.href);
  const tabFromUrl = String(url.searchParams.get("tab") ?? "").trim().toLowerCase();
  const allowedTabs = new Set(["assigned", "in_transit", "delivered", "rto", "all"]);
  if (activeRole === "shop") allowedTabs.add("new");
  setActiveTab(allowedTabs.has(tabFromUrl) ? tabFromUrl : getDefaultTabForRole(activeRole));

  if (activeRole === "shop") {
    ensureFulfillmentCentersLoaded().then(() => {
      if (activeTab === "new") renderRows(currentOrders);
    });
  }

  document.querySelectorAll(".tabBtn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = String(btn.dataset.tab ?? "");
      setActiveTab(tab);
      refresh({ forceNetwork: false });
    });
  });

  if (activeRole === "admin") {
    fetchStores()
      .then((data) => {
        const stores = Array.isArray(data?.stores) ? data.stores : [];
        const select = $("storeSelect");
        if (!select || stores.length === 0) return;

        const defaultStoreId = String(data?.defaultStoreId ?? "").trim();
        const currentStoreId = getActiveStoreId();
        const activeStoreId =
          currentStoreId || defaultStoreId || String(stores[0]?.shopDomain ?? "");

        select.innerHTML = "";
        for (const s of stores) {
          const opt = document.createElement("option");
          opt.value = String(s.shopDomain ?? "");
          opt.textContent = String(s.shopDomain ?? "");
          select.appendChild(opt);
        }
        select.value = activeStoreId;

        if (!currentStoreId && activeStoreId) {
          setActiveStoreId(activeStoreId);
          return;
        }

        select.addEventListener("change", (e) => {
          const nextId = String(e.target?.value ?? "").trim();
          if (nextId && nextId !== getActiveStoreId()) setActiveStoreId(nextId);
        });
      })
      .catch(() => {});
  }

  if (activeRole === "admin") {
    fetchShop()
      .then((data) => {
        const shop = data?.shop ?? {};
        const storeName = String(shop?.name ?? "").trim();
        const storeDomain = String(shop?.myshopify_domain ?? "").trim();
        const storeEl = $("storeName");
        if (!storeEl) return;

        if (storeName || storeDomain) {
          storeEl.textContent = "";
          const nameSpan = document.createElement("span");
          nameSpan.className = "storeNameMain";
          nameSpan.textContent = storeName || "Unknown";
          storeEl.appendChild(nameSpan);

          if (storeDomain) {
            const domainSpan = document.createElement("span");
            domainSpan.className = "storeNameDomain";
            domainSpan.textContent = storeDomain;
            storeEl.appendChild(domainSpan);
          }
        } else {
          storeEl.textContent = "Unknown";
        }
      })
      .catch(() => {
        const storeEl = $("storeName");
        if (storeEl) storeEl.textContent = "Unknown";
      });
  }

  $("dateRange")?.addEventListener("change", (e) => {
    setDateRange(e.target?.value);
  });
  $("refresh")?.addEventListener("click", () => refresh({ forceNetwork: true }));
  $("exportCsv")?.addEventListener("click", exportSelectedToCsv);
  $("bulkDownloadLabels")?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("button");
    const orderKeys = Array.from(selectedOrderIds);
    if (orderKeys.length === 0) {
      setStatus("Select at least one order to download labels.", { kind: "error" });
      return;
    }

    const storeId = activeRole === "admin" ? getActiveStoreId() : "";
    if (activeRole === "admin" && !storeId) {
      setStatus("Select a store before downloading labels.", { kind: "error" });
      return;
    }

    btn.disabled = true;
    try {
      await downloadBulkShipmentLabelsPdf({ orderKeys, storeId });
    } catch (error) {
      setStatus(error?.message ?? "Failed to download labels.", { kind: "error" });
    } finally {
      btn.disabled = false;
      syncBulkDownloadButton();
    }
  });
  $("bulkShip")?.addEventListener("click", async (e) => {
    const btn = e.target;
    const selected = currentOrders.filter((row) => selectedOrderIds.has(getOrderKey(row)));
    if (selected.length === 0) {
      setStatus("Select at least one order to ship.", { kind: "error" });
      return;
    }

    btn.disabled = true;
    try {
      for (const row of selected) {
        const orderKey = getOrderKey(row);
        const meta = getShipForm(orderKey);
        if (!String(meta.courierType ?? "").trim()) {
          throw new Error("Select Courier type before shipping.");
        }
        const parsed = parseWeightKg(meta.weightKg);
        if (!parsed.ok) {
          throw new Error("Invalid weight. Use e.g. 0.1");
        }
      }

      await Promise.all(
        selected.map((row) =>
          (() => {
            const orderKey = getOrderKey(row);
            const meta = getShipForm(orderKey);
            const parsed = parseWeightKg(meta.weightKg);
            const center =
              String(meta.fulfillmentCenter ?? "").trim() ||
              String(row.fulfillmentCenter ?? "").trim() ||
              String(fulfillmentCentersState.defaultName ?? "").trim();
            if (center) row.fulfillmentCenter = center;
            return postJson("/api/shipments/assign", {
              orderKey,
              order: row,
              weightKg: parsed.value,
              courierType: String(meta.courierType ?? ""),
            });
          })()
        )
      );
      for (const row of selected) {
        const key = getOrderKey(row);
        if (!key) continue;
        if (activeTab !== "new") sessionAssignedOrderKeys.add(key);
        selectedOrderIds.delete(key);
      }
      setStatus(`Assigned ${selected.length} order(s).`, { kind: "ok" });
      renderRows(currentOrders);
      syncSelectAllCheckbox();
    } catch (error) {
      setStatus(error?.message ?? "Failed to bulk assign shipments.", { kind: "error" });
    } finally {
      btn.disabled = false;
    }
  });
  $("fulfillmentFilter")?.addEventListener("change", applyFiltersAndSort);
  $("trackingFilter")?.addEventListener("change", applyFiltersAndSort);

  $("rows")?.addEventListener("change", async (e) => {
    const target = e.target;
    if (!target) return;

    if (target.tagName === "SELECT" && String(target.dataset?.role ?? "") === "consignment-status") {
      if (activeRole !== "admin") return;
      if (!["in_transit", "rto"].includes(activeTab)) return;

      const tr = target.closest("tr");
      const orderKey = String(target.dataset?.orderKey ?? tr?.dataset?.orderKey ?? "").trim();
      if (!orderKey) return;

      const storeId = getActiveStoreId();
      if (!storeId) {
        setStatus("Select a store before updating status.", { kind: "error" });
        return;
      }

      const prev = String(target.dataset.prevValue ?? "");
      const nextValue = String(target.value ?? "").trim();
      target.disabled = true;
      try {
        await postJson("/api/consignments/update-status", {
          orderKey,
          storeId,
          shipment_status: nextValue,
        });
        target.dataset.prevValue = nextValue;
        setStatus("Status updated.", { kind: "ok" });
        await refresh({ forceNetwork: true });
      } catch (error) {
        if (prev) target.value = prev;
        setStatus(error?.message ?? "Failed to update status.", { kind: "error" });
      } finally {
        target.disabled = false;
      }
      return;
    }

    if (target.tagName === "INPUT" && target.type === "checkbox") {
      const tr = target.closest("tr");
      const orderKey = String(tr?.dataset?.orderKey ?? "");
      if (!orderKey) return;

      if (target.checked) selectedOrderIds.add(orderKey);
      else selectedOrderIds.delete(orderKey);

      syncSelectAllCheckbox();
      syncBulkDownloadButton();
    }
  });

  const ensureBarcodeTooltip = () => {
    let el = document.getElementById("barcodeTooltip");
    if (el) return el;
    el = document.createElement("div");
    el.id = "barcodeTooltip";
    el.className = "barcodeTooltip";
    el.innerHTML = `<div class="barcodeCard">
      <img class="barcodeImg" alt="Barcode" />
      <div class="barcodeText mono"></div>
    </div>`;
    document.body.appendChild(el);
    return el;
  };

  const hideBarcodeTooltip = () => {
    const el = document.getElementById("barcodeTooltip");
    if (el) el.remove();
  };

  $("rows")?.addEventListener("mouseover", (e) => {
    const target = e.target;
    const span = target?.closest?.(".trackingHover");
    if (!span) return;
    const code = String(span.dataset.trackingCode ?? "").trim();
    if (!code) return;

    const url = buildBwipJsCode128Url(code);
    if (!url) return;

    const tooltip = ensureBarcodeTooltip();
    const img = tooltip.querySelector(".barcodeImg");
    const text = tooltip.querySelector(".barcodeText");
    if (img) img.src = url;
    if (text) text.textContent = code;

    const rect = span.getBoundingClientRect();
    const padding = 10;
    const tooltipWidth = 320;
    const tooltipHeight = 150;

    let left = rect.left;
    let top = rect.bottom + padding;
    if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - tooltipWidth - padding;
    }
    if (top + tooltipHeight > window.innerHeight - padding) {
      top = rect.top - tooltipHeight - padding;
    }
    left = Math.max(padding, left);
    top = Math.max(padding, top);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  });

  $("rows")?.addEventListener("mouseout", (e) => {
    const target = e.target;
    if (!target?.closest?.(".trackingHover")) return;
    hideBarcodeTooltip();
  });

  $("rows")?.addEventListener("click", async (e) => {
    const item = e.target?.closest?.("[data-action]");
    if (!item) return;

    const action = item.dataset.action ?? "";

    const closeMenu = () => {
      item.closest("details")?.removeAttribute("open");
    };

    if (action === "track-now") {
      // Let the anchor open in a new tab; close the menu after the click.
      setTimeout(closeMenu, 0);
      return;
    }

    if (action === "ship-now") {
      const orderKey = String(item.dataset.orderKey ?? "").trim();
      if (!orderKey) return;
      const order = currentOrders.find((r) => getOrderKey(r) === orderKey) ?? null;
      item.disabled = true;
      try {
        if (!order) throw new Error("Order not found.");
        const meta = getShipForm(orderKey);
        if (!String(meta.courierType ?? "").trim()) {
          throw new Error("Select Courier type before shipping.");
        }
        const parsed = parseWeightKg(meta.weightKg);
        if (!parsed.ok) {
          throw new Error("Invalid weight. Use e.g. 0.1");
        }
        const center =
          String(meta.fulfillmentCenter ?? "").trim() ||
          String(order.fulfillmentCenter ?? "").trim() ||
          String(fulfillmentCentersState.defaultName ?? "").trim();
        if (center) order.fulfillmentCenter = center;
        const result = await postJson("/api/shipments/assign", {
          orderKey,
          order,
          weightKg: parsed.value,
          courierType: String(meta.courierType ?? ""),
        });
        if (activeTab !== "new") sessionAssignedOrderKeys.add(orderKey);
        const alreadyAssigned = Boolean(result?.alreadyAssigned);
        const collectionId = String(result?.firestore?.collectionId ?? "").trim();
        const docId = String(result?.firestore?.docId ?? "").trim();
        setStatus(
          alreadyAssigned
            ? "Already assigned."
            : collectionId && docId
              ? `Shipment saved (collection=${collectionId}, doc=${docId}).`
              : "Shipment saved.",
          { kind: "ok" }
        );
        renderRows(currentOrders);
        syncSelectAllCheckbox();
      } catch (error) {
        setStatus(error?.message ?? "Failed to assign shipment.", { kind: "error" });
      } finally {
        item.disabled = false;
      }
      return;
    }

    if (action === "download-slip") {
      const orderKey = String(item.dataset.orderKey ?? "").trim();
      if (!orderKey) return;
      const row = currentOrders.find((r) => getOrderKey(r) === orderKey) ?? null;
      const filenameHint = row?.orderName ? `label_${row.orderName}` : `label_${orderKey}`;

      const storeId = activeRole === "admin" ? getActiveStoreId() : "";
      if (activeRole === "admin" && !storeId) {
        setStatus("Select a store before downloading label.", { kind: "error" });
        return;
      }

      item.disabled = true;
      try {
        await downloadShipmentLabelPdf({ orderKey, storeId, filenameHint });
      } catch (error) {
        setStatus(error?.message ?? "Failed to download label.", { kind: "error" });
      } finally {
        item.disabled = false;
      }
      return;
    }

    if (action === "admin-save") {
      if (activeRole !== "admin") return;
      const orderKey = String(item.dataset.orderKey ?? "").trim();
      if (!orderKey) return;

      const storeId = getActiveStoreId();
      if (!storeId) {
        setStatus("Select a store before updating shipments.", { kind: "error" });
        return;
      }

      const details = item.closest("details");
      const statusSelect = details?.querySelector?.("[data-role='shipment-status']");
      const trackingInput = details?.querySelector?.("[data-role='tracking-number']");
      const shipmentStatus = String(statusSelect?.value ?? "").trim();
      const trackingNumber = String(trackingInput?.value ?? "").trim();

      item.disabled = true;
      try {
        await postJson("/api/shipments/update", { orderKey, storeId, shipmentStatus, trackingNumber });
        setStatus("Shipment updated.", { kind: "ok" });
        await refresh({ forceNetwork: true });
      } catch (error) {
        setStatus(error?.message ?? "Failed to update shipment.", { kind: "error" });
      } finally {
        item.disabled = false;
        closeMenu();
      }
      return;
    }

    if (action === "edit-order") {
      const orderKey = String(item.dataset.orderKey ?? "").trim();
      if (!orderKey) return;
      const row = currentOrders.find((r) => getOrderKey(r) === orderKey) ?? null;
      if (!row) return;
      const edits = getAssignedEdits(row);
      assignedEditMode.add(orderKey);
      assignedEditMeta.set(orderKey, { original: { ...edits }, dirty: false });
      renderRows(currentOrders);
      const input = document.querySelector(
        `input[data-role="assigned-pinCode"][data-order-key="${CSS.escape(orderKey)}"]`
      );
      input?.focus?.();
      return;
    }

    if (action === "save-assigned") {
      const orderKey = String(item.dataset.orderKey ?? "").trim();
      if (!orderKey) return;
      const row = currentOrders.find((r) => getOrderKey(r) === orderKey) ?? null;
      if (!row) return;
      const edits = getAssignedEdits(row);
      const shipping = {
        fullName: edits.fullName,
        address1: edits.address1,
        address2: edits.address2,
        city: edits.city,
        state: edits.state,
        pinCode: normalizePincode(edits.pinCode),
        phone1: String(edits.phone1 ?? "").replaceAll(/[^\d]/g, "").slice(0, 10),
        phone2: String(edits.phone2 ?? "").replaceAll(/[^\d]/g, "").slice(0, 10),
      };

      item.disabled = true;
      try {
        await postJson("/api/firestore/orders/update-shipping", { orderKey, shipping });
        row.shipping = { ...(row.shipping ?? {}), ...shipping };
        assignedEditState.set(orderKey, { ...shipping });
        assignedEditMode.delete(orderKey);
        assignedEditMeta.delete(orderKey);
        const pin = normalizePincode(shipping.pinCode);
        if (pin) assignedServiceableByPin.delete(pin);
        hydrateAssignedServiceablePins([row]).catch(() => {});
        renderRows(currentOrders);
        setStatus("Order updated.", { kind: "ok" });
      } catch (error) {
        setStatus(error?.message ?? "Failed to update order.", { kind: "error" });
      } finally {
        item.disabled = false;
      }
      return;
    }
  });

  $("rows")?.addEventListener("input", (e) => {
    const target = e.target;
    if (!target) return;
    const role = String(target.dataset?.role ?? "");
    const orderKey = String(target.dataset.orderKey ?? "").trim();
    if (!orderKey) return;

    if (activeRole === "shop" && activeTab === "assigned") {
      if (!role.startsWith("assigned-")) return;
      const current = getAssignedEdits({
        orderKey,
        shipping: { fullName: "", address1: "", address2: "", city: "", state: "", pinCode: "", phone1: "", phone2: "" },
      });
      const next = { ...current };
      const value = String(target.value ?? "");
      if (role === "assigned-fullName") next.fullName = value;
      if (role === "assigned-address1") next.address1 = value;
      if (role === "assigned-address2") next.address2 = value;
      if (role === "assigned-city") next.city = value;
      if (role === "assigned-state") next.state = value;
      if (role === "assigned-pinCode") next.pinCode = value.replaceAll(/[^\d]/g, "").slice(0, 6);
      if (role === "assigned-phone1") next.phone1 = value.replaceAll(/[^\d]/g, "").slice(0, 10);
      if (role === "assigned-phone2") next.phone2 = value.replaceAll(/[^\d]/g, "").slice(0, 10);
      assignedEditState.set(orderKey, next);

      const meta = assignedEditMeta.get(orderKey);
      if (meta?.original) {
        const o = meta.original;
        const dirty =
          String(o.fullName ?? "") !== String(next.fullName ?? "") ||
          String(o.address1 ?? "") !== String(next.address1 ?? "") ||
          String(o.address2 ?? "") !== String(next.address2 ?? "") ||
          String(o.city ?? "") !== String(next.city ?? "") ||
          String(o.state ?? "") !== String(next.state ?? "") ||
          normalizePincode(o.pinCode) !== normalizePincode(next.pinCode) ||
          String(o.phone1 ?? "") !== String(next.phone1 ?? "") ||
          String(o.phone2 ?? "") !== String(next.phone2 ?? "");
        assignedEditMeta.set(orderKey, { ...meta, dirty });
        const saveBtn = document.querySelector(
          `button[data-action="save-assigned"][data-order-key="${CSS.escape(orderKey)}"]`
        );
        if (saveBtn) saveBtn.disabled = !dirty;
      }

      target.value = String(
        role === "assigned-pinCode"
          ? next.pinCode
          : role === "assigned-phone1"
            ? next.phone1
            : role === "assigned-phone2"
              ? next.phone2
              : value
      );
      return;
    }

    if (activeRole !== "shop" || activeTab !== "new") return;
    if (role !== "weight") return;

    // Allow only digits and at most one dot and one digit after dot.
    const raw = String(target.value ?? "");
    const cleaned = raw.replace(/[^\d.]/g, "");
    const dotIndex = cleaned.indexOf(".");
    if (dotIndex === -1) {
      target.value = cleaned;
    } else {
      const left = cleaned.slice(0, dotIndex).replaceAll(".", "");
      const right = cleaned.slice(dotIndex + 1).replaceAll(".", "").slice(0, 1);
      target.value = `${left}.${right}`;
    }

    const current = getShipForm(orderKey);
    shipFormState.set(orderKey, { ...current, weightKg: String(target.value ?? "") });
  });

  $("rows")?.addEventListener("change", (e) => {
    if (activeRole !== "shop" || activeTab !== "new") return;
    const target = e.target;
    if (!target) return;
    const role = String(target.dataset?.role ?? "");
    if (role !== "courierType" && role !== "fulfillmentCenter") return;
    const orderKey = String(target.dataset.orderKey ?? "").trim();
    if (!orderKey) return;
    const current = getShipForm(orderKey);
    if (role === "courierType") {
      shipFormState.set(orderKey, { ...current, courierType: String(target.value ?? "") });
    } else {
      shipFormState.set(orderKey, { ...current, fulfillmentCenter: String(target.value ?? "") });
      const row = currentOrders.find((r) => getOrderKey(r) === orderKey) ?? null;
      if (row) row.fulfillmentCenter = String(target.value ?? "");
    }
  });

  refresh();

  const bulkStatusBtn = $("bulkStatusUpload");
  if (bulkStatusBtn) {
    bulkStatusBtn.addEventListener("click", () => {
      window.location.assign("/admin/bulk-upload#status-upload");
    });
  }

  const userMenu = document.querySelector(".userMenu");
  userMenu?.addEventListener("click", (e) => {
    const target = e.target;
    if (!target) return;
    const action = target.dataset?.action ?? "";
    if (action === "logout") {
      e.preventDefault();
      userMenu.removeAttribute("open");
      signOut();
    }
  });
});
