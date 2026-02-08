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

function normalizePincode(value) {
  return String(value ?? "").replaceAll(/\D/g, "").slice(0, 6);
}

function normalizePhone10(value) {
  return String(value ?? "").replaceAll(/\D/g, "").slice(0, 10);
}

function isValidEmail(value) {
  const s = String(value ?? "").trim();
  if (!s) return true;
  // Minimal but strict-enough email check for UI validation.
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function setEmailHint({ kind, text }) {
  const el = $("singleEmailHint");
  if (!el) return;
  el.textContent = String(text ?? "");
  el.dataset.kind = String(kind ?? "");
}

function parseWeightKg(value) {
  const s = String(value ?? "").trim();
  if (!s) return { ok: true, value: "" };
  if (!/^(?:\d+|\d*\.\d)$/.test(s)) return { ok: false, value: "" };
  const n = Number.parseFloat(s);
  if (Number.isNaN(n) || n < 0) return { ok: false, value: "" };
  return { ok: true, value: String(Number(n.toFixed(1))) };
}

function normalizeWeightInput(value) {
  let s = String(value ?? "").replaceAll(/[^0-9.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot >= 0) {
    const before = s.slice(0, firstDot);
    let after = s.slice(firstDot + 1).replaceAll(/\./g, "");
    after = after.slice(0, 1); // only 1 digit after decimal
    s = `${before}.${after}`;
    // Keep ".x" as-is if user starts with dot.
    if (before === "" && after === "") s = ".";
    if (before === "" && after) s = `.${after}`;
  } else {
    s = s.replaceAll(/\./g, "");
  }
  return s;
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
    tr.dataset.orderKey = String(row?.orderId ?? "");

    const tdCheck = document.createElement("td");
    tdCheck.innerHTML = `<input type="checkbox" data-role="pick" />`;
    tr.appendChild(tdCheck);

    const tdOrder = document.createElement("td");
    tdOrder.textContent = String(row?.orderId ?? "");
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
  const orderDate = $("singleOrderDate");
  if (orderDate && !String(orderDate.value ?? "").trim()) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    const yyyy = get("year");
    const mm = get("month");
    const dd = get("day");
    const indianDate = dd && mm && yyyy ? `${dd}-${mm}-${yyyy}` : "";
    if (indianDate) orderDate.value = indianDate;
  }
  // Load fulfillment centers into select (default pre-selected).
  const role = String(document.body?.dataset?.role ?? "").trim();
  const storeId = role === "admin" ? String($("storeId")?.value ?? "").trim() : "";
  const centerSelect = $("singleFulfillmentCenter");
  if (centerSelect) {
    centerSelect.disabled = true;
    fetchFulfillmentCentersForDrawer({ role, storeId })
      .then((data) => {
        const centers = Array.isArray(data?.centers) ? data.centers : [];
        populateFulfillmentCenterSelect(centerSelect, centers);
      })
      .catch(() => {
        populateFulfillmentCenterSelect(centerSelect, []);
      })
      .finally(() => {
        centerSelect.disabled = false;
      });
  }
  document.body.classList.add("drawerOpen");

  const fulfillmentStatus = $("singleFulfillmentStatus");
  if (fulfillmentStatus && !String(fulfillmentStatus.value ?? "").trim()) {
    fulfillmentStatus.value = "fulfilled";
  }
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

async function fetchPincodeLookup({ pincodes }) {
  const response = await fetch("/api/pincodes/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ pincodes: Array.isArray(pincodes) ? pincodes : [] }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error ?? `${response.status} ${response.statusText}`));
  return data;
}

function setPinHint({ kind, text }) {
  const el = $("singlePinHint");
  if (!el) return;
  el.textContent = String(text ?? "");
  el.dataset.kind = String(kind ?? "");
}

let pincodeDirectoryReady = false;
let pincodeDirectoryPromise = null;
let pincodeDirectory = null;
const pincodeLookupCache = new Map();

async function loadPincodeDirectory() {
  if (pincodeDirectoryReady) return pincodeDirectory;
  if (pincodeDirectoryPromise) return pincodeDirectoryPromise;
  pincodeDirectoryPromise = (async () => {
    const resp = await fetch("/static/pincodes_directory.json.gz", { cache: "force-cache" });
    if (!resp.ok) throw new Error("pincode_directory_unavailable");

    // Decompress gzip in browser (static file does not have Content-Encoding).
    const raw = await resp.arrayBuffer();
    const streamSupported = typeof DecompressionStream !== "undefined";
    if (!streamSupported) throw new Error("gzip_decompression_unavailable");

    const ds = new DecompressionStream("gzip");
    const decompressed = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
    const text = new TextDecoder().decode(decompressed);
    const json = JSON.parse(text);
    const dir = json?.directory && typeof json.directory === "object" ? json.directory : null;
    if (!dir) throw new Error("pincode_directory_invalid");
    pincodeDirectory = dir;
    pincodeDirectoryReady = true;
    return pincodeDirectory;
  })();
  return pincodeDirectoryPromise;
}

async function fetchFulfillmentCentersForDrawer({ role, storeId }) {
  const url =
    role === "admin"
      ? new URL("/api/firestore/admin/fulfillment-centers", window.location.origin)
      : new URL("/api/firestore/fulfillment-centers", window.location.origin);
  if (role === "admin" && storeId) url.searchParams.set("storeId", String(storeId));
  const response = await fetch(url, { cache: "no-store", headers: getAuthHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error ?? `${response.status} ${response.statusText}`));
  return data;
}

function populateFulfillmentCenterSelect(select, centers) {
  if (!select) return;
  const selected = String(select.value ?? "").trim();
  select.textContent = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Fulfillment Center";
  placeholder.disabled = true;
  select.appendChild(placeholder);

  const list = Array.isArray(centers) ? centers : [];
  for (const c of list) {
    const name = String(c?.originName ?? "").trim();
    if (!name) continue;
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  const def = list.find((c) => Boolean(c?.default)) ?? list[0] ?? null;
  const defName = String(def?.originName ?? "").trim();

  if (selected) select.value = selected;
  else if (defName) select.value = defName;
  else select.value = "";
}

function readSingleOrderPayload() {
  const paymentStatus = String($("singlePaymentStatus")?.value ?? "").trim().toLowerCase();
  const invoiceValue = String($("singleInvoiceValue")?.value ?? "").trim();
  const financialStatus = paymentStatus === "paid" ? "paid" : "pending";
  const weightParsed = parseWeightKg($("singleWeightKg")?.value ?? "");
  return {
    orderId: String($("singleOrderId")?.value ?? "").trim(),
    orderDate: String($("singleOrderDate")?.value ?? "").trim(),
    fullName: String($("singleFullName")?.value ?? "").trim(),
    customerEmail: String($("singleCustomerEmail")?.value ?? "").trim(),
    phone1: String($("singlePhone1")?.value ?? "").trim(),
    phone2: String($("singlePhone2")?.value ?? "").trim(),
    address1: String($("singleAddress1")?.value ?? "").trim(),
    address2: String($("singleAddress2")?.value ?? "").trim(),
    city: String($("singleCity")?.value ?? "").trim(),
    state: String($("singleState")?.value ?? "").trim(),
    pinCode: String($("singlePinCode")?.value ?? "").trim(),
    totalPrice: invoiceValue,
    financialStatus,
    paymentStatus,
    invoiceValue,
    productDescription: String($("singleProductDescription")?.value ?? "").trim(),
    fulfillmentCenter: String($("singleFulfillmentCenter")?.value ?? "").trim(),
    fulfillmentStatus: String($("singleFulfillmentStatus")?.value ?? "").trim(),
    weightKg: weightParsed.value,
    courierType: String($("singleCourierType")?.value ?? "").trim(),
    courierPartner: String($("singleCourierPartner")?.value ?? "").trim() || "DTDC",
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
      setStatus("Select a CSV file first.", { kind: "error" });
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

  // Stop auto-overwriting city/state if user manually edits them.
  const clearAutofillOnEdit = (id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      if (String(el.dataset.autofill ?? "") === "1") {
        delete el.dataset.autofill;
        delete el.dataset.autofillPin;
      }
    });
  };
  clearAutofillOnEdit("singleCity");
  clearAutofillOnEdit("singleState");

  const enforceDigits = (id, { required = false } = {}) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      el.value = normalizePhone10(el.value);
      if (required) el.setCustomValidity(el.value ? "" : "Required");
    });
  };
  enforceDigits("singlePhone1", { required: true });
  enforceDigits("singlePhone2", { required: false });
  $("singleWeightKg")?.addEventListener("input", (e) => {
    const input = e.target;
    if (!input) return;
    input.value = normalizeWeightInput(input.value);
  });

  $("singleCustomerEmail")?.addEventListener("blur", (e) => {
    const input = e.target;
    if (!input) return;
    const value = String(input.value ?? "").trim();
    if (!value) {
      setEmailHint({ kind: "", text: "" });
      return;
    }
    if (!isValidEmail(value)) {
      setEmailHint({ kind: "error", text: "Enter a valid email address (or leave blank)." });
    } else {
      setEmailHint({ kind: "", text: "" });
    }
  });

  // Warm-up: attempt to load the static gzip directory in the background.
  loadPincodeDirectory().catch(() => {});

  let pinLookupToken = null;
  let pinDebounceTimer = null;

  const applyLookupResult = ({ pin, serviceable, district, state }) => {
    const cityEl = $("singleCity");
    const stateEl = $("singleState");

    if (!serviceable) {
      setPinHint({ kind: "error", text: "Not serviceable (DTDC)." });
      return;
    }

    setPinHint({ kind: "ok", text: "✓" });

    if (cityEl) {
      const canOverwrite =
        !String(cityEl.value ?? "").trim() ||
        (String(cityEl.dataset.autofill ?? "") === "1" && String(cityEl.dataset.autofillPin ?? "") !== pin);
      if (canOverwrite) {
        cityEl.value = district;
        cityEl.dataset.autofill = "1";
        cityEl.dataset.autofillPin = pin;
      }
    }
    if (stateEl) {
      const canOverwrite =
        !String(stateEl.value ?? "").trim() ||
        (String(stateEl.dataset.autofill ?? "") === "1" && String(stateEl.dataset.autofillPin ?? "") !== pin);
      if (canOverwrite) {
        stateEl.value = state;
        stateEl.dataset.autofill = "1";
        stateEl.dataset.autofillPin = pin;
      }
    }
  };

  $("singlePinCode")?.addEventListener("input", (e) => {
    const input = e.target;
    if (!input) return;
    const pin = normalizePincode(input.value);
    input.value = pin;

    if (pinDebounceTimer) window.clearTimeout(pinDebounceTimer);

    if (!pin || pin.length < 6) {
      setPinHint({ kind: "", text: "" });
      pinLookupToken = null;
      return;
    }

    setPinHint({ kind: "busy", text: "Checking serviceability…" });

    pinDebounceTimer = window.setTimeout(async () => {
      const token = {};
      pinLookupToken = token;

      // 1) Client cache
      if (pincodeLookupCache.has(pin)) {
        if (pinLookupToken !== token) return;
        applyLookupResult({ pin, ...(pincodeLookupCache.get(pin) ?? {}) });
        return;
      }

      // 2) Static directory (fast)
      try {
        const dir = await loadPincodeDirectory();
        if (pinLookupToken !== token) return;
        const info = dir?.[pin] ?? null;
        const district = String(info?.district ?? "").trim();
        const state = String(info?.state ?? "").trim();
        const serviceable = Boolean(info);
        const result = { serviceable, district, state };
        pincodeLookupCache.set(pin, result);
        applyLookupResult({ pin, ...result });
        return;
      } catch {
        // ignore -> fallback to server
      }

      // 3) Server fallback
      try {
        const data = await fetchPincodeLookup({ pincodes: [pin] });
        if (pinLookupToken !== token) return;
        const map = data?.pincodes && typeof data.pincodes === "object" ? data.pincodes : {};
        const info = map?.[pin] ?? null;
        const serviceable = Boolean(info?.serviceable);
        const district = String(info?.district ?? "").trim();
        const state = String(info?.state ?? "").trim();
        const result = { serviceable, district, state };
        pincodeLookupCache.set(pin, result);
        applyLookupResult({ pin, ...result });
      } catch {
        if (pinLookupToken !== token) return;
        setPinHint({ kind: "warn", text: "Unable to check serviceability." });
      }
    }, 280);
  });

  $("singleDrawerCreate")?.addEventListener("click", async () => {
    const roleNow = String(document.body?.dataset?.role ?? "").trim();
    const storeId = roleNow === "admin" ? String($("storeId")?.value ?? "").trim() : "";
    if (roleNow === "admin" && !storeId) {
      setStatus("Select a store first.", { kind: "error" });
      return;
    }

    if (!String($("singlePaymentStatus")?.value ?? "").trim()) {
      setStatus("Select Payment Status.", { kind: "error" });
      return;
    }

    if (!String($("singleInvoiceValue")?.value ?? "").trim()) {
      setStatus("Invoice Value is required.", { kind: "error" });
      return;
    }

    const phone1 = normalizePhone10($("singlePhone1")?.value ?? "");
    if (!phone1 || phone1.length < 10) {
      setStatus("Contact No must be 10 digits.", { kind: "error" });
      return;
    }

    const phone2 = normalizePhone10($("singlePhone2")?.value ?? "");
    if (phone2 && phone2.length < 10) {
      setStatus("Alternate Contact must be 10 digits (or leave blank).", { kind: "error" });
      return;
    }

    const email = String($("singleCustomerEmail")?.value ?? "").trim();
    if (!isValidEmail(email)) {
      setStatus("Enter a valid email address (or leave blank).", { kind: "error" });
      return;
    }

    const weightParsed = parseWeightKg($("singleWeightKg")?.value ?? "");
    if (!weightParsed.ok) {
      setStatus("Weight must be a number with at most 1 decimal place.", { kind: "error" });
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
