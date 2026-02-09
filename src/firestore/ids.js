import crypto from "node:crypto";

export function toOrderDocId(orderKey) {
  const raw = String(orderKey ?? "").trim();
  if (!raw) return "order_unknown";
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return `order_${hash}`;
}
