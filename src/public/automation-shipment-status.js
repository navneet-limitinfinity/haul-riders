function getIdToken() {
  try {
    return String(localStorage.getItem("haulIdToken") || "").trim();
  } catch {
    return "";
  }
}

function getAuthHeaders() {
  const token = getIdToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

function setDrawerVisible({ drawer, overlay, visible }) {
  if (!drawer || !overlay) return;
  drawer.classList.toggle("isVisible", visible);
  overlay.classList.toggle("isVisible", visible);
  drawer.setAttribute("aria-hidden", visible ? "false" : "true");
  overlay.hidden = !visible;
}

function setStatus(el, text, kind) {
  if (!el) return;
  el.textContent = String(text || "");
  el.dataset.kind = kind || "info";
}

function renderList({ listEl, totalEl, items }) {
  if (!listEl || !totalEl) return;
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    totalEl.textContent = "";
    listEl.innerHTML = '<div class="automationDrawerEmpty">No assigned AWBs pending delivery.</div>';
    return;
  }

  totalEl.textContent = rows.length + " AWB" + (rows.length === 1 ? "" : "s");
  listEl.innerHTML = rows
    .map((item) => {
      const awbNumber = String(item?.awbNumber || "").trim() || "-";
      return (
        '<div class="automationDrawerRow" data-awb="' +
        awbNumber +
        '">' +
        '<div class="automationDrawerMain">' +
        '<span class="automationDrawerAwb mono">' +
        awbNumber +
        "</span>" +
        "</div>" +
        '<div class="automationDrawerActions">' +
        '<button class="iconBtn" type="button" data-action="details" aria-label="Show status details" title="Details">' +
        '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>' +
        "</button>" +
        '<button class="iconBtn" type="button" data-action="refresh" aria-label="Refresh status now" title="Refresh status">' +
        '<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>' +
        "</button>" +
        "</div>" +
        '<div class="automationDrawerDetails" hidden></div>' +
        "</div>" +
        ""
      );
    })
    .join("");
}

function buildDetailsHtml(data) {
  const header = data?.header ?? {};
  const fetchedAt = data?.lastFetchedAt ? String(data.lastFetchedAt) : "";
  const status = String(header?.currentStatusDescription ?? "").trim() || "Unknown";
  const location = String(header?.currentLocationCityName ?? "").trim() || "-";
  const date = String(header?.currentStatusDate ?? "").trim() || "";
  const time = String(header?.currentStatusTime ?? "").trim() || "";
  const when = (date || time) ? (date + (time ? " " + time : "")) : "-";
  const origin = String(header?.originCity ?? "").trim() || "-";
  const dest = String(header?.destinationCity ?? "").trim() || "-";

  return (
    '<div class="awbDetailsGrid">' +
    '<div class="awbDetailsItem"><div class="awbDetailsLabel">Last status</div><div class="awbDetailsValue">' +
    status +
    "</div></div>" +
    '<div class="awbDetailsItem"><div class="awbDetailsLabel">Location</div><div class="awbDetailsValue">' +
    location +
    "</div></div>" +
    '<div class="awbDetailsItem"><div class="awbDetailsLabel">When</div><div class="awbDetailsValue">' +
    when +
    "</div></div>" +
    '<div class="awbDetailsItem"><div class="awbDetailsLabel">Route</div><div class="awbDetailsValue">' +
    origin +
    " -> " +
    dest +
    "</div></div>" +
    (fetchedAt
      ? '<div class="awbDetailsItem awbDetailsItemFull"><div class="awbDetailsLabel">Fetched</div><div class="awbDetailsValue mono">' +
        fetchedAt +
        "</div></div>"
      : "") +
    "</div>"
  );
}

async function fetchAwbUpdate(awb) {
  const response = await fetch("/api/admin/awb-updates/" + encodeURIComponent(awb), {
    cache: "no-store",
    headers: getAuthHeaders(),
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Failed to load details (" + response.status + ")");
  const data = await response.json().catch(() => ({}));
  if (!data || data.ok !== true) throw new Error(String(data?.error || "Unexpected response"));
  return data;
}

async function refreshAwbUpdate(awb) {
  const response = await fetch("/api/admin/awb-updates/" + encodeURIComponent(awb) + "/refresh", {
    method: "POST",
    cache: "no-store",
    headers: { ...getAuthHeaders() },
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Failed to refresh (" + response.status + ")");
  const data = await response.json().catch(() => ({}));
  if (!data || data.ok !== true) throw new Error(String(data?.error || "Unexpected response"));
  return data;
}

async function fetchPendingAwbs({ statusEl, listEl, totalEl, refreshBtn }) {
  if (refreshBtn) refreshBtn.disabled = true;
  setStatus(statusEl, "Loading pending AWBs...", "busy");
  try {
    const response = await fetch("/api/admin/awb-pool/pending?limit=200", {
      cache: "no-store",
      headers: getAuthHeaders(),
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error("Failed to load (" + response.status + ")");
    }
    const data = await response.json().catch(() => ({}));
    if (!data || data.ok !== true) {
      throw new Error(String(data?.error || "Unexpected response"));
    }
    renderList({ listEl, totalEl, items: data.items });
    setStatus(statusEl, "Showing assigned AWBs (refresh if stale)", "ok");
    return true;
  } catch (error) {
    setStatus(statusEl, String(error?.message || "Unable to load AWBs"), "error");
    if (listEl) listEl.innerHTML = "";
    if (totalEl) totalEl.textContent = "";
    return false;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function initShipmentStatusDrawer() {
  const openBtn = document.getElementById("openAwbDrawer");
  const overlay = document.getElementById("awbDrawerOverlay");
  const drawer = document.getElementById("awbDrawer");
  const closeBtn = document.getElementById("closeAwbDrawer");
  const statusEl = document.getElementById("awbDrawerStatus");
  const listEl = document.getElementById("automationAwbList");
  const totalEl = document.getElementById("awbDrawerTotal");
  const refreshBtn = document.getElementById("awbDrawerRefresh");

  if (!openBtn || !overlay || !drawer) return;

  let loadedOnce = false;
  const open = async () => {
    setDrawerVisible({ drawer, overlay, visible: true });
    if (!loadedOnce) {
      const ok = await fetchPendingAwbs({ statusEl, listEl, totalEl, refreshBtn });
      loadedOnce = ok || loadedOnce;
    }
  };
  const close = () => setDrawerVisible({ drawer, overlay, visible: false });

  openBtn.addEventListener("click", () => void open());
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", close);
  refreshBtn?.addEventListener("click", () => void fetchPendingAwbs({ statusEl, listEl, totalEl, refreshBtn }));

  listEl?.addEventListener("click", async (event) => {
    const target = event.target;
    const btn = target?.closest ? target.closest("button[data-action]") : null;
    if (!btn) return;
    const row = btn.closest ? btn.closest("[data-awb]") : null;
    const awb = row ? String(row.getAttribute("data-awb") || "").trim() : "";
    if (!awb) return;

    const action = String(btn.getAttribute("data-action") || "");
    const detailsEl = row.querySelector ? row.querySelector(".automationDrawerDetails") : null;
    if (!detailsEl) return;

    try {
      if (action === "details") {
        const visible = !detailsEl.hidden;
        if (visible) {
          detailsEl.hidden = true;
          return;
        }
        setStatus(statusEl, "Loading details for " + awb + "...", "busy");
        const resp = await fetchAwbUpdate(awb);
        if (!resp.exists) {
          detailsEl.innerHTML = '<div class="automationDrawerEmpty">No stored status yet. Click refresh.</div>';
        } else {
          detailsEl.innerHTML = buildDetailsHtml(resp.data);
        }
        detailsEl.hidden = false;
        setStatus(statusEl, "Details loaded", "ok");
        return;
      }

      if (action === "refresh") {
        btn.disabled = true;
        setStatus(statusEl, "Refreshing " + awb + "...", "busy");
        const resp = await refreshAwbUpdate(awb);
        detailsEl.innerHTML = buildDetailsHtml(resp);
        detailsEl.hidden = false;
        setStatus(statusEl, "Refreshed " + awb, "ok");
      }
    } catch (error) {
      setStatus(statusEl, String(error?.message || "Action failed"), "error");
    } finally {
      btn.disabled = false;
    }
  });
}

initShipmentStatusDrawer();
