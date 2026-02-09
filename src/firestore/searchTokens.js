function normalizeToken(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  // Keep alphanumerics; turn other chars into spaces, then collapse.
  return raw.replaceAll(/[^a-z0-9]+/g, " ").trim();
}

function addTokens(set, value) {
  const norm = normalizeToken(value);
  if (!norm) return;
  for (const t of norm.split(/\s+/g)) {
    if (!t) continue;
    if (t.length < 2) continue;
    set.add(t);
  }
}

function addDigits(set, value) {
  const digits = String(value ?? "").replaceAll(/\D/g, "");
  if (!digits) return;
  set.add(digits);
  // Common useful variants.
  if (digits.length >= 10) set.add(digits.slice(-10));
  if (digits.length >= 6) set.add(digits.slice(0, 6));
}

export function buildSearchTokensFromDoc({ order, consignmentNumber, courierPartner, courierType }) {
  const o = order && typeof order === "object" ? order : {};
  const shipping = o.shipping && typeof o.shipping === "object" ? o.shipping : {};

  const tokens = new Set();

  addTokens(tokens, o.orderId);
  addTokens(tokens, o.orderName);
  addTokens(tokens, consignmentNumber);
  addTokens(tokens, courierPartner);
  addTokens(tokens, courierType);

  addTokens(tokens, shipping.fullName);
  addTokens(tokens, shipping.city);
  addTokens(tokens, shipping.state);

  addDigits(tokens, shipping.phone1);
  addDigits(tokens, shipping.phone2);
  addDigits(tokens, shipping.pinCode);
  addDigits(tokens, consignmentNumber);

  // Stable, small cap.
  return Array.from(tokens).slice(0, 80);
}

