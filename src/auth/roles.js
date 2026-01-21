export const ROLE_ADMIN = "admin";
export const ROLE_SHOP = "shop";

export function normalizeRole(value) {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "admin") return ROLE_ADMIN;
  if (role === "shop") return ROLE_SHOP;
  if (role === "client") return ROLE_SHOP;
  return "";
}

