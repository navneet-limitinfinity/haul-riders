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
  const el = $("uploadStatus");
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

function setStatusProgress(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const fill = $("statusProgressFill");
  const text = $("statusProgressText");
  if (fill) fill.style.width = `${clamped}%`;
  if (text) text.textContent = `${Math.round(clamped)}%`;
}

function setStatusUpdateStatus(message, { kind = "info" } = {}) {
  const el = $("statusUploadStatus");
  if (!el) return;
  el.dataset.kind = kind;
  el.textContent = String(message ?? "");
}

async function fetchStores() {
  const response = await fetch("/api/shops", { cache: "no-store", headers: getAuthHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
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

async function createUploadJob({ file, storeId }) {
  const form = new FormData();
  form.append("file", file);
  form.append("storeId", storeId);

  const response = await fetch("/api/admin/bulk-orders/upload", {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error ?? `Upload failed (HTTP ${response.status})`));
  }

  const jobId = String(data?.jobId ?? "").trim();
  if (!jobId) throw new Error("Upload failed: missing jobId");
  return data;
}

async function createStatusUploadJob({ file, storeId }) {
  const form = new FormData();
  form.append("file", file);
  form.append("storeId", storeId);

  const response = await fetch("/api/admin/bulk-status/upload", {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error ?? `Upload failed (HTTP ${response.status})`));
  }

  const jobId = String(data?.jobId ?? "").trim();
  if (!jobId) throw new Error("Upload failed: missing jobId");
  return data;
}

async function fetchJob(jobId) {
  const response = await fetch(`/api/admin/bulk-orders/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    headers: { ...getAuthHeaders() },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error ?? `Job fetch failed (HTTP ${response.status})`));
  }
  return data;
}

async function fetchStatusJob(jobId) {
  const response = await fetch(`/api/admin/bulk-orders/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    headers: { ...getAuthHeaders() },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error ?? `Job fetch failed (HTTP ${response.status})`));
  }
  return data;
}

async function pollJob(jobId) {
  const start = Date.now();
  while (true) {
    const data = await fetchJob(jobId);
    const total = Number(data?.total ?? 0) || 0;
    const processed = Number(data?.processed ?? 0) || 0;
    const pct = total > 0 ? (processed / total) * 100 : 0;
    setProgress(pct);

    if (data?.status === "done") return data;
    if (data?.status === "failed") {
      throw new Error(String(data?.message ?? "Upload failed."));
    }

    if (Date.now() - start > 5 * 60_000) {
      throw new Error("Upload timed out (job took too long).");
    }

    await new Promise((r) => setTimeout(r, 450));
  }
}

async function pollStatusJob(jobId) {
  const start = Date.now();
  while (true) {
    const data = await fetchStatusJob(jobId);
    const total = Number(data?.total ?? 0) || 0;
    const processed = Number(data?.processed ?? 0) || 0;
    const pct = total > 0 ? (processed / total) * 100 : 0;
    setStatusProgress(pct);

    if (data?.status === "done") return data;
    if (data?.status === "failed") {
      throw new Error(String(data?.message ?? "Status update failed."));
    }

    if (Date.now() - start > 10 * 60_000) {
      throw new Error("Status update timed out (job took too long).");
    }

    await new Promise((r) => setTimeout(r, 450));
  }
}

async function onUploadClick() {
  const fileInput = $("csvFile");
  const storeSelect = $("storeId");
  const btn = $("uploadBtn");

  const file = fileInput?.files?.[0] ?? null;
  if (!file) {
    setStatus("Select a CSV file first.", { kind: "error" });
    return;
  }

  const storeId = String(storeSelect?.value ?? "").trim();
  if (!storeId) {
    setStatus("Select a store first.", { kind: "error" });
    return;
  }

  btn.disabled = true;
  setProgress(0);
  setStatus("Uploading CSV…", { kind: "busy" });

  try {
    const init = await createUploadJob({ file, storeId });
    const total = Number(init?.total ?? 0) || 0;
    setStatus(`Processing ${total} row(s)…`, { kind: "busy" });
    const result = await pollJob(init.jobId);
    const created = Number(result?.created ?? 0) || 0;
    const updated = Number(result?.updated ?? 0) || 0;
    const failed = Number(result?.failed ?? 0) || 0;
    setProgress(100);
    setStatus(`Done. Created ${created}, updated ${updated}, failed ${failed}.`, {
      kind: failed ? "warn" : "ok",
    });
  } catch (error) {
    setProgress(0);
    setStatus(error?.message ?? "Upload failed.", { kind: "error" });
  } finally {
    btn.disabled = false;
  }
}

async function onStatusUploadClick() {
  const fileInput = $("statusCsvFile");
  const storeSelect = $("storeId");
  const btn = $("statusUploadBtn");

  const file = fileInput?.files?.[0] ?? null;
  if (!file) {
    setStatusUpdateStatus("Select a status CSV file first.", { kind: "error" });
    return;
  }

  const storeId = String(storeSelect?.value ?? "").trim();
  if (!storeId) {
    setStatusUpdateStatus("Select a store first.", { kind: "error" });
    return;
  }

  btn.disabled = true;
  setStatusProgress(0);
  setStatusUpdateStatus("Uploading status CSV…", { kind: "busy" });

  try {
    const init = await createStatusUploadJob({ file, storeId });
    const total = Number(init?.total ?? 0) || 0;
    setStatusUpdateStatus(`Updating ${total} row(s)…`, { kind: "busy" });
    const result = await pollStatusJob(init.jobId);
    const updated = Number(result?.updated ?? 0) || 0;
    const failed = Number(result?.failed ?? 0) || 0;
    setStatusProgress(100);
    setStatusUpdateStatus(`Done. Updated ${updated} doc(s), failed ${failed}.`, {
      kind: failed ? "warn" : "ok",
    });
  } catch (error) {
    setStatusProgress(0);
    setStatusUpdateStatus(error?.message ?? "Status update failed.", { kind: "error" });
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  const btn = $("uploadBtn");
  if (btn) btn.addEventListener("click", onUploadClick);

  const statusBtn = $("statusUploadBtn");
  if (statusBtn) statusBtn.addEventListener("click", onStatusUploadClick);

  setProgress(0);
  setStatusProgress(0);
  setStatus("Loading stores…", { kind: "info" });
  setStatusUpdateStatus("", { kind: "info" });

  try {
    const data = await fetchStores();
    const stores = Array.isArray(data?.stores) ? data.stores : [];
    populateStoresSelect($("storeId"), stores);
    setStatus("Ready.", { kind: "ok" });
  } catch (error) {
    setStatus(error?.message ?? "Failed to load stores.", { kind: "error" });
  }

  const logoutBtn = document.querySelector("[data-action='logout']");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        localStorage.removeItem("haulIdToken");
      } catch {
        // ignore
      }
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      window.location.assign("/login");
    });
  }
}

init();
