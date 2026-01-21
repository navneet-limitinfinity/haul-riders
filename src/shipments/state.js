import fs from "node:fs/promises";

const EMPTY_STATE = Object.freeze({ orders: {} });

const normalizeKey = (v) => String(v ?? "").trim();

export const normalizeShipmentStatus = (value) => {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "new";

  if (s === "new") return "new";
  if (s === "assigned") return "assigned";
  if (s === "in_transit" || s === "in transit") return "in_transit";
  if (s === "delivered") return "delivered";
  if (s === "rto") return "rto";

  // Shopify / courier-ish statuses
  if (s === "fulfilled") return "delivered";
  if (s === "unfulfilled") return "new";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("rto")) return "rto";
  if (s.includes("assign")) return "assigned";

  return "new";
};

export async function readShipmentsState({ filePath }) {
  const p = normalizeKey(filePath);
  if (!p) return EMPTY_STATE;

  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_STATE;
    const orders = parsed.orders && typeof parsed.orders === "object" ? parsed.orders : {};
    return { orders };
  } catch (error) {
    if (error?.code === "ENOENT") return EMPTY_STATE;
    throw error;
  }
}

async function writeJsonAtomic({ filePath, value }) {
  const p = normalizeKey(filePath);
  if (!p) throw new Error("SHIPMENTS_STATE_FILE is required");
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, p);
}

export async function upsertShipment({ filePath, orderKey, patch }) {
  const key = normalizeKey(orderKey);
  if (!key) throw new Error("orderKey is required");

  const state = await readShipmentsState({ filePath });
  const existing = state.orders[key] && typeof state.orders[key] === "object" ? state.orders[key] : {};
  const next = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const orders = { ...state.orders, [key]: next };
  await writeJsonAtomic({ filePath, value: { orders } });
  return next;
}

export function getShipmentForOrder({ shipmentsState, orderKey }) {
  const key = normalizeKey(orderKey);
  if (!key) return null;
  const entry = shipmentsState?.orders?.[key];
  if (!entry || typeof entry !== "object") return null;
  return entry;
}

