(() => {
  const enabled =
    String(document.body?.dataset?.debugFooter ?? "").trim() === "1" ||
    String(window.__DEBUG_FOOTER_ENABLED__ ?? "").trim() === "1";
  if (!enabled) return;

  const MAX_LINES = 5;
  const lines = [];

  const formatTime = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const safeToText = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const pushLine = (text) => {
    const t = String(text ?? "").trim();
    if (!t) return;
    lines.push(`[${formatTime()}] ${t}`);
    while (lines.length > MAX_LINES) lines.shift();
    render();
  };

  const container = document.createElement("div");
  container.className = "debugFooter";
  container.id = "debugFooter";
  container.innerHTML = `
    <div class="debugFooterHeader">
      <div class="debugFooterTitle">Debug</div>
      <button type="button" class="debugFooterBtn" data-action="clear">Clear</button>
    </div>
    <ul class="debugFooterLines"></ul>
  `;

  const listEl = container.querySelector(".debugFooterLines");
  const render = () => {
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      listEl.appendChild(li);
    }
  };

  container.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-action='clear']");
    if (!btn) return;
    lines.length = 0;
    render();
  });

  document.body.appendChild(container);
  try {
    document.body.style.paddingBottom = "var(--debugFooterHeight)";
  } catch {
    // ignore
  }

  // Capture console output (best-effort).
  const wrapConsole = (name) => {
    const original = console[name];
    if (typeof original !== "function") return;
    console[name] = (...args) => {
      try {
        pushLine(`${name}: ${args.map(safeToText).join(" ")}`.slice(0, 400));
      } catch {
        // ignore
      }
      return original.apply(console, args);
    };
  };
  wrapConsole("log");
  wrapConsole("warn");
  wrapConsole("error");

  // Capture fetches (best-effort).
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async (...args) => {
      const input = args[0];
      const init = args[1] || {};
      const method = String(init?.method ?? "GET").toUpperCase();
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      const shortUrl = url.replace(window.location.origin, "");
      const started = Date.now();
      pushLine(`fetch ${method} ${shortUrl}`);
      try {
        const resp = await originalFetch(...args);
        const ms = Date.now() - started;
        pushLine(`resp ${resp.status} ${method} ${shortUrl} (${ms}ms)`);
        return resp;
      } catch (err) {
        const ms = Date.now() - started;
        pushLine(`resp ERR ${method} ${shortUrl} (${ms}ms)`);
        throw err;
      }
    };
  }

  window.addEventListener("unhandledrejection", (e) => {
    pushLine(`unhandledrejection: ${safeToText(e?.reason ?? "")}`.slice(0, 400));
  });
  window.addEventListener("error", (e) => {
    pushLine(`error: ${safeToText(e?.message ?? "")}`.slice(0, 400));
  });
})();
