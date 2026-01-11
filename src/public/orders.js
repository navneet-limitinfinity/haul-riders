const $ = (id) => document.getElementById(id);

let currentOrders = [];
const selectedOrderIds = new Set();

const getShippingAddressLines = (address) => {
  if (!address || typeof address !== "object") return "";

  const lines = [];
  const name = address.name?.trim();
  if (name) lines.push(name);

  const address1 = address.address1?.trim();
  const address2 = address.address2?.trim();
  if (address1) lines.push(address1);
  if (address2) lines.push(address2);

  const city = address.city?.trim();
  const province = address.province?.trim();
  const zip = address.zip?.trim();
  const country = address.country?.trim();
  const cityLine = [city, province, zip].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (country) lines.push(country);

  const phone = address.phone?.trim();
  if (phone) lines.push(phone);

  return lines;
};

const formatShippingAddressText = (address) => {
  const lines = getShippingAddressLines(address);
  if (!Array.isArray(lines) || lines.length === 0) return "";
  return lines.join(" | ");
};

const formatTrackingNumbers = (trackingNumbers) => {
  if (!Array.isArray(trackingNumbers)) return "";
  return trackingNumbers.filter(Boolean).join(", ");
};

async function fetchLatestOrders({ limit }) {
  const url = new URL("/api/shopify/orders/latest", window.location.origin);
  if (limit) url.searchParams.set("limit", String(limit));
  const response = await fetch(url);
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
    const id = String(row?.orderId ?? "");
    if (id && selectedOrderIds.has(id)) selectedCount += 1;
  }

  selectAll.checked = selectedCount === currentOrders.length;
  selectAll.indeterminate =
    selectedCount > 0 && selectedCount < currentOrders.length;
}

function renderRows(orders) {
  const tbody = $("rows");
  if (!tbody) return;

  tbody.innerHTML = "";

  currentOrders = Array.isArray(orders) ? orders : [];

  for (const row of orders) {
    const tr = document.createElement("tr");

    const orderId = String(row?.orderId ?? "");
    tr.dataset.orderId = orderId;

    const shippingLines = getShippingAddressLines(row.shippingAddress);
    const shippingFullText = Array.isArray(shippingLines)
      ? shippingLines.join("\n")
      : "";

    const cells = [
      { check: true, checked: orderId && selectedOrderIds.has(orderId) },
      row.index ?? "",
      row.orderName ?? "",
      row.orderId ?? "",
      { shipping: true, fullText: shippingFullText },
      row.totalPrice ?? "",
      row.fulfillmentStatus ?? "",
      row.trackingNumber ?? "",
      formatTrackingNumbers(row.trackingNumbers),
      row.trackingCompany ?? "",
      row.phone ?? "",
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
      } else if (value && typeof value === "object" && value.shipping) {
        td.className = "colAddress";
        const wrap = document.createElement("div");
        wrap.className = "addrCell";
        wrap.dataset.fullAddress = value.fullText ?? "";

        const text = document.createElement("div");
        text.className = "addrText";
        text.textContent = value.fullText ?? "";
        wrap.appendChild(text);

        const popover = document.createElement("div");
        popover.className = "addrPopover";
        popover.textContent = value.fullText ?? "";
        wrap.appendChild(popover);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "copyBtn";
        copyBtn.setAttribute("aria-label", "Copy address");
        copyBtn.innerHTML = `
          <svg class="copyIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M16 1H6c-1.1 0-2 .9-2 2v12h2V3h10V1zm3 4H10c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16h-9V7h9v14z"/>
          </svg>
        `.trim();
        wrap.appendChild(copyBtn);

        td.appendChild(wrap);
      } else if (value && typeof value === "object" && "html" in value) {
        td.innerHTML = value.html;
      } else {
        td.textContent = String(value ?? "");
      }
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  syncSelectAllCheckbox();
}

async function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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
    "Shipping Address",
    "Total Price",
    "Fulfillment Status",
    "Tracking Number",
    "Tracking Numbers",
    "Tracking Company",
    "Phone",
  ];

  const lines = [];
  lines.push(headers.map(csvEscape).join(","));

  for (const row of orders) {
    const line = [
      row.index ?? "",
      row.orderName ?? "",
      row.orderId ?? "",
      formatShippingAddressText(row.shippingAddress),
      row.totalPrice ?? "",
      row.fulfillmentStatus ?? "",
      row.trackingNumber ?? "",
      formatTrackingNumbers(row.trackingNumbers),
      row.trackingCompany ?? "",
      row.phone ?? "",
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
    selectedOrderIds.has(String(row?.orderId ?? ""))
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

    const visibleIds = new Set(orders.map((r) => String(r?.orderId ?? "")));
    for (const selectedId of selectedOrderIds) {
      if (!visibleIds.has(selectedId)) selectedOrderIds.delete(selectedId);
    }

    renderRows(orders);
    const loadedCount = data?.count ?? orders.length;
    const usedLimit = data?.limit ?? limit;
    setStatus(`Loaded ${loadedCount} order(s) (limit=${usedLimit}).`, {
      kind: "ok",
    });
  } catch (error) {
    setStatus(error?.message ?? "Failed to load orders.", { kind: "error" });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("refresh")?.addEventListener("click", refresh);
  $("exportCsv")?.addEventListener("click", exportSelectedToCsv);
  $("selectAll")?.addEventListener("change", (e) => {
    const checked = Boolean(e.target?.checked);
    selectedOrderIds.clear();
    if (checked) {
      for (const row of currentOrders) {
        const id = String(row?.orderId ?? "");
        if (id) selectedOrderIds.add(id);
      }
    }
    renderRows(currentOrders);
  });

  $("rows")?.addEventListener("change", (e) => {
    const input = e.target;
    if (!input || input.tagName !== "INPUT" || input.type !== "checkbox") return;
    const tr = input.closest("tr");
    const orderId = String(tr?.dataset?.orderId ?? "");
    if (!orderId) return;

    if (input.checked) selectedOrderIds.add(orderId);
    else selectedOrderIds.delete(orderId);

    syncSelectAllCheckbox();
  });

  $("rows")?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("button.copyBtn");
    if (!btn) return;
    const cell = btn.closest(".addrCell");
    const text = cell?.dataset?.fullAddress ?? "";
    try {
      await copyToClipboard(text);
      setStatus("Address copied.", { kind: "ok" });
    } catch {
      setStatus("Failed to copy address.", { kind: "error" });
    }
  });

  $("limit")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") refresh();
  });
  refresh();
});
