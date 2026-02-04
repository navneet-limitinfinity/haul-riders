const $ = (id) => document.getElementById(id);

function getIdToken() {
  try {
    return String(localStorage.getItem("haulIdToken") ?? "").trim();
  } catch {
    return "";
  }
}

function getAuthHeaders() {
  const token = getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function setStatus(message, { kind = "info" } = {}) {
  const el = $("status");
  if (!el) return;
  el.dataset.kind = kind;
  el.textContent = String(message ?? "");
}

function setProgress(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const fill = $("progressFill");
  const text = $("progressText");
  if (fill) fill.style.width = `${clamped}%`;
  if (text) text.textContent = `${Math.round(clamped)}%`;
}

async function requestJson(path, { method = "GET", body = null, formData = null } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(formData ? {} : body ? { "Content-Type": "application/json" } : {}),
      ...getAuthHeaders(),
    },
    body: formData ? formData : body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error ?? `${response.status} ${response.statusText}`));
  }
  return data;
}

async function fetchStores() {
  return requestJson("/api/shops");
}

function populateStoresSelect(select, stores) {
  if (!select) return;
  select.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select store…";
  select.appendChild(placeholder);

  for (const s of Array.isArray(stores) ? stores : []) {
    const id = String(s?.shopDomain ?? s?.storeId ?? s?.id ?? "").trim();
    const name = String(s?.name ?? s?.shopDomain ?? id).trim();
    if (!id) continue;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name;
    select.appendChild(opt);
  }
}

function renderCreatedRows(rows) {
  const tbody = $("createdRows");
  if (!tbody) return;
  tbody.innerHTML = "";

  const fragment = document.createDocumentFragment();
  for (const row of Array.isArray(rows) ? rows : []) {
    const tr = document.createElement("tr");
    tr.dataset.orderKey = String(row?.orderKey ?? "");

    const tdCheck = document.createElement("td");
    tdCheck.innerHTML = `<input type="checkbox" data-role="pick" />`;
    tr.appendChild(tdCheck);

    const tdOrder = document.createElement("td");
    tdOrder.textContent = String(row?.orderName ?? row?.orderKey ?? "");
    tr.appendChild(tdOrder);

    const tdCustomer = document.createElement("td");
    tdCustomer.textContent = String(row?.fullName ?? "");
    tr.appendChild(tdCustomer);

    const tdPhone = document.createElement("td");
    tdPhone.className = "mono";
    tdPhone.textContent = String(row?.phone1 ?? "");
    tr.appendChild(tdPhone);

    const tdCity = document.createElement("td");
    tdCity.textContent = String(row?.city ?? "");
    tr.appendChild(tdCity);

    const tdTotal = document.createElement("td");
    tdTotal.className = "mono";
    tdTotal.textContent = String(row?.totalPrice ?? "");
    tr.appendChild(tdTotal);

    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);
}

function setRejected(errors) {
  const el = $("rejectedRows");
  if (!el) return;
  const list = Array.isArray(errors) ? errors : [];
  if (!list.length) {
    el.textContent = "No rejected rows.";
    return;
  }
  el.innerHTML = `<ul class="bulkList" style="margin-top: 8px;">${list
    .slice(0, 100)
    .map((e) => `<li>${String(e ?? "")}</li>`)
    .join("")}</ul>`;
}

function getSelectedOrderKeys() {
  const tbody = $("createdRows");
  if (!tbody) return [];
  const keys = [];
  tbody.querySelectorAll("tr").forEach((tr) => {
    const cb = tr.querySelector('input[type="checkbox"][data-role="pick"]');
    if (!cb?.checked) return;
    const key = String(tr.dataset.orderKey ?? "").trim();
    if (key) keys.push(key);
  });
  return keys;
}

function syncAssignButton() {
  const btn = $("assignSelectedBtn");
  if (!btn) return;
  btn.disabled = getSelectedOrderKeys().length === 0;
}

function openDrawer() {
  const overlay = $("singleDrawerOverlay");
  const drawer = $("singleDrawer");
  if (overlay) overlay.hidden = false;
  if (drawer) {
    drawer.dataset.open = "true";
    drawer.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("drawerOpen");
}

function closeDrawer() {
  const overlay = $("singleDrawerOverlay");
  const drawer = $("singleDrawer");
  if (overlay) overlay.hidden = true;
  if (drawer) {
    drawer.dataset.open = "false";
    drawer.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("drawerOpen");
}

function readSingleOrderPayload() {
  return {
    orderName: String($("singleOrderName")?.value ?? "").trim(),
    order_date: String($("singleOrderDate")?.value ?? "").trim(),
    fullName: String($("singleFullName")?.value ?? "").trim(),
    customerEmail: String($("singleCustomerEmail")?.value ?? "").trim(),
    phone1: String($("singlePhone1")?.value ?? "").trim(),
    phone2: String($("singlePhone2")?.value ?? "").trim(),
    address1: String($("singleAddress1")?.value ?? "").trim(),
    address2: String($("singleAddress2")?.value ?? "").trim(),
    city: String($("singleCity")?.value ?? "").trim(),
    state: String($("singleState")?.value ?? "").trim(),
    pinCode: String($("singlePinCode")?.value ?? "").trim(),
    totalPrice: String($("singleTotalPrice")?.value ?? "").trim(),
    financialStatus: String($("singleFinancialStatus")?.value ?? "").trim(),
    invoice_value: String($("singleInvoiceValue")?.value ?? "").trim(),
    content_and_quantity: String($("singleProductDescription")?.value ?? "").trim(),
  };
}

async function pollJob(jobId) {
  const start = Date.now();
  while (true) {
    const job = await requestJson(`/api/orders/import/jobs/${encodeURIComponent(jobId)}`);
    const total = Number(job?.total ?? 0) || 0;
    const processed = Number(job?.processed ?? 0) || 0;
    const pct = total > 0 ? (processed / total) * 100 : 0;
    setProgress(pct);

    if (job?.status === "done") return job;
    if (job?.status === "failed") throw new Error(String(job?.message ?? "import_failed"));
    if (Date.now() - start > 10 * 60_000) throw new Error("import_timed_out");
    await new Promise((r) => setTimeout(r, 450));
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  $("navToggle")?.addEventListener("click", () => document.body.classList.add("navOpen"));
  $("navOverlay")?.addEventListener("click", () => document.body.classList.remove("navOpen"));

  document.getElementById("navDrawer")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-action='logout']");
    if (!btn) return;
    try {
      localStorage.removeItem("haulIdToken");
    } catch {
      // ignore
    }
    window.location.assign("/login");
  });

  document.querySelector(".userMenu")?.addEventListener("click", (e) => {
    const target = e.target;
    const action = target?.dataset?.action ?? "";
    if (action === "logout") {
      e.preventDefault();
      try {
        localStorage.removeItem("haulIdToken");
      } catch {
        // ignore
      }
      window.location.assign("/login");
    }
  });

  const role = String(document.body?.dataset?.role ?? "").trim();

  if (role === "admin") {
    try {
      const data = await fetchStores();
      populateStoresSelect($("storeId"), data?.shops ?? data?.stores ?? []);
    } catch (error) {
      setStatus(error?.message ?? "Failed to load stores.", { kind: "error" });
    }
  }

  let createdOrders = [];

  $("ordersUploadBtn")?.addEventListener("click", async () => {
    const file = $("ordersFile")?.files?.[0] ?? null;
    if (!file) {
      setStatus("Select a CSV/XLSX file first.", { kind: "error" });
      return;
    }

    const storeId = role === "admin" ? String($("storeId")?.value ?? "").trim() : "";
    if (role === "admin" && !storeId) {
      setStatus("Select a store first.", { kind: "error" });
      return;
    }

    const btn = $("ordersUploadBtn");
    const original = btn?.innerHTML ?? "";
    if (btn) btn.disabled = true;
    setProgress(0);
    setStatus("Uploading…", { kind: "busy" });

    try {
      const form = new FormData();
      form.append("file", file);
      if (role === "admin") form.append("storeId", storeId);
      const init = await requestJson("/api/orders/import", { method: "POST", formData: form });
      const job = await pollJob(String(init?.jobId ?? ""));
      createdOrders = [...createdOrders, ...(Array.isArray(job?.orders) ? job.orders : [])];
      renderCreatedRows(createdOrders);
      setRejected(job?.errors ?? []);
      setProgress(100);
      const created = Number(job?.created ?? 0) || 0;
      const updated = Number(job?.updated ?? 0) || 0;
      const failed = Number(job?.failed ?? 0) || 0;
      setStatus(`Done. Created ${created}, updated ${updated}, failed ${failed}.`, {
        kind: failed ? "warn" : "ok",
      });
    } catch (error) {
      setProgress(0);
      setStatus(error?.message ?? "Upload failed.", { kind: "error" });
    } finally {
      if (btn) btn.disabled = false;
      if (btn) btn.innerHTML = original || btn.innerHTML;
      if ($("ordersFile")) $("ordersFile").value = "";
      syncAssignButton();
    }
  });

  $("createdRows")?.addEventListener("change", (e) => {
    const cb = e.target;
    if (!cb || cb.tagName !== "INPUT" || cb.type !== "checkbox") return;
    syncAssignButton();
  });

  $("selectAllCreated")?.addEventListener("change", (e) => {
    const checked = Boolean(e.target?.checked);
    $("createdRows")
      ?.querySelectorAll('input[type="checkbox"][data-role="pick"]')
      .forEach((cb) => {
        cb.checked = checked;
      });
    syncAssignButton();
  });

  $("assignSelectedBtn")?.addEventListener("click", async () => {
    const orderKeys = getSelectedOrderKeys();
    if (!orderKeys.length) return;

    const roleNow = String(document.body?.dataset?.role ?? "").trim();
    const storeId = roleNow === "admin" ? String($("storeId")?.value ?? "").trim() : "";
    if (roleNow === "admin" && !storeId) {
      setStatus("Select a store first.", { kind: "error" });
      return;
    }

    const btn = $("assignSelectedBtn");
    const original = btn?.innerHTML ?? "";
    if (btn) btn.disabled = true;
    if (btn) btn.innerHTML = `<span class="btnSpinner" aria-hidden="true"></span> Assigning…`;
    try {
      await requestJson("/api/orders/assign", {
        method: "POST",
        body: roleNow === "admin" ? { storeId, orderKeys } : { orderKeys },
      });
      setStatus(`Assigned ${orderKeys.length} order(s).`, { kind: "ok" });
    } catch (error) {
      setStatus(error?.message ?? "Assign failed.", { kind: "error" });
    } finally {
      if (btn) btn.disabled = false;
      if (btn) btn.innerHTML = original || "Assign to Ship";
    }
  });

  $("openSingleDrawer")?.addEventListener("click", () => openDrawer());
  $("singleDrawerOverlay")?.addEventListener("click", () => closeDrawer());
  $("singleDrawerClose")?.addEventListener("click", () => closeDrawer());
  $("singleDrawerCancel")?.addEventListener("click", () => closeDrawer());

  $("singleDrawerCreate")?.addEventListener("click", async () => {
    const roleNow = String(document.body?.dataset?.role ?? "").trim();
    const storeId = roleNow === "admin" ? String($("storeId")?.value ?? "").trim() : "";
    if (roleNow === "admin" && !storeId) {
      setStatus("Select a store first.", { kind: "error" });
      return;
    }

    const btn = $("singleDrawerCreate");
    const cancelBtn = $("singleDrawerCancel");
    const closeBtn = $("singleDrawerClose");
    const originalHtml = btn ? btn.innerHTML : "";
    if (btn) btn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    if (btn) btn.innerHTML = `<span class="btnSpinner" aria-hidden="true"></span> Creating…`;

    try {
      const payload = readSingleOrderPayload();
      const res = await requestJson("/api/orders/create", {
        method: "POST",
        body: roleNow === "admin" ? { ...payload, storeId } : payload,
      });
      const orders = Array.isArray(res?.orders) ? res.orders : [];
      createdOrders = [...orders, ...createdOrders];
      renderCreatedRows(createdOrders);
      setRejected([]);
      closeDrawer();
      setStatus("Order created.", { kind: "ok" });
    } catch (error) {
      setStatus(error?.message ?? "Create failed.", { kind: "error" });
    } finally {
      if (btn) btn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
      if (btn) btn.innerHTML = originalHtml || "Create";
      syncAssignButton();
    }
  });
});

