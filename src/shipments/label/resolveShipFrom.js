import { getShopDoc } from "../../firestore/shops.js";

const normalize = (value) => String(value ?? "").trim();

function normalizeShipFrom(value) {
  const v = value && typeof value === "object" ? value : null;
  if (!v) return null;
  return {
    name: normalize(v.name),
    address1: normalize(v.address1),
    address2: normalize(v.address2),
    city: normalize(v.city),
    state: normalize(v.state),
    pinCode: normalize(v.pinCode),
    country: normalize(v.country) || "IN",
    phone: normalize(v.phone),
  };
}

export async function resolveShipFrom({ env, shopDomain }) {
  const fallback = normalizeShipFrom(env?.shipFrom) ?? {
    name: "Haul Riders",
    address1: "",
    address2: "",
    city: "",
    state: "",
    pinCode: "",
    country: "IN",
    phone: "",
  };

  const doc = await getShopDoc({ env, shopDomain });
  const data = doc?.data ?? null;
  const from = normalizeShipFrom(data?.shipFrom);
  if (!from) return fallback;

  return {
    ...fallback,
    ...from,
    name: from.name || fallback.name,
  };
}

