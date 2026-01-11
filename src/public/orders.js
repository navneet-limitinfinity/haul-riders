const $ = (id) => document.getElementById(id);

let allOrders = [];
let currentOrders = [];
const selectedOrderIds = new Set();

const getOrderKey = (row) => String(row?.orderKey ?? row?.orderId ?? "");

const formatTrackingNumbers = (trackingNumbers) => {
  if (!Array.isArray(trackingNumbers)) return "";
  return trackingNumbers.filter(Boolean).join(", ");
};

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

let sortState = { key: "orderName", dir: "desc" };

const titleCase = (s) => {
  const text = String(s ?? "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

async function fetchShop() {
  const url = new URL("/api/shopify/shop", window.location.origin);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function fetchLatestOrders({ limit }) {
  const url = new URL("/api/shopify/orders/latest", window.location.origin);
  if (limit) url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
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

  if (fulfillmentFilter !== "all") {
    view = view.filter(
      (row) => normalizeFulfillmentStatus(row?.fulfillmentStatus) === fulfillmentFilter
    );
  }

  if (trackingFilter !== "any") {
    const wantAssigned = trackingFilter === "assigned";
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

  const limit = Number.parseInt($("limit")?.value ?? "10", 10) || 10;
  setStatus(
    `Showing ${sorted.length} of ${allOrders.length} order(s) (limit=${limit}).`,
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

  const fragment = document.createDocumentFragment();
  for (const row of currentOrders) {
    const tr = document.createElement("tr");

    const orderKey = getOrderKey(row);
    tr.dataset.orderKey = orderKey;

    const shipping = row?.shipping ?? {};

    const fulfillmentNorm = normalizeFulfillmentStatus(row?.fulfillmentStatus);
    const fulfillmentLabel =
      fulfillmentNorm === "null" ? "Unknown" : titleCase(fulfillmentNorm);
    const fulfillmentBadgeKind =
      fulfillmentNorm === "fulfilled"
        ? "ok"
        : fulfillmentNorm === "partial"
          ? "warn"
          : "muted";

    const trackingText =
      row.trackingNumbersText ?? formatTrackingNumbers(row.trackingNumbers);
    const trackingBadge =
      trackingText && String(trackingText).trim()
        ? null
        : createBadge({ label: "Not assigned", kind: "muted" });

    const phoneText = String(shipping.phoneNumbersText ?? "").trim();
    const phoneBadge = phoneText
      ? null
      : createBadge({ label: "Missing", kind: "error" });

    const cells = [
      { check: true, checked: orderKey && selectedOrderIds.has(orderKey) },
      row.index ?? "",
      { text: row.orderName ?? "", className: "mono" },
      { text: row.orderId ?? "", className: "mono" },
      shipping.fullName ?? "",
      shipping.address1 ?? "",
      shipping.address2 ?? "",
      shipping.city ?? "",
      shipping.state ?? "",
      { text: shipping.pinCode ?? "", className: "mono" },
      phoneBadge ?? { text: phoneText, className: "mono" },
      { text: row.totalPrice ?? "", className: "mono" },
      createBadge({ label: fulfillmentLabel, kind: fulfillmentBadgeKind }),
      trackingBadge ?? { text: trackingText, className: "mono" },
      row.trackingCompany ?? "",
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
    "Phone Number(s)",
    "Total Price",
    "Fulfillment Status",
    "Tracking Numbers",
    "Tracking Company",
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
      shipping.phoneNumbersText ?? "",
      row.totalPrice ?? "",
      row.fulfillmentStatus ?? "",
      row.trackingNumbersText ?? formatTrackingNumbers(row.trackingNumbers),
      row.trackingCompany ?? "",
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
  const limit = Number.parseInt($("limit")?.value ?? "10", 10) || 10;
  setStatus("Loading…");

  try {
    const data = await fetchLatestOrders({ limit });
    const orders = Array.isArray(data?.orders) ? data.orders : [];

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
      $("storeName").textContent = "Unknown";
    });

  $("refresh")?.addEventListener("click", refresh);
  $("exportCsv")?.addEventListener("click", exportSelectedToCsv);
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

  $("limit")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") refresh();
  });
  refresh();
});
