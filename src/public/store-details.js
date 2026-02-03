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

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function requestJson(path, { method = "GET", body = null } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...getAuthHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
  return response.json();
}

async function postForm(path, formData) {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: formData,
    cache: "no-store",
  });
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

function toggleNav(open) {
  document.body.classList.toggle("navOpen", open);
  const overlay = $("navOverlay");
  if (overlay) overlay.setAttribute("aria-hidden", open ? "false" : "true");
}

async function signOut() {
  setStatus("Signing out…", { kind: "info" });
  try {
    localStorage.removeItem("haulIdToken");
  } catch {
    // ignore
  }
  window.location.assign("/login");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// -----------------------------
// Store details + branding
// -----------------------------

const GST_STATES = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman and Diu" },
  { code: "26", name: "Dadra and Nagar Haveli" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh (New)" },
  { code: "38", name: "Ladakh" },
  { code: "96", name: "Foreign Country" },
  { code: "97", name: "Other Territory" },
];

function resolveStateName(code) {
  const c = String(code ?? "").trim();
  if (!c) return "";
  return GST_STATES.find((s) => s.code === c)?.name ?? "";
}

function populateStateSelect(selectEl) {
  if (!selectEl) return;
  const existing = new Set(Array.from(selectEl.options ?? []).map((o) => String(o.value ?? "")));
  for (const s of GST_STATES) {
    if (existing.has(s.code)) continue;
    const opt = document.createElement("option");
    opt.value = s.code;
    opt.textContent = `${s.code} - ${s.name}`;
    selectEl.appendChild(opt);
  }
}

function normalizeStoreDetails(details) {
  const d = details && typeof details === "object" ? details : {};
  const stateCode = String(d?.stateCode ?? "").trim();
  const stateNameRaw = String(d?.stateName ?? "").trim();
  const stateName = stateNameRaw || resolveStateName(stateCode);
  return {
    storeName: String(d?.storeName ?? "").trim(),
    registeredAddress: String(d?.registeredAddress ?? "").trim(),
    gstNumber: String(d?.gstNumber ?? "").trim(),
    stateCode,
    stateName,
    websiteAddress: String(d?.websiteAddress ?? "").trim(),
    contactPersonName: String(d?.contactPersonName ?? "").trim(),
    contactPersonEmail: String(d?.contactPersonEmail ?? "").trim(),
    contactPersonPhone: String(d?.contactPersonPhone ?? "").trim(),
  };
}

function hasStoreDetails(details) {
  const d = normalizeStoreDetails(details);
  return Object.values(d).some((v) => String(v ?? "").trim().length > 0);
}

function fillStoreDetailsRead(details) {
  const d = normalizeStoreDetails(details);
  const setText = (id, value) => {
    const el = $(id);
    if (!el) return;
    el.textContent = String(value ?? "").trim();
  };
  const setTextHidden = (id, value) => {
    const el = $(id);
    if (!el) return;
    const v = String(value ?? "").trim();
    el.textContent = v;
    el.hidden = !v;
  };
  setText("storeNameText", d.storeName);
  setText("gstNumberText", d.gstNumber);
  setTextHidden("stateCodeText", d.stateCode);
  setTextHidden("stateNameText", d.stateName);
  setText("websiteAddressText", d.websiteAddress);
  setText("registeredAddressText", d.registeredAddress);
  setText("contactPersonNameText", d.contactPersonName);
  setText("contactPersonEmailText", d.contactPersonEmail);
  setText("contactPersonPhoneText", d.contactPersonPhone);
}

async function loadStoreDetails() {
  const data = await requestJson("/api/store/details");
  const details = normalizeStoreDetails(data?.storeDetails ?? {});
  fillStoreDetailsRead(details);
  return details;
}

function setStoreDetailsMode(mode) {
  document.body.dataset.storeDetailsMode =
    String(mode ?? "").trim().toLowerCase() === "edit" ? "edit" : "read";
}

function refreshBrandingLogoImages() {
  const ts = String(Date.now());
  const url = `/api/store/branding/logo?ts=${encodeURIComponent(ts)}`;
  const preview = $("brandingLogoPreview");
  if (preview) preview.src = url;
  document.querySelectorAll("img.brandingLogoTopbar").forEach((img) => {
    img.src = url;
  });
}

async function uploadBrandingLogo(file) {
  const type = String(file?.type ?? "").toLowerCase();
  const allowed = new Set(["image/png", "image/jpeg"]);
  if (!allowed.has(type)) {
    throw new Error("Invalid logo format. Use PNG or JPG.");
  }
  if (file.size > 1 * 1024 * 1024) {
    throw new Error("Logo too large. Max 1MB.");
  }

  const form = new FormData();
  form.append("logo", file, file.name || "logo");
  await postForm("/api/store/branding/logo", form);
  refreshBrandingLogoImages();
}

// -----------------------------
// Fulfillment centers (copied from fulfillment-centers.js)
// -----------------------------

function formatAddress(center) {
  const parts = [
    center.address1,
    center.address2,
    [center.city, center.state].filter(Boolean).join(", "),
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatFullAddress(center) {
  const parts = [
    center.address1,
    center.address2,
    [center.city, center.pinCode].filter(Boolean).join(" "),
    [center.state, center.country].filter(Boolean).join(", "),
    center.phone ? `Phone: ${center.phone}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function renderCenterRows(centers) {
  const tbody = $("centersRows");
  if (!tbody) return;
  tbody.innerHTML = "";

  const fragment = document.createDocumentFragment();
  for (const c of centers) {
    const tr = document.createElement("tr");
    tr.dataset.id = String(c.id ?? "");

    const isDefault = Boolean(c.default);
    const originTd = document.createElement("td");
    const contact = String(c.contactPersonName ?? "").trim();
    originTd.innerHTML = `<div class="cellStack">
      <div class="cellPrimary">${escapeHtml(c.originName ?? "")}</div>
      ${contact ? `<div class="cellSecondary">${escapeHtml(contact)}</div>` : ""}
    </div>`;
    tr.appendChild(originTd);

    const addressTd = document.createElement("td");
    addressTd.className = "truncate";
    addressTd.title = formatFullAddress(c);
    addressTd.textContent = formatAddress(c);
    tr.appendChild(addressTd);

    const pinTd = document.createElement("td");
    pinTd.className = "mono";
    pinTd.textContent = String(c.pinCode ?? "");
    tr.appendChild(pinTd);

    const phoneTd = document.createElement("td");
    phoneTd.className = "mono";
    phoneTd.textContent = String(c.phone ?? "");
    tr.appendChild(phoneTd);

    const defaultTd = document.createElement("td");
    defaultTd.innerHTML = `<label class="defaultRadio">
      <input type="radio" name="defaultCenter" data-action="set-default" data-id="${escapeHtml(
        c.id
      )}" ${isDefault ? "checked" : ""} />
      <span class="defaultRadioLabel">${isDefault ? "Default" : "Set"}</span>
    </label>`;
    tr.appendChild(defaultTd);

    const actionsTd = document.createElement("td");
    actionsTd.innerHTML = `<div class="cellActions">
      <button type="button" class="btn btnSecondary btnCompact" data-action="edit" data-id="${escapeHtml(c.id)}">Edit</button>
      <button type="button" class="btn btnSecondary btnCompact" data-action="delete" data-id="${escapeHtml(c.id)}">Delete</button>
    </div>`;
    tr.appendChild(actionsTd);

    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);
}

function readDialogValues() {
  return {
    originName: String($("originName")?.value ?? "").trim(),
    contactPersonName: String($("contactPersonName")?.value ?? "").trim(),
    address1: String($("address1")?.value ?? "").trim(),
    address2: String($("address2")?.value ?? "").trim(),
    city: String($("city")?.value ?? "").trim(),
    state: String($("state")?.value ?? "").trim(),
    pinCode: String($("pinCode")?.value ?? "").replaceAll(/\D/g, "").slice(0, 6),
    country: "IN",
    phone: String($("phone")?.value ?? "").replaceAll(/\D/g, "").slice(0, 10),
    makeDefault: Boolean($("makeDefault")?.checked),
  };
}

function openDialog({ mode, center }) {
  const overlay = $("centerDrawerOverlay");
  const drawer = $("centerDrawer");
  if (overlay) overlay.hidden = false;
  if (drawer) {
    drawer.dataset.open = "true";
    drawer.setAttribute("aria-hidden", "false");
  }
  $("centerDrawerTitle").textContent = mode === "edit" ? "Edit center" : "Add center";
  $("centerId").value = center?.id ?? "";
  $("originName").value = center?.originName ?? "";
  $("contactPersonName").value = center?.contactPersonName ?? "";
  $("address1").value = center?.address1 ?? "";
  $("address2").value = center?.address2 ?? "";
  $("city").value = center?.city ?? "";
  $("state").value = center?.state ?? "";
  $("pinCode").value = center?.pinCode ?? "";
  $("phone").value = center?.phone ?? "";
  $("makeDefault").checked = Boolean(center?.default);
  document.body.classList.add("drawerOpen");
}

function closeDialog() {
  const overlay = $("centerDrawerOverlay");
  const drawer = $("centerDrawer");
  if (overlay) overlay.hidden = true;
  if (drawer) {
    drawer.dataset.open = "false";
    drawer.setAttribute("aria-hidden", "true");
  }
  const accountOpen = $("accountDrawer")?.dataset?.open === "true";
  const centerOpen = drawer?.dataset?.open === "true";
  document.body.classList.toggle("drawerOpen", Boolean(accountOpen || centerOpen));
}

async function loadCenters() {
  setStatus("Loading…", { kind: "info" });
  const data = await requestJson("/api/firestore/fulfillment-centers");
  const centers = Array.isArray(data?.centers) ? data.centers : [];
  renderCenterRows(centers);
  setStatus(`Loaded ${centers.length} center(s).`, { kind: "ok" });
  return centers;
}

window.addEventListener("DOMContentLoaded", async () => {
  $("navToggle")?.addEventListener("click", () => toggleNav(true));
  $("navOverlay")?.addEventListener("click", () => toggleNav(false));
  document.getElementById("navDrawer")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-action='logout']");
    if (!btn) return;
    signOut();
  });

  document.querySelector(".userMenu")?.addEventListener("click", (e) => {
    const target = e.target;
    const action = target?.dataset?.action ?? "";
    if (action === "logout") {
      e.preventDefault();
      signOut();
    }
  });

  refreshBrandingLogoImages();
  populateStateSelect($("drawerStateCode"));

  let initialDetails = normalizeStoreDetails({});
  let canEdit = true;
  let currentDetails = normalizeStoreDetails({});

  const getDrawerPayload = () => ({
    storeName: String($("drawerStoreName")?.value ?? "").trim(),
    gstNumber: String($("drawerGstNumber")?.value ?? "").trim(),
    stateCode: String($("drawerStateCode")?.value ?? "").trim(),
    stateName: resolveStateName(String($("drawerStateCode")?.value ?? "").trim()),
    websiteAddress: String($("drawerWebsiteAddress")?.value ?? "").trim(),
    registeredAddress: String($("drawerRegisteredAddress")?.value ?? "").trim(),
    contactPersonName: String($("drawerContactPersonName")?.value ?? "").trim(),
    contactPersonEmail: String($("drawerContactPersonEmail")?.value ?? "").trim(),
    contactPersonPhone: String($("drawerContactPersonPhone")?.value ?? "").trim(),
  });

  const setDrawerValues = (details) => {
    const d = normalizeStoreDetails(details);
    if ($("drawerStoreName")) $("drawerStoreName").value = d.storeName;
    if ($("drawerGstNumber")) $("drawerGstNumber").value = d.gstNumber;
    if ($("drawerStateCode")) $("drawerStateCode").value = d.stateCode;
    if ($("drawerWebsiteAddress")) $("drawerWebsiteAddress").value = d.websiteAddress;
    if ($("drawerRegisteredAddress")) $("drawerRegisteredAddress").value = d.registeredAddress;
    if ($("drawerContactPersonName")) $("drawerContactPersonName").value = d.contactPersonName;
    if ($("drawerContactPersonEmail")) $("drawerContactPersonEmail").value = d.contactPersonEmail;
    if ($("drawerContactPersonPhone")) $("drawerContactPersonPhone").value = d.contactPersonPhone;
  };

  const openAccountDrawer = () => {
    const overlay = $("accountDrawerOverlay");
    const drawer = $("accountDrawer");
    if (overlay) overlay.hidden = false;
    if (drawer) {
      drawer.dataset.open = "true";
      drawer.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("drawerOpen");
  };

  const closeAccountDrawer = () => {
    const overlay = $("accountDrawerOverlay");
    const drawer = $("accountDrawer");
    if (overlay) overlay.hidden = true;
    if (drawer) {
      drawer.dataset.open = "false";
      drawer.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("drawerOpen");
  };

  try {
    initialDetails = (await loadStoreDetails()) || normalizeStoreDetails({});
    currentDetails = initialDetails;
    canEdit = hasStoreDetails(initialDetails);
    if (!canEdit) setStatus("Add store details using Edit Details.", { kind: "info" });

    setStoreDetailsMode(canEdit ? "read" : "edit");
  } catch (error) {
    setStatus(error?.message ?? "Failed to load store details.", { kind: "error" });
  }

  $("editStoreDetailsLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    setDrawerValues(currentDetails);
    openAccountDrawer();
  });

  $("accountDrawerOverlay")?.addEventListener("click", () => closeAccountDrawer());
  $("accountDrawerClose")?.addEventListener("click", () => closeAccountDrawer());
  $("accountDrawerCancel")?.addEventListener("click", () => closeAccountDrawer());

  $("accountDrawerUpdate")?.addEventListener("click", async () => {
    const btn = $("accountDrawerUpdate");
    const cancelBtn = $("accountDrawerCancel");
    const closeBtn = $("accountDrawerClose");
    const originalHtml = btn ? btn.innerHTML : "";
    if (btn) btn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    if (btn) {
      btn.dataset.loading = "true";
      btn.innerHTML = `<span class="btnSpinner" aria-hidden="true"></span> Updating…`;
    }
    try {
      const payload = getDrawerPayload();
      await postJson("/api/store/details", payload);
      setStatus("Store details updated.", { kind: "ok" });
      currentDetails = (await loadStoreDetails()) || normalizeStoreDetails({});
      closeAccountDrawer();
    } catch (error) {
      setStatus(error?.message ?? "Failed to update store details.", { kind: "error" });
    } finally {
      if (btn) btn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
      if (btn) {
        btn.dataset.loading = "false";
        btn.innerHTML = originalHtml || "Update";
      }
    }
  });

  $("uploadBrandingLogo")?.addEventListener("click", async () => {
    const input = $("brandingLogoFile");
    const file = input?.files?.[0] ?? null;
    if (!file) {
      input?.click?.();
      return;
    }
    try {
      setStatus("Uploading logo…", { kind: "info" });
      await uploadBrandingLogo(file);
      setStatus("Logo uploaded.", { kind: "ok" });
      if (input) input.value = "";
    } catch (error) {
      setStatus(error?.message ?? "Failed to upload logo.", { kind: "error" });
    }
  });

  $("brandingLogoFile")?.addEventListener("change", async () => {
    const input = $("brandingLogoFile");
    const file = input?.files?.[0] ?? null;
    if (!file) return;
    try {
      setStatus("Uploading logo…", { kind: "info" });
      await uploadBrandingLogo(file);
      setStatus("Logo uploaded.", { kind: "ok" });
    } catch (error) {
      setStatus(error?.message ?? "Failed to upload logo.", { kind: "error" });
    } finally {
      if (input) input.value = "";
    }
  });

  let centers = [];
  try {
    centers = await loadCenters();
  } catch (error) {
    setStatus(error?.message ?? "Failed to load centers.", { kind: "error" });
  }

  $("addCenterBtn")?.addEventListener("click", () => {
    openDialog({ mode: "add", center: { default: centers.length === 0 } });
  });

  $("centerDrawerOverlay")?.addEventListener("click", () => closeDialog());
  $("centerDrawerClose")?.addEventListener("click", () => closeDialog());
  $("centerDrawerCancel")?.addEventListener("click", () => closeDialog());

  $("saveCenterBtn")?.addEventListener("click", async () => {
    const id = String($("centerId")?.value ?? "").trim();
    const values = readDialogValues();
    if (!values.originName) {
      setStatus("Origin Name is required.", { kind: "error" });
      return;
    }

    try {
      if (id) {
        await requestJson(`/api/firestore/fulfillment-centers/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: values,
        });
        if (values.makeDefault) {
          await postJson(`/api/firestore/fulfillment-centers/${encodeURIComponent(id)}/default`, {});
        }
      } else {
        const created = await postJson("/api/firestore/fulfillment-centers", values);
        if (values.makeDefault && created?.id) {
          await postJson(`/api/firestore/fulfillment-centers/${encodeURIComponent(created.id)}/default`, {});
        }
      }
      closeDialog();
      centers = await loadCenters();
    } catch (error) {
      setStatus(error?.message ?? "Failed to save center.", { kind: "error" });
    }
  });

  $("centersRows")?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("button[data-action]");
    if (!btn) return;
    const action = String(btn.dataset.action ?? "");
    const id = String(btn.dataset.id ?? "").trim();
    if (!id) return;

    const center = centers.find((c) => String(c.id) === id) ?? null;

    try {
      if (action === "edit") {
        openDialog({ mode: "edit", center });
        return;
      }
      if (action === "delete") {
        const ok = window.confirm("Delete this fulfillment center?");
        if (!ok) return;
        btn.disabled = true;
        await requestJson(`/api/firestore/fulfillment-centers/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        centers = await loadCenters();
      }
    } catch (error) {
      setStatus(error?.message ?? "Action failed.", { kind: "error" });
    } finally {
      btn.disabled = false;
    }
  });

  $("centersRows")?.addEventListener("change", async (e) => {
    const input = e.target;
    if (!input || input.tagName !== "INPUT" || input.type !== "radio") return;
    const action = String(input.dataset.action ?? "");
    const id = String(input.dataset.id ?? "").trim();
    if (action !== "set-default" || !id) return;
    try {
      await postJson(`/api/firestore/fulfillment-centers/${encodeURIComponent(id)}/default`, {});
      centers = await loadCenters();
    } catch (error) {
      setStatus(error?.message ?? "Failed to set default.", { kind: "error" });
    }
  });
});
