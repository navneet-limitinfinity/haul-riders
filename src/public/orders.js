const $ = (id) => document.getElementById(id);

let allOrders = [];
let currentOrders = [];
const selectedOrderIds = new Set();

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

  if (s === "fulfilled") return "delivered";
  if (s === "unfulfilled") return "new";
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

function getShipForm(orderKey) {
  const key = String(orderKey ?? "").trim();
  if (!key) return { weightKg: "", courierType: "" };
  const existing = shipFormState.get(key);
  if (existing) return existing;
  const initial = { weightKg: "", courierType: "" };
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

function setHeaderText(th, text) {
  if (!th) return;
  const indicator = th.querySelector?.(".sortIndicator") ?? null;
  if (indicator) {
    th.textContent = "";
    th.append(document.createTextNode(`${String(text ?? "")} `));
    th.append(indicator);
    return;
  }
  th.textContent = String(text ?? "");
}

function syncNewTabLayout() {
  if (!document.body) return;
  document.body.dataset.tab = activeTab;

  const isShopNew = activeRole === "shop" && activeTab === "new";

  setHeaderText(
    document.querySelector("th[data-sort-key='orderName']"),
    isShopNew ? "Order Details" : "Order Name"
  );
  setHeaderText(
    document.querySelector("thead th:nth-child(5)"),
    isShopNew ? "Customer Details" : "Full Name"
  );
  setHeaderText(
    document.querySelector("thead th:nth-child(13)"),
    isShopNew ? "Payment" : "Total Price"
  );
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
          rows.push({
            ...(order ?? {}),
            orderKey,
            shipmentStatus: "assigned",
            firestore: {
              requestedAt: String(data.requestedAt ?? ""),
            },
          });
        }
        firestoreAssignedState.orders = rows;
        firestoreAssignedState.ready = true;

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
    view = view.filter((row) => getEffectiveShipmentStatus(row) === activeTab);
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

  const { key, dir } = sortState;
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

function renderRows(orders) {
  const tbody = $("rows");
  if (!tbody) return;

  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

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
    const shipmentLabel =
      activeRole === "shop" && activeTab === "new" && !isFulfilled
        ? "Unfulfilled"
        : effectiveShipmentStatus === "new"
          ? "New"
          : effectiveShipmentStatus === "assigned"
            ? "Assigned"
            : effectiveShipmentStatus === "in_transit"
              ? "In Transit"
              : effectiveShipmentStatus === "delivered"
                ? "Delivered"
                : effectiveShipmentStatus === "rto"
                  ? "RTO"
                  : "New";
    const shipmentKind =
      activeRole === "shop" && activeTab === "new" && !isFulfilled
        ? "muted"
        : effectiveShipmentStatus === "delivered"
          ? "ok"
          : effectiveShipmentStatus === "in_transit" ||
              effectiveShipmentStatus === "assigned"
            ? "warn"
            : effectiveShipmentStatus === "rto"
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
      } else if (value && typeof value === "object" && value.actionButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btnPrimary";
        btn.dataset.action = String(value.action ?? "");
        btn.dataset.orderKey = String(value.orderKey ?? "");
        btn.textContent = String(value.label ?? "");
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
          { value: "rto", label: "RTO" },
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
        downloadBtn.className = "menuItem";
        downloadBtn.dataset.action = "download-slip";
        downloadBtn.dataset.orderKey = String(value.orderKey ?? "");
        downloadBtn.textContent = "Download Slip";
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

async function refresh() {
  const limit = SHOPIFY_MAX_LIMIT;
  const since = getSinceIsoForRange(getDateRange());
  setStatus("Loading…");

  try {
    if (activeRole === "admin") {
      const storeId = getActiveStoreId();
      if (!storeId) {
        allOrders = [];
        applyFiltersAndSort();
        setStatus("Select a store.", { kind: "info" });
        return;
      }

      const status = activeTab && activeTab !== "all" ? activeTab : "all";
      const data = await fetchFirestoreAdminOrders({ storeId, status, limit: 250 });
      const orders = Array.isArray(data?.orders) ? data.orders : [];
      allOrders = orders;

      const visibleIds = new Set(orders.map((r) => getOrderKey(r)));
      for (const selectedId of selectedOrderIds) {
        if (!visibleIds.has(selectedId)) selectedOrderIds.delete(selectedId);
      }

      applyFiltersAndSort();
      return;
    }

    if (activeRole === "shop" && activeTab === "assigned") {
      await ensureFirestoreAssignedRealtime();
      allOrders = Array.isArray(firestoreAssignedState.orders)
        ? firestoreAssignedState.orders
        : [];
      applyFiltersAndSort();
      if (firestoreAssignedState.ready) {
        setStatus(`Loaded ${allOrders.length} assigned order(s).`, { kind: "ok" });
      }
      return;
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

    const visibleIds = new Set(orders.map((r) => getOrderKey(r)));
    for (const selectedId of selectedOrderIds) {
      if (!visibleIds.has(selectedId)) selectedOrderIds.delete(selectedId);
    }

    applyFiltersAndSort();
  } catch (error) {
    setStatus(error?.message ?? "Failed to load orders.", { kind: "error" });
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

  document.querySelectorAll(".tabBtn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = String(btn.dataset.tab ?? "");
      const prevTab = activeTab;
      setActiveTab(tab);

      if (activeRole === "shop" && (tab === "assigned" || prevTab === "assigned")) {
        refresh();
        return;
      }

      if (activeRole === "admin") {
        refresh();
        return;
      }

      applyFiltersAndSort();
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

  $("dateRange")?.addEventListener("change", (e) => {
    setDateRange(e.target?.value);
  });
  $("refresh")?.addEventListener("click", refresh);
  $("exportCsv")?.addEventListener("click", exportSelectedToCsv);
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

  $("selectAll")?.addEventListener("change", (e) => {
    const checked = Boolean(e.target?.checked);
    selectedOrderIds.clear();
    if (checked) {
      for (const row of currentOrders) {
        const key = getOrderKey(row);
        if (key) selectedOrderIds.add(key);
      }
    }
    renderRows(currentOrders);
  });

  $("rows")?.addEventListener("change", (e) => {
    const input = e.target;
    if (!input || input.tagName !== "INPUT" || input.type !== "checkbox") return;
    const tr = input.closest("tr");
    const orderKey = String(tr?.dataset?.orderKey ?? "");
    if (!orderKey) return;

    if (input.checked) selectedOrderIds.add(orderKey);
    else selectedOrderIds.delete(orderKey);

    syncSelectAllCheckbox();
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
        const meta = getShipForm(orderKey);
        if (!String(meta.courierType ?? "").trim()) {
          throw new Error("Select Courier type before shipping.");
        }
        const parsed = parseWeightKg(meta.weightKg);
        if (!parsed.ok) {
          throw new Error("Invalid weight. Use e.g. 0.1");
        }
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
        await refresh();
      } catch (error) {
        setStatus(error?.message ?? "Failed to update shipment.", { kind: "error" });
      } finally {
        item.disabled = false;
        closeMenu();
      }
      return;
    }
  });

  $("rows")?.addEventListener("input", (e) => {
    if (activeRole !== "shop" || activeTab !== "new") return;
    const target = e.target;
    if (!target) return;
    const role = String(target.dataset?.role ?? "");
    if (role !== "weight") return;
    const orderKey = String(target.dataset.orderKey ?? "").trim();
    if (!orderKey) return;

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
    if (role !== "courierType") return;
    const orderKey = String(target.dataset.orderKey ?? "").trim();
    if (!orderKey) return;
    const current = getShipForm(orderKey);
    shipFormState.set(orderKey, { ...current, courierType: String(target.value ?? "") });
  });

  refresh();

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
