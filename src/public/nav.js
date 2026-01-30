const $ = (id) => document.getElementById(id);

function setNavState(open) {
  document.body.classList.toggle("navOpen", Boolean(open));
  const overlay = $("navOverlay");
  if (overlay) overlay.setAttribute("aria-hidden", open ? "false" : "true");
}

function ensureToggleNav() {
  if (typeof window.toggleNav !== "function") {
    window.toggleNav = setNavState;
    return;
  }

  const existing = window.toggleNav;
  window.toggleNav = function (open) {
    setNavState(open);
    existing(open);
  };
}

function initNavInteractions() {
  ensureToggleNav();

  const toggle = $("navToggle");
  if (toggle) {
    toggle.addEventListener("click", () => window.toggleNav(true));
  }

  const overlay = $("navOverlay");
  if (overlay) {
    overlay.addEventListener("click", () => window.toggleNav(false));
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Esc") {
      window.toggleNav(false);
    }
  });
}

window.addEventListener("DOMContentLoaded", initNavInteractions);
