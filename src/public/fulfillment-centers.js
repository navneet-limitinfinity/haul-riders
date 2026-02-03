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

function renderRows(centers) {
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
  document.body.classList.remove("drawerOpen");
}

async function loadCenters() {
  setStatus("Loading…", { kind: "info" });
  const data = await requestJson("/api/firestore/fulfillment-centers");
  const centers = Array.isArray(data?.centers) ? data.centers : [];
  renderRows(centers);
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
    const btn = $("saveCenterBtn");
    const cancelBtn = $("centerDrawerCancel");
    const closeBtn = $("centerDrawerClose");
    const originalHtml = btn ? btn.innerHTML : "";
    const id = String($("centerId")?.value ?? "").trim();
    const values = readDialogValues();
    if (!values.originName) {
      setStatus("Origin Name is required.", { kind: "error" });
      return;
    }

    if (btn) btn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    if (btn) btn.innerHTML = `<span class="btnSpinner" aria-hidden="true"></span> Saving…`;

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
    } finally {
      if (btn) btn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
      if (btn) btn.innerHTML = originalHtml || "Save";
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
