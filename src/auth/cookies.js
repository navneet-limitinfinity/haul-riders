export function parseCookies(cookieHeader) {
  const header = String(cookieHeader ?? "");
  if (!header) return {};

  const out = {};
  const parts = header.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = String(rawKey ?? "").trim();
    if (!key) continue;
    const value = rest.join("=");
    out[key] = decodeURIComponent(String(value ?? "").trim());
  }
  return out;
}

